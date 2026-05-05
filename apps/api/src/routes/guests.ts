import {
  followUpCreateSchema,
  followUpUpdateSchema,
  guestCreateSchema,
  guestDuplicateQuerySchema,
  guestListQuerySchema,
  guestNoteCreateSchema,
  guestTagsSchema,
  guestUpdateSchema,
} from "@hoteldesk/shared";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { Router } from "express";
import multer from "multer";
import { db } from "../db/client.js";
import { guestFollowUps, guestNotes, guests } from "../db/schema/guests.js";
import { logActivity } from "../lib/activity.js";
import { encrypt, last4 } from "../lib/crypto.js";
import { fail, list, ok } from "../lib/response.js";
import { signedKycUrl, uploadKycPhoto, validateKycFile } from "../lib/storage.js";
import { requireAdmin, requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 2 },
});

const router = Router();

const maskId = (encrypted: string, l4: string) => `••••${l4}`;

function maskGuest<T extends { idProofNumberEncrypted: string; idProofLast4: string }>(
  guest: T,
  role: string,
) {
  if (role === "admin") return guest;
  const { idProofNumberEncrypted: _e, ...rest } = guest;
  return { ...rest, idProofMasked: maskId(_e, guest.idProofLast4) };
}

router.get(
  "/",
  requireAuth,
  requireRole("admin", "frontdesk"),
  validate(guestListQuerySchema, "query"),
  async (req, res) => {
    const { search, tag, has_followup, page, per_page } = req.query as unknown as {
      search?: string;
      tag?: string;
      has_followup?: "true" | "false";
      page: number;
      per_page: number;
    };
    const offset = (page - 1) * per_page;

    const conditions = [];
    if (search) {
      conditions.push(
        or(
          ilike(guests.fullName, `%${search}%`),
          ilike(guests.phone, `%${search}%`),
          ilike(guests.idProofLast4, `%${search}%`),
          ilike(guests.email, `%${search}%`),
          ilike(guests.companyName, `%${search}%`),
        )!,
      );
    }
    if (tag) {
      conditions.push(sql`${tag} = ANY(${guests.tags})`);
    }
    if (has_followup === "true") {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM ${guestFollowUps} f WHERE f.guest_id = ${guests.id} AND f.status = 'pending')`,
      );
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, totalRows] = await Promise.all([
      db
        .select()
        .from(guests)
        .where(where)
        .orderBy(desc(guests.createdAt))
        .limit(per_page)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(guests).where(where),
    ]);

    const masked = rows.map((r) => maskGuest(r, req.user!.role));
    return list(res, masked, { total: totalRows[0]?.count ?? 0, page, per_page });
  },
);

router.get(
  "/check-duplicate",
  requireAuth,
  requireRole("admin", "frontdesk"),
  validate(guestDuplicateQuerySchema, "query"),
  async (req, res) => {
    const { phone, id_number } = req.query as { phone?: string; id_number?: string };
    if (!phone && !id_number) return ok(res, { duplicate: false });

    const conditions = [];
    if (phone) conditions.push(eq(guests.phone, phone));
    if (id_number) conditions.push(eq(guests.idProofLast4, id_number.slice(-4)));

    const matches = await db
      .select({ id: guests.id, fullName: guests.fullName, phone: guests.phone })
      .from(guests)
      .where(or(...conditions))
      .limit(5);

    return ok(res, { duplicate: matches.length > 0, matches });
  },
);

router.get(
  "/:id",
  requireAuth,
  requireRole("admin", "frontdesk"),
  async (req, res) => {
    const id = req.params.id!;
    const found = await db.select().from(guests).where(eq(guests.id, id)).limit(1);
    if (!found.length) return fail(res, 404, "NOT_FOUND", "Guest not found");
    return ok(res, maskGuest(found[0]!, req.user!.role));
  },
);

router.post(
  "/",
  requireAuth,
  requireRole("admin", "frontdesk"),
  validate(guestCreateSchema),
  async (req, res) => {
    const input = req.body;
    const dup = await db
      .select({ id: guests.id })
      .from(guests)
      .where(eq(guests.phone, input.phone))
      .limit(1);
    if (dup.length) return fail(res, 409, "DUPLICATE_PHONE", "Phone already registered");

    const [created] = await db
      .insert(guests)
      .values({
        fullName: input.fullName,
        phone: input.phone,
        email: input.email || null,
        idProofType: input.idProofType,
        idProofNumberEncrypted: encrypt(input.idProofNumber),
        idProofLast4: last4(input.idProofNumber),
        address: input.address || null,
        city: input.city || null,
        state: input.state || null,
        nationality: input.nationality || "Indian",
        dateOfBirth: input.dateOfBirth || null,
        companyName: input.companyName || null,
        gstin: input.gstin || null,
        notes: input.notes || null,
      })
      .returning();

    await logActivity({
      action: "guest_created",
      entityType: "guest",
      entityId: created!.id,
      description: `Guest ${created!.fullName} added`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    return ok(res, maskGuest(created!, req.user!.role), 201);
  },
);

router.put(
  "/:id",
  requireAuth,
  requireRole("admin", "frontdesk"),
  validate(guestUpdateSchema),
  async (req, res) => {
    const id = req.params.id!;
    const input = req.body;
    const update: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(input)) {
      if (v === undefined) continue;
      if (k === "idProofNumber" && typeof v === "string") {
        update.idProofNumberEncrypted = encrypt(v);
        update.idProofLast4 = last4(v);
      } else {
        update[k] = v;
      }
    }
    const [updated] = await db.update(guests).set(update).where(eq(guests.id, id)).returning();
    if (!updated) return fail(res, 404, "NOT_FOUND", "Guest not found");

    await logActivity({
      action: "guest_updated",
      entityType: "guest",
      entityId: id,
      description: `Guest ${updated.fullName} updated`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    return ok(res, maskGuest(updated, req.user!.role));
  },
);

router.post(
  "/:id/kyc",
  requireAuth,
  requireRole("admin", "frontdesk"),
  upload.fields([
    { name: "front", maxCount: 1 },
    { name: "back", maxCount: 1 },
  ]),
  async (req, res) => {
    const id = req.params.id!;
    const existing = await db.select().from(guests).where(eq(guests.id, id)).limit(1);
    if (!existing.length) return fail(res, 404, "NOT_FOUND", "Guest not found");

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const front = files?.front?.[0];
    const back = files?.back?.[0];
    if (!front) return fail(res, 400, "FRONT_REQUIRED", "Front of ID proof is required");

    const frontErr = validateKycFile(front);
    if (frontErr) return fail(res, 400, "INVALID_FILE", frontErr);
    if (back) {
      const backErr = validateKycFile(back);
      if (backErr) return fail(res, 400, "INVALID_FILE", backErr);
    }

    const frontPath = await uploadKycPhoto(id, "front", front);
    const backPath = back ? await uploadKycPhoto(id, "back", back) : null;

    const [updated] = await db
      .update(guests)
      .set({
        idProofPhotoFront: frontPath,
        idProofPhotoBack: backPath ?? existing[0]!.idProofPhotoBack,
        kycVerifiedAt: new Date(),
        kycVerifiedBy: req.user!.id,
        updatedAt: new Date(),
      })
      .where(eq(guests.id, id))
      .returning();

    await logActivity({
      action: "kyc_uploaded",
      entityType: "guest",
      entityId: id,
      description: `KYC documents uploaded for ${updated!.fullName}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });

    return ok(res, {
      kycVerifiedAt: updated!.kycVerifiedAt,
      idProofPhotoFront: updated!.idProofPhotoFront,
      idProofPhotoBack: updated!.idProofPhotoBack,
    });
  },
);

router.get(
  "/:id/kyc",
  requireAuth,
  requireRole("admin", "frontdesk"),
  async (req, res) => {
    const id = req.params.id!;
    const found = await db.select().from(guests).where(eq(guests.id, id)).limit(1);
    if (!found.length) return fail(res, 404, "NOT_FOUND", "Guest not found");
    const g = found[0]!;
    const [frontUrl, backUrl] = await Promise.all([
      g.idProofPhotoFront ? signedKycUrl(g.idProofPhotoFront) : null,
      g.idProofPhotoBack ? signedKycUrl(g.idProofPhotoBack) : null,
    ]);
    return ok(res, {
      verified: g.kycVerifiedAt !== null,
      kycVerifiedAt: g.kycVerifiedAt,
      frontUrl,
      backUrl,
    });
  },
);

router.patch(
  "/:id/tags",
  requireAuth,
  requireRole("admin", "frontdesk"),
  validate(guestTagsSchema),
  async (req, res) => {
    const id = req.params.id!;
    const { tags } = req.body as { tags: string[] };
    const normalized = Array.from(new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean)));
    const [updated] = await db
      .update(guests)
      .set({ tags: normalized, updatedAt: new Date() })
      .where(eq(guests.id, id))
      .returning();
    if (!updated) return fail(res, 404, "NOT_FOUND", "Guest not found");

    await logActivity({
      action: "guest_tags_updated",
      entityType: "guest",
      entityId: id,
      description: `Tags: ${normalized.join(", ") || "(none)"}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    return ok(res, { tags: normalized });
  },
);

router.get(
  "/:id/notes",
  requireAuth,
  requireRole("admin", "frontdesk"),
  async (req, res) => {
    const id = req.params.id!;
    const rows = await db
      .select()
      .from(guestNotes)
      .where(eq(guestNotes.guestId, id))
      .orderBy(desc(guestNotes.createdAt));
    return ok(res, rows);
  },
);

router.post(
  "/:id/notes",
  requireAuth,
  requireRole("admin", "frontdesk"),
  validate(guestNoteCreateSchema),
  async (req, res) => {
    const id = req.params.id!;
    const { body } = req.body as { body: string };
    const guestExists = await db.select({ id: guests.id }).from(guests).where(eq(guests.id, id)).limit(1);
    if (!guestExists.length) return fail(res, 404, "NOT_FOUND", "Guest not found");

    const [created] = await db
      .insert(guestNotes)
      .values({ guestId: id, body, authorId: req.user!.id })
      .returning();
    return ok(res, created, 201);
  },
);

router.get(
  "/:id/follow-ups",
  requireAuth,
  requireRole("admin", "frontdesk"),
  async (req, res) => {
    const id = req.params.id!;
    const rows = await db
      .select()
      .from(guestFollowUps)
      .where(eq(guestFollowUps.guestId, id))
      .orderBy(asc(guestFollowUps.dueDate));
    return ok(res, rows);
  },
);

router.post(
  "/:id/follow-ups",
  requireAuth,
  requireRole("admin", "frontdesk"),
  validate(followUpCreateSchema),
  async (req, res) => {
    const id = req.params.id!;
    const input = req.body as { task: string; dueDate: string; assignedTo?: string | null };
    const guestExists = await db.select({ id: guests.id }).from(guests).where(eq(guests.id, id)).limit(1);
    if (!guestExists.length) return fail(res, 404, "NOT_FOUND", "Guest not found");

    const [created] = await db
      .insert(guestFollowUps)
      .values({
        guestId: id,
        task: input.task,
        dueDate: input.dueDate,
        assignedTo: input.assignedTo ?? null,
        createdBy: req.user!.id,
      })
      .returning();

    await logActivity({
      action: "followup_created",
      entityType: "guest",
      entityId: id,
      description: `Follow-up: ${input.task} (due ${input.dueDate})`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    return ok(res, created, 201);
  },
);

router.patch(
  "/:id/follow-ups/:followUpId",
  requireAuth,
  requireRole("admin", "frontdesk"),
  validate(followUpUpdateSchema),
  async (req, res) => {
    const { followUpId } = req.params as { followUpId: string };
    const input = req.body as {
      status?: "pending" | "done" | "cancelled";
      task?: string;
      dueDate?: string;
      assignedTo?: string | null;
    };
    const patch: Record<string, unknown> = {};
    if (input.status !== undefined) {
      patch.status = input.status;
      patch.completedAt = input.status === "done" ? new Date() : null;
    }
    if (input.task !== undefined) patch.task = input.task;
    if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
    if (input.assignedTo !== undefined) patch.assignedTo = input.assignedTo;

    const [updated] = await db
      .update(guestFollowUps)
      .set(patch)
      .where(eq(guestFollowUps.id, followUpId))
      .returning();
    if (!updated) return fail(res, 404, "NOT_FOUND", "Follow-up not found");
    return ok(res, updated);
  },
);

router.get(
  "/follow-ups/due",
  requireAuth,
  requireRole("admin", "frontdesk"),
  async (req, res) => {
    const days = Math.min(30, Math.max(0, Number((req.query as { days?: string }).days ?? 7)));
    const rows = await db
      .select({
        id: guestFollowUps.id,
        guestId: guestFollowUps.guestId,
        guestName: guests.fullName,
        guestPhone: guests.phone,
        task: guestFollowUps.task,
        dueDate: guestFollowUps.dueDate,
        status: guestFollowUps.status,
        assignedTo: guestFollowUps.assignedTo,
      })
      .from(guestFollowUps)
      .innerJoin(guests, eq(guests.id, guestFollowUps.guestId))
      .where(
        and(
          eq(guestFollowUps.status, "pending"),
          sql`${guestFollowUps.dueDate} <= (CURRENT_DATE + ${days}::int)`,
        ),
      )
      .orderBy(asc(guestFollowUps.dueDate));
    return ok(res, rows);
  },
);

router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = req.params.id!;
  const [deleted] = await db.delete(guests).where(eq(guests.id, id)).returning();
  if (!deleted) return fail(res, 404, "NOT_FOUND", "Guest not found");

  await logActivity({
    action: "guest_deleted",
    entityType: "guest",
    entityId: id,
    description: `Guest ${deleted.fullName} deleted`,
    performedBy: req.user!.id,
    ipAddress: req.ip,
  });
  return ok(res, { deleted: true });
});

export default router;
