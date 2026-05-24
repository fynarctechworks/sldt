// Maintenance tickets API (Phase 2).
//
// Endpoints:
//   GET    /maintenance                 — list with filters + paging
//   POST   /maintenance                 — create a ticket
//   GET    /maintenance/:id             — detail with photos + events
//   PATCH  /maintenance/:id             — update meta (title, category, etc.)
//   POST   /maintenance/:id/status      — transition status (state-machine
//                                         enforced)
//   POST   /maintenance/:id/photos      — upload photo(s)
//   DELETE /maintenance/:id/photos/:pid — remove a photo

import {
  maintenanceTicketCreateSchema,
  maintenanceTicketListQuerySchema,
  maintenanceTicketStatusSchema,
  maintenanceTicketUpdateSchema,
} from "@hoteldesk/shared";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { db } from "../db/client.js";
import {
  maintenanceTicketEvents,
  maintenanceTicketPhotos,
  maintenanceTickets,
  MAINTENANCE_OPEN_STATUSES,
  MAINTENANCE_STATUS_TRANSITIONS as DB_TRANSITIONS,
  type MaintenanceStatus as DbMaintenanceStatus,
} from "../db/schema/maintenance.js";
import { profiles } from "../db/schema/profiles.js";
import { rooms } from "../db/schema/rooms.js";
import { logActivity } from "../lib/activity.js";
import { resolveCurrentPropertyId } from "../lib/currentProperty.js";
import { fail, list, ok } from "../lib/response.js";
import { uploadPublicFile } from "../lib/storage.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const router = Router();

const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_MIMES.has(file.mimetype)) {
      cb(new Error("Only JPEG, PNG, or WEBP images are accepted"));
      return;
    }
    cb(null, true);
  },
});

const MAINTENANCE_STATUS_TRANSITIONS_LOCAL = DB_TRANSITIONS;
function canTransition(from: DbMaintenanceStatus, to: DbMaintenanceStatus): boolean {
  return (MAINTENANCE_STATUS_TRANSITIONS_LOCAL[from] ?? []).includes(to);
}

// Helper: ticket number from the SLDT-MNT sequence created by 0013.
async function nextTicketNumber(
  exec: Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db,
): Promise<string> {
  const result = await exec.execute<{ nextval: string | number }>(
    sql`SELECT nextval('sldt_maintenance_seq') AS nextval`,
  );
  const row = result[0] as { nextval: string | number } | undefined;
  const seq = Number(row?.nextval ?? 0);
  return `SLDT-MNT-${String(seq).padStart(4, "0")}`;
}

// ---------- Routes ----------

router.get(
  "/",
  requireAuth,
  requirePermission("view_maintenance"),
  validate(maintenanceTicketListQuerySchema, "query"),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const q = req.query as unknown as z.infer<typeof maintenanceTicketListQuerySchema>;

    const conditions = [eq(maintenanceTickets.propertyId, propertyId)];
    if (q.status) conditions.push(eq(maintenanceTickets.status, q.status));
    if (q.category) conditions.push(eq(maintenanceTickets.category, q.category));
    if (q.priority) conditions.push(eq(maintenanceTickets.priority, q.priority));
    if (q.roomId) conditions.push(eq(maintenanceTickets.roomId, q.roomId));
    if (q.assignedTo) conditions.push(eq(maintenanceTickets.assignedTo, q.assignedTo));
    if (q.openOnly && !q.status) {
      conditions.push(inArray(maintenanceTickets.status, [...MAINTENANCE_OPEN_STATUSES]));
    }

    const rows = await db
      .select({
        t: maintenanceTickets,
        roomNumber: rooms.roomNumber,
        floor: rooms.floor,
        assigneeName: profiles.fullName,
      })
      .from(maintenanceTickets)
      .leftJoin(rooms, eq(rooms.id, maintenanceTickets.roomId))
      .leftJoin(profiles, eq(profiles.id, maintenanceTickets.assignedTo))
      .where(and(...conditions))
      .orderBy(
        // urgent → high → medium → low handled by ordering on the enum
        // ordinal. Postgres orders enums in declaration order.
        desc(maintenanceTickets.priority),
        desc(maintenanceTickets.createdAt),
      )
      .limit(q.per_page)
      .offset((q.page - 1) * q.per_page);

    const [count] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(maintenanceTickets)
      .where(and(...conditions));

    return list(
      res,
      rows.map((r) => ({
        ...r.t,
        roomNumber: r.roomNumber,
        floor: r.floor,
        assigneeName: r.assigneeName,
      })),
      { total: count?.c ?? 0, page: q.page, per_page: q.per_page },
    );
  },
);

router.post(
  "/",
  requireAuth,
  requirePermission("create_maintenance"),
  validate(maintenanceTicketCreateSchema),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const input = req.body as z.infer<typeof maintenanceTicketCreateSchema>;

    if (input.blocksRoom && !input.roomId) {
      return fail(res, 400, "BLOCKS_REQUIRES_ROOM", "blocksRoom=true requires a roomId");
    }

    const created = await db.transaction(async (tx) => {
      const ticketNumber = await nextTicketNumber(tx);
      const [ticket] = await tx
        .insert(maintenanceTickets)
        .values({
          ticketNumber,
          propertyId,
          roomId: input.roomId ?? null,
          reservationId: input.reservationId ?? null,
          category: input.category,
          priority: input.priority,
          status: "open",
          title: input.title,
          description: input.description ?? null,
          reportedBy: req.user!.id,
          assignedTo: input.assignedTo ?? null,
          assignedAt: input.assignedTo ? new Date() : null,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          blocksRoom: input.blocksRoom,
          estimatedCost: input.estimatedCost != null ? String(input.estimatedCost) : null,
        })
        .returning();

      await tx.insert(maintenanceTicketEvents).values({
        ticketId: ticket!.id,
        eventType: "created",
        description: `Ticket created`,
        payload: { category: input.category, priority: input.priority },
        actorId: req.user!.id,
      });

      // If blocksRoom is set, flip the room into maintenance now. The
      // resolve flow undoes this.
      if (input.blocksRoom && input.roomId) {
        await tx
          .update(rooms)
          .set({ status: "maintenance", updatedAt: new Date() })
          .where(eq(rooms.id, input.roomId));
      }
      return ticket!;
    });

    await logActivity({
      action: "maintenance_ticket_created",
      entityType: "maintenance_ticket",
      entityId: created.id,
      description: `${created.ticketNumber}: ${created.title}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    return ok(res, created);
  },
);

router.get(
  "/:id",
  requireAuth,
  requirePermission("view_maintenance"),
  async (req, res) => {
    const id = req.params.id!;
    const propertyId = await resolveCurrentPropertyId(req);
    const [ticket] = await db
      .select()
      .from(maintenanceTickets)
      .where(and(eq(maintenanceTickets.id, id), eq(maintenanceTickets.propertyId, propertyId)))
      .limit(1);
    if (!ticket) return fail(res, 404, "NOT_FOUND", "Ticket not found");

    const [photos, events, [room]] = await Promise.all([
      db
        .select()
        .from(maintenanceTicketPhotos)
        .where(eq(maintenanceTicketPhotos.ticketId, id))
        .orderBy(asc(maintenanceTicketPhotos.uploadedAt)),
      db
        .select({
          e: maintenanceTicketEvents,
          actorName: profiles.fullName,
        })
        .from(maintenanceTicketEvents)
        .leftJoin(profiles, eq(profiles.id, maintenanceTicketEvents.actorId))
        .where(eq(maintenanceTicketEvents.ticketId, id))
        .orderBy(desc(maintenanceTicketEvents.createdAt)),
      ticket.roomId
        ? db
            .select({ id: rooms.id, roomNumber: rooms.roomNumber, status: rooms.status })
            .from(rooms)
            .where(eq(rooms.id, ticket.roomId))
            .limit(1)
        : Promise.resolve([] as Array<{ id: string; roomNumber: string; status: string }>),
    ]);

    return ok(res, {
      ...ticket,
      photos,
      events: events.map((e) => ({ ...e.e, actorName: e.actorName })),
      room: room ?? null,
    });
  },
);

router.patch(
  "/:id",
  requireAuth,
  requirePermission("edit_maintenance"),
  validate(maintenanceTicketUpdateSchema),
  async (req, res) => {
    const id = req.params.id!;
    const propertyId = await resolveCurrentPropertyId(req);
    const patch = req.body as z.infer<typeof maintenanceTicketUpdateSchema>;

    const [existing] = await db
      .select()
      .from(maintenanceTickets)
      .where(and(eq(maintenanceTickets.id, id), eq(maintenanceTickets.propertyId, propertyId)))
      .limit(1);
    if (!existing) return fail(res, 404, "NOT_FOUND", "Ticket not found");

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.category !== undefined) updateData.category = patch.category;
    if (patch.priority !== undefined) updateData.priority = patch.priority;
    if (patch.title !== undefined) updateData.title = patch.title;
    if (patch.description !== undefined) updateData.description = patch.description;
    if (patch.dueAt !== undefined) {
      updateData.dueAt = patch.dueAt ? new Date(patch.dueAt) : null;
    }
    if (patch.blocksRoom !== undefined) updateData.blocksRoom = patch.blocksRoom;
    if (patch.estimatedCost !== undefined) {
      updateData.estimatedCost = patch.estimatedCost != null ? String(patch.estimatedCost) : null;
    }
    if (patch.actualCost !== undefined) {
      updateData.actualCost = patch.actualCost != null ? String(patch.actualCost) : null;
    }
    if (patch.assignedTo !== undefined) {
      updateData.assignedTo = patch.assignedTo;
      updateData.assignedAt = patch.assignedTo ? new Date() : null;
    }

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(maintenanceTickets)
        .set(updateData)
        .where(eq(maintenanceTickets.id, id))
        .returning();
      if (!row) return null;

      // Event log for the diff. Aggregating to one "updated" event so
      // the timeline doesn't get noisy on a single edit.
      const diff: Record<string, { from: unknown; to: unknown }> = {};
      for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
        const fromVal = (existing as unknown as Record<string, unknown>)[key];
        const toVal = (patch as Record<string, unknown>)[key];
        if (fromVal !== toVal) diff[key] = { from: fromVal, to: toVal };
      }
      if (Object.keys(diff).length) {
        await tx.insert(maintenanceTicketEvents).values({
          ticketId: id,
          eventType: "updated",
          description: `${Object.keys(diff).length} field(s) updated`,
          payload: { diff },
          actorId: req.user!.id,
        });
      }
      return row;
    });

    if (!updated) return fail(res, 404, "NOT_FOUND", "Ticket not found");
    return ok(res, updated);
  },
);

router.post(
  "/:id/status",
  requireAuth,
  requirePermission("edit_maintenance"),
  validate(maintenanceTicketStatusSchema),
  async (req, res) => {
    const id = req.params.id!;
    const propertyId = await resolveCurrentPropertyId(req);
    const { status, resolutionNotes } = req.body as z.infer<typeof maintenanceTicketStatusSchema>;

    const [existing] = await db
      .select()
      .from(maintenanceTickets)
      .where(and(eq(maintenanceTickets.id, id), eq(maintenanceTickets.propertyId, propertyId)))
      .limit(1);
    if (!existing) return fail(res, 404, "NOT_FOUND", "Ticket not found");

    if (!canTransition(existing.status as DbMaintenanceStatus, status as DbMaintenanceStatus)) {
      return fail(
        res,
        409,
        "INVALID_TRANSITION",
        `Cannot transition ${existing.status} → ${status}`,
      );
    }

    // closed / wont_fix specifically require close_maintenance.
    if (status === "closed" || status === "wont_fix") {
      const userPerms = (req.user as unknown as { permissions?: string[] }).permissions ?? [];
      if (!userPerms.includes("close_maintenance") && !userPerms.includes("*")) {
        return fail(res, 403, "FORBIDDEN", "close_maintenance permission required");
      }
    }

    const now = new Date();
    const updateData: Record<string, unknown> = { status, updatedAt: now };
    if (status === "resolved") {
      updateData.resolvedAt = now;
      updateData.resolvedBy = req.user!.id;
      if (resolutionNotes) updateData.resolutionNotes = resolutionNotes;
    }
    if (status === "closed") updateData.closedAt = now;

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(maintenanceTickets)
        .set(updateData)
        .where(eq(maintenanceTickets.id, id))
        .returning();
      await tx.insert(maintenanceTicketEvents).values({
        ticketId: id,
        eventType: "status_changed",
        description: `${existing.status} → ${status}`,
        payload: { from: existing.status, to: status, resolutionNotes: resolutionNotes ?? null },
        actorId: req.user!.id,
      });
      // If we're resolving a blocking ticket, return the room to dirty
      // (so housekeeping decides next state) and clear blocksRoom.
      if (
        (status === "resolved" || status === "closed" || status === "wont_fix") &&
        existing.blocksRoom &&
        existing.roomId
      ) {
        await tx
          .update(rooms)
          .set({ status: "dirty", updatedAt: now })
          .where(eq(rooms.id, existing.roomId));
        await tx
          .update(maintenanceTickets)
          .set({ blocksRoom: false })
          .where(eq(maintenanceTickets.id, id));
      }
      return row!;
    });
    return ok(res, updated);
  },
);

router.post(
  "/:id/photos",
  requireAuth,
  requirePermission("edit_maintenance"),
  upload.array("files", 6),
  async (req, res) => {
    const id = req.params.id!;
    const propertyId = await resolveCurrentPropertyId(req);
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) return fail(res, 400, "NO_FILES", "No image files received");

    const [ticket] = await db
      .select({ id: maintenanceTickets.id, ticketNumber: maintenanceTickets.ticketNumber })
      .from(maintenanceTickets)
      .where(and(eq(maintenanceTickets.id, id), eq(maintenanceTickets.propertyId, propertyId)))
      .limit(1);
    if (!ticket) return fail(res, 404, "NOT_FOUND", "Ticket not found");

    const safeName = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 60);
    const inserted = await db.transaction(async (tx) => {
      const rows: Array<typeof maintenanceTicketPhotos.$inferSelect> = [];
      for (const f of files) {
        const path = `maintenance/${ticket.ticketNumber}/${Date.now()}-${safeName(f.originalname)}`;
        const url = await uploadPublicFile(path, f.buffer, f.mimetype);
        if (!url) throw new Error("Failed to upload maintenance photo");
        const [row] = await tx
          .insert(maintenanceTicketPhotos)
          .values({
            ticketId: id,
            url,
            storagePath: path,
            uploadedBy: req.user!.id,
          })
          .returning();
        rows.push(row!);
      }
      await tx.insert(maintenanceTicketEvents).values({
        ticketId: id,
        eventType: "photos_added",
        description: `${rows.length} photo${rows.length === 1 ? "" : "s"} added`,
        payload: { count: rows.length },
        actorId: req.user!.id,
      });
      return rows;
    });

    return ok(res, inserted);
  },
);

router.delete(
  "/:id/photos/:pid",
  requireAuth,
  requirePermission("edit_maintenance"),
  async (req, res) => {
    const { id, pid } = req.params as { id: string; pid: string };
    const propertyId = await resolveCurrentPropertyId(req);
    const [photo] = await db
      .select()
      .from(maintenanceTicketPhotos)
      .innerJoin(maintenanceTickets, eq(maintenanceTickets.id, maintenanceTicketPhotos.ticketId))
      .where(
        and(
          eq(maintenanceTicketPhotos.id, pid),
          eq(maintenanceTickets.id, id),
          eq(maintenanceTickets.propertyId, propertyId),
        ),
      )
      .limit(1);
    if (!photo) return fail(res, 404, "NOT_FOUND", "Photo not found");
    await db.delete(maintenanceTicketPhotos).where(eq(maintenanceTicketPhotos.id, pid));
    await db.insert(maintenanceTicketEvents).values({
      ticketId: id,
      eventType: "photo_removed",
      description: `Photo removed`,
      actorId: req.user!.id,
    });
    return ok(res, { deleted: pid });
  },
);

export default router;
