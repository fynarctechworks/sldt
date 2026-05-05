import {
  roomTypeCreateSchema,
  roomTypeUpdateSchema,
  settingsUpdateSchema,
  staffCreateSchema,
  staffUpdateSchema,
} from "@hoteldesk/shared";
import { and, asc, count as sqlCount, eq, sql } from "drizzle-orm";
import { Router } from "express";
import { db } from "../db/client.js";
import { profiles } from "../db/schema/profiles.js";
import { reservationRooms } from "../db/schema/reservations.js";
import { rooms } from "../db/schema/rooms.js";
import { roomTypes, settings } from "../db/schema/settings.js";
import { logActivity } from "../lib/activity.js";
import { fail, ok } from "../lib/response.js";
import { invalidateSettings } from "../lib/settings.js";
import {
  TEMPLATE_DEFAULTS,
  getAllTemplatesForUI,
  upsertTemplate,
} from "../lib/templates.js";
import { supabaseAdmin } from "../lib/supabase.js";
import { requireAdmin, requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const router = Router();

router.get("/", requireAuth, requireAdmin, async (_req, res) => {
  const rows = await db.select().from(settings).limit(1);
  const types = await db.select().from(roomTypes).orderBy(asc(roomTypes.label));
  return ok(res, { settings: rows[0] ?? null, roomTypes: types });
});

router.get("/public", requireAuth, async (_req, res) => {
  const rows = await db
    .select({
      hotelName: settings.hotelName,
      hotelAddress: settings.hotelAddress,
      hotelPhone: settings.hotelPhone,
      hotelGstin: settings.hotelGstin,
      hotelLogoUrl: settings.hotelLogoUrl,
      checkInTime: settings.checkInTime,
      checkOutTime: settings.checkOutTime,
    })
    .from(settings)
    .limit(1);
  return ok(res, rows[0] ?? null);
});

router.put("/", requireAuth, requireAdmin, validate(settingsUpdateSchema), async (req, res) => {
  const input = req.body as Record<string, unknown>;
  const rows = await db.select().from(settings).limit(1);
  if (!rows.length) return fail(res, 404, "NOT_FOUND", "Settings not initialized");
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(input)) if (v !== undefined) update[k] = v;
  const [updated] = await db
    .update(settings)
    .set(update)
    .where(eq(settings.id, rows[0]!.id))
    .returning();
  invalidateSettings();
  await logActivity({
    action: "settings_updated",
    entityType: "settings",
    entityId: updated!.id,
    description: "Hotel settings updated",
    performedBy: req.user!.id,
    ipAddress: req.ip,
  });
  return ok(res, updated);
});

router.get("/room-types", requireAuth, requireRole("admin", "frontdesk"), async (req, res) => {
  const includeArchived = req.query.all === "true";
  const rows = await db
    .select()
    .from(roomTypes)
    .where(includeArchived ? undefined : eq(roomTypes.isActive, true))
    .orderBy(asc(roomTypes.label));
  return ok(res, rows);
});

router.post(
  "/room-types",
  requireAuth,
  requireAdmin,
  validate(roomTypeCreateSchema),
  async (req, res) => {
    const input = req.body as {
      slug: string;
      label: string;
      defaultRate: number;
      maxOccupancy: number;
      description?: string | null;
      isActive: boolean;
    };

    const dup = await db.select({ id: roomTypes.id }).from(roomTypes).where(eq(roomTypes.slug, input.slug)).limit(1);
    if (dup.length) return fail(res, 409, "DUPLICATE_SLUG", "A room type with this slug already exists");

    const [row] = await db
      .insert(roomTypes)
      .values({
        slug: input.slug,
        label: input.label,
        defaultRate: String(input.defaultRate),
        maxOccupancy: String(input.maxOccupancy),
        description: input.description ?? null,
        isActive: input.isActive,
      })
      .returning();

    await logActivity({
      action: "room_type_created",
      entityType: "room_type",
      entityId: row!.id,
      description: `Room type added: ${row!.label}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    return ok(res, row, 201);
  },
);

router.put(
  "/room-types/:id",
  requireAuth,
  requireAdmin,
  validate(roomTypeUpdateSchema),
  async (req, res) => {
    const id = req.params.id!;
    const input = req.body as Record<string, unknown>;

    const existing = await db.select().from(roomTypes).where(eq(roomTypes.id, id)).limit(1);
    if (!existing.length) return fail(res, 404, "NOT_FOUND", "Room type not found");
    const oldSlug = existing[0]!.slug;

    const update: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(input)) {
      if (v === undefined) continue;
      if (k === "defaultRate" || k === "maxOccupancy") update[k] = String(v);
      else update[k] = v;
    }

    const newSlug = typeof input.slug === "string" ? input.slug : oldSlug;
    if (newSlug !== oldSlug) {
      const conflict = await db
        .select({ id: roomTypes.id })
        .from(roomTypes)
        .where(eq(roomTypes.slug, newSlug))
        .limit(1);
      if (conflict.length && conflict[0]!.id !== id) {
        return fail(res, 409, "DUPLICATE_SLUG", "Slug already taken");
      }
    }

    const row = await db.transaction(async (tx) => {
      const [r] = await tx.update(roomTypes).set(update).where(eq(roomTypes.id, id)).returning();
      if (newSlug !== oldSlug) {
        await tx.update(rooms).set({ roomType: newSlug, updatedAt: new Date() }).where(eq(rooms.roomType, oldSlug));
        await tx
          .update(reservationRooms)
          .set({ soldAsType: newSlug })
          .where(eq(reservationRooms.soldAsType, oldSlug));
      }
      return r;
    });

    await logActivity({
      action: "room_type_updated",
      entityType: "room_type",
      entityId: id,
      description:
        newSlug !== oldSlug
          ? `Room type updated: ${row!.label} (slug: ${oldSlug} → ${newSlug})`
          : `Room type updated: ${row!.label}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    return ok(res, row);
  },
);

router.delete("/room-types/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = req.params.id!;
  const existing = await db.select().from(roomTypes).where(eq(roomTypes.id, id)).limit(1);
  if (!existing.length) return fail(res, 404, "NOT_FOUND", "Room type not found");

  const inUse = await db
    .select({ id: rooms.id })
    .from(rooms)
    .where(eq(rooms.roomType, existing[0]!.slug))
    .limit(1);

  if (inUse.length) {
    const [archived] = await db
      .update(roomTypes)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(roomTypes.id, id))
      .returning();
    await logActivity({
      action: "room_type_archived",
      entityType: "room_type",
      entityId: id,
      description: `Room type archived (in use): ${archived!.label}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    return ok(res, { archived: true, row: archived });
  }

  await db.delete(roomTypes).where(eq(roomTypes.id, id));
  await logActivity({
    action: "room_type_deleted",
    entityType: "room_type",
    entityId: id,
    description: `Room type deleted: ${existing[0]!.label}`,
    performedBy: req.user!.id,
    ipAddress: req.ip,
  });
  return ok(res, { deleted: true });
});

// ============ MESSAGE TEMPLATES ============

router.get("/templates", requireAuth, requireAdmin, async (_req, res) => {
  const items = await getAllTemplatesForUI();
  return ok(res, { items });
});

router.put("/templates/:key", requireAuth, requireAdmin, async (req, res) => {
  const key = req.params.key;
  if (!key || !(key in TEMPLATE_DEFAULTS)) {
    return fail(res, 400, "INVALID_KEY", "Unknown template key");
  }
  const input = req.body as { subject?: string | null; body?: string; enabled?: boolean };
  if (input.body !== undefined && input.body.trim() === "") {
    return fail(res, 400, "EMPTY_BODY", "Body cannot be empty");
  }
  await upsertTemplate(key as keyof typeof TEMPLATE_DEFAULTS, input);
  await logActivity({
    action: "template_updated",
    entityType: "template",
    entityId: key,
    description: `Template ${key} updated`,
    performedBy: req.user!.id,
    ipAddress: req.ip,
  });
  return ok(res, { ok: true });
});

router.post("/templates/:key/reset", requireAuth, requireAdmin, async (req, res) => {
  const key = req.params.key;
  if (!key || !(key in TEMPLATE_DEFAULTS)) {
    return fail(res, 400, "INVALID_KEY", "Unknown template key");
  }
  const def = TEMPLATE_DEFAULTS[key as keyof typeof TEMPLATE_DEFAULTS];
  await upsertTemplate(key as keyof typeof TEMPLATE_DEFAULTS, {
    subject: def.subject ?? null,
    body: def.body,
    enabled: true,
  });
  return ok(res, { ok: true });
});

// ============ STAFF ============

const staffRouter = Router();

staffRouter.get("/", requireAuth, requireAdmin, async (_req, res) => {
  const rows = await db.select().from(profiles).orderBy(profiles.fullName);
  return ok(res, rows);
});

staffRouter.post("/", requireAuth, requireAdmin, validate(staffCreateSchema), async (req, res) => {
  const input = req.body as {
    email: string;
    password: string;
    fullName: string;
    role: "admin" | "frontdesk" | "housekeeping";
    phone?: string;
  };

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (error || !data.user) return fail(res, 400, "AUTH_ERROR", error?.message ?? "Create failed");

  const [profile] = await db
    .insert(profiles)
    .values({
      id: data.user.id,
      fullName: input.fullName,
      email: input.email,
      role: input.role,
      phone: input.phone ?? null,
      isActive: true,
    })
    .returning();

  await logActivity({
    action: "staff_created",
    entityType: "profile",
    entityId: data.user.id,
    description: `Staff added: ${input.fullName} (${input.role})`,
    performedBy: req.user!.id,
    ipAddress: req.ip,
  });
  return ok(res, profile, 201);
});

staffRouter.put(
  "/:id",
  requireAuth,
  requireAdmin,
  validate(staffUpdateSchema),
  async (req, res) => {
    const id = req.params.id!;
    const input = req.body as {
      fullName?: string;
      role?: "admin" | "frontdesk" | "housekeeping";
      isActive?: boolean;
      phone?: string | null;
      email?: string;
      password?: string;
    };

    if (input.role && id === req.user!.id && input.role !== "admin") {
      return fail(res, 400, "SELF_DEMOTE", "You cannot change your own role away from admin");
    }
    if (input.isActive === false && id === req.user!.id) {
      return fail(res, 400, "SELF_DEACTIVATE", "You cannot deactivate yourself");
    }

    if (input.email || input.password) {
      const authUpdate: { email?: string; password?: string } = {};
      if (input.email) authUpdate.email = input.email;
      if (input.password) authUpdate.password = input.password;
      const { error } = await supabaseAdmin.auth.admin.updateUserById(id, authUpdate);
      if (error) return fail(res, 400, "AUTH_ERROR", error.message);
    }

    const profilePatch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.fullName !== undefined) profilePatch.fullName = input.fullName;
    if (input.role !== undefined) profilePatch.role = input.role;
    if (input.isActive !== undefined) profilePatch.isActive = input.isActive;
    if (input.phone !== undefined) profilePatch.phone = input.phone;
    if (input.email !== undefined) profilePatch.email = input.email;

    const [updated] = await db
      .update(profiles)
      .set(profilePatch)
      .where(eq(profiles.id, id))
      .returning();
    if (!updated) return fail(res, 404, "NOT_FOUND", "Staff not found");

    const changes: string[] = [];
    if (input.fullName) changes.push("name");
    if (input.role) changes.push("role");
    if (input.email) changes.push("email");
    if (input.password) changes.push("password");
    if (input.phone !== undefined) changes.push("phone");
    if (input.isActive !== undefined) changes.push(input.isActive ? "reactivated" : "deactivated");

    await logActivity({
      action: "staff_updated",
      entityType: "profile",
      entityId: id,
      description: `Staff updated: ${updated.fullName}${changes.length ? ` (${changes.join(", ")})` : ""}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    return ok(res, updated);
  },
);

staffRouter.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = req.params.id!;
  if (id === req.user!.id) return fail(res, 400, "SELF_DEACTIVATE", "You cannot deactivate yourself");
  const [updated] = await db
    .update(profiles)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(profiles.id, id))
    .returning();
  if (!updated) return fail(res, 404, "NOT_FOUND", "Staff not found");

  await logActivity({
    action: "staff_deactivated",
    entityType: "profile",
    entityId: id,
    description: `Staff deactivated: ${updated.fullName}`,
    performedBy: req.user!.id,
    ipAddress: req.ip,
  });
  return ok(res, updated);
});

staffRouter.delete("/:id/hard", requireAuth, requireAdmin, async (req, res) => {
  const id = req.params.id!;
  if (id === req.user!.id) return fail(res, 400, "SELF_DELETE", "You cannot delete yourself");

  const [target] = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1);
  if (!target) return fail(res, 404, "NOT_FOUND", "Staff not found");

  const adminCount = await db
    .select({ n: sqlCount() })
    .from(profiles)
    .where(and(eq(profiles.role, "admin"), eq(profiles.isActive, true)));
  if (target.role === "admin" && Number(adminCount[0]?.n ?? 0) <= 1) {
    return fail(res, 400, "LAST_ADMIN", "Cannot delete the last active admin");
  }

  const referenceCheck = await db.execute(sql`
    select
      coalesce((select count(*) from reservations where created_by = ${id} or checked_in_by = ${id} or checked_out_by = ${id}), 0)::int as res_count,
      coalesce((select count(*) from invoices where issued_by = ${id} or voided_by = ${id}), 0)::int as inv_count,
      coalesce((select count(*) from payments where received_by = ${id}), 0)::int as pay_count,
      coalesce((select count(*) from activity_log where performed_by = ${id}), 0)::int as act_count
  `);
  const counts = (Array.isArray(referenceCheck) ? referenceCheck[0] : (referenceCheck as { rows?: unknown[] }).rows?.[0]) as
    | { res_count: number; inv_count: number; pay_count: number; act_count: number }
    | undefined;

  if (counts && (counts.res_count + counts.inv_count + counts.pay_count + counts.act_count) > 0) {
    return fail(
      res,
      409,
      "HAS_HISTORY",
      `Cannot delete: this user is linked to ${counts.res_count} reservation(s), ${counts.inv_count} invoice(s), ${counts.pay_count} payment(s), ${counts.act_count} activity log(s). Use Deactivate to preserve history.`,
    );
  }

  await db.delete(profiles).where(eq(profiles.id, id));
  const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
  if (error) {
    return fail(res, 500, "AUTH_DELETE_FAILED", `Profile deleted but auth user removal failed: ${error.message}`);
  }

  await logActivity({
    action: "staff_deleted",
    entityType: "profile",
    entityId: id,
    description: `Staff permanently deleted: ${target.fullName} (${target.email})`,
    performedBy: req.user!.id,
    ipAddress: req.ip,
  });
  return ok(res, { id, deleted: true });
});

export { router as settingsRouter, staffRouter };
