// Group bookings (Phase 2 — Revenue & Operations).
//
// A "group block" is the master confirmation; "rooming list" is its
// list of per-room entries. Promoting a rooming-list row to a real
// reservation happens via POST /group-blocks/:id/rooms/:rowId/promote.
//
// Endpoints:
//   GET    /group-blocks                            — list
//   POST   /group-blocks                            — create master
//   GET    /group-blocks/:id                        — detail with rooming list
//   PATCH  /group-blocks/:id                        — meta edit / status flip
//   POST   /group-blocks/:id/rooms                  — add row to rooming list
//   POST   /group-blocks/:id/rooms/bulk             — bulk add rows
//   PATCH  /group-blocks/:id/rooms/:rowId           — edit row
//   DELETE /group-blocks/:id/rooms/:rowId           — remove row
//   POST   /group-blocks/:id/rooms/:rowId/release   — release back to inventory

import {
  groupBlockCreateSchema,
  groupBlockUpdateSchema,
  groupRoomBulkCreateSchema,
  groupRoomCreateSchema,
} from "@hoteldesk/shared";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { groupBlockRooms, groupBlocks } from "../db/schema/groupBookings.js";
import { rooms } from "../db/schema/rooms.js";
import { logActivity } from "../lib/activity.js";
import { resolveCurrentPropertyId } from "../lib/currentProperty.js";
import { fail, list, ok } from "../lib/response.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const router = Router();

router.get(
  "/",
  requireAuth,
  requirePermission("view_groups"),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const rows = await db
      .select()
      .from(groupBlocks)
      .where(eq(groupBlocks.propertyId, propertyId))
      .orderBy(desc(groupBlocks.blockStartDate));
    return list(res, rows, { total: rows.length, page: 1, per_page: rows.length });
  },
);

router.post(
  "/",
  requireAuth,
  requirePermission("manage_groups"),
  validate(groupBlockCreateSchema),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const input = req.body as z.infer<typeof groupBlockCreateSchema>;
    if (new Date(input.blockEndDate) <= new Date(input.blockStartDate)) {
      return fail(res, 400, "INVALID_DATES", "block_end_date must be after block_start_date");
    }
    try {
      const [created] = await db
        .insert(groupBlocks)
        .values({
          propertyId,
          groupCode: input.groupCode.toUpperCase(),
          groupName: input.groupName,
          contactName: input.contactName ?? null,
          contactPhone: input.contactPhone ?? null,
          contactEmail: input.contactEmail ?? null,
          companyId: input.companyId ?? null,
          ratePlanId: input.ratePlanId ?? null,
          blockStartDate: input.blockStartDate,
          blockEndDate: input.blockEndDate,
          cutoffDate: input.cutoffDate ?? null,
          notes: input.notes ?? null,
          createdBy: req.user!.id,
        })
        .returning();
      await logActivity({
        action: "group_block_created",
        entityType: "group_block",
        entityId: created!.id,
        description: `${created!.groupCode} (${created!.groupName})`,
        performedBy: req.user!.id,
        ipAddress: req.ip,
      });
      return ok(res, created, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown";
      if (msg.includes("group_blocks_code_per_property")) {
        return fail(res, 409, "DUPLICATE_CODE", "A group with that code already exists");
      }
      throw err;
    }
  },
);

router.get(
  "/:id",
  requireAuth,
  requirePermission("view_groups"),
  async (req, res) => {
    const id = req.params.id!;
    const propertyId = await resolveCurrentPropertyId(req);
    const [block] = await db
      .select()
      .from(groupBlocks)
      .where(and(eq(groupBlocks.id, id), eq(groupBlocks.propertyId, propertyId)))
      .limit(1);
    if (!block) return fail(res, 404, "NOT_FOUND", "Group block not found");

    const roomingList = await db
      .select({
        row: groupBlockRooms,
        roomNumber: rooms.roomNumber,
      })
      .from(groupBlockRooms)
      .leftJoin(rooms, eq(rooms.id, groupBlockRooms.roomId))
      .where(eq(groupBlockRooms.groupBlockId, id))
      .orderBy(asc(groupBlockRooms.guestName));
    return ok(res, {
      ...block,
      roomingList: roomingList.map((r) => ({ ...r.row, roomNumber: r.roomNumber })),
    });
  },
);

router.patch(
  "/:id",
  requireAuth,
  requirePermission("manage_groups"),
  validate(groupBlockUpdateSchema),
  async (req, res) => {
    const id = req.params.id!;
    const propertyId = await resolveCurrentPropertyId(req);
    const patch = req.body as z.infer<typeof groupBlockUpdateSchema>;
    const updateData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      updateData[k] = v;
    }
    if (updateData.groupCode && typeof updateData.groupCode === "string") {
      updateData.groupCode = (updateData.groupCode as string).toUpperCase();
    }
    const [updated] = await db
      .update(groupBlocks)
      .set(updateData)
      .where(and(eq(groupBlocks.id, id), eq(groupBlocks.propertyId, propertyId)))
      .returning();
    if (!updated) return fail(res, 404, "NOT_FOUND", "Group block not found");
    return ok(res, updated);
  },
);

router.post(
  "/:id/rooms",
  requireAuth,
  requirePermission("manage_groups"),
  validate(groupRoomCreateSchema),
  async (req, res) => {
    const id = req.params.id!;
    const propertyId = await resolveCurrentPropertyId(req);
    const input = req.body as z.infer<typeof groupRoomCreateSchema>;
    const [block] = await db
      .select({ id: groupBlocks.id })
      .from(groupBlocks)
      .where(and(eq(groupBlocks.id, id), eq(groupBlocks.propertyId, propertyId)))
      .limit(1);
    if (!block) return fail(res, 404, "NOT_FOUND", "Group block not found");

    const [row] = await db
      .insert(groupBlockRooms)
      .values({
        groupBlockId: id,
        roomType: input.roomType ?? null,
        roomId: input.roomId ?? null,
        guestName: input.guestName ?? null,
        guestPhone: input.guestPhone ?? null,
        guestEmail: input.guestEmail ?? null,
        ratePerNight: input.ratePerNight == null ? null : String(input.ratePerNight),
        numAdults: input.numAdults,
        numChildren: input.numChildren,
        notes: input.notes ?? null,
      })
      .returning();
    return ok(res, row, 201);
  },
);

router.post(
  "/:id/rooms/bulk",
  requireAuth,
  requirePermission("manage_groups"),
  validate(groupRoomBulkCreateSchema),
  async (req, res) => {
    const id = req.params.id!;
    const propertyId = await resolveCurrentPropertyId(req);
    const input = req.body as z.infer<typeof groupRoomBulkCreateSchema>;
    const [block] = await db
      .select({ id: groupBlocks.id })
      .from(groupBlocks)
      .where(and(eq(groupBlocks.id, id), eq(groupBlocks.propertyId, propertyId)))
      .limit(1);
    if (!block) return fail(res, 404, "NOT_FOUND", "Group block not found");

    const values = input.rows.map((r) => ({
      groupBlockId: id,
      roomType: r.roomType ?? null,
      roomId: r.roomId ?? null,
      guestName: r.guestName ?? null,
      guestPhone: r.guestPhone ?? null,
      guestEmail: r.guestEmail ?? null,
      ratePerNight: r.ratePerNight == null ? null : String(r.ratePerNight),
      numAdults: r.numAdults,
      numChildren: r.numChildren,
      notes: r.notes ?? null,
    }));
    const inserted = await db.insert(groupBlockRooms).values(values).returning();
    return ok(res, inserted, 201);
  },
);

const roomingRowUpdateSchema = z.object({
  roomType: z.string().min(1).max(60).nullable().optional(),
  roomId: z.string().uuid().nullable().optional(),
  guestName: z.string().min(2).max(120).nullable().optional(),
  guestPhone: z.string().max(20).nullable().optional(),
  guestEmail: z.string().email().nullable().optional(),
  ratePerNight: z.coerce.number().min(0).max(10_000_000).nullable().optional(),
  numAdults: z.coerce.number().int().min(1).max(10).optional(),
  numChildren: z.coerce.number().int().min(0).max(10).optional(),
  notes: z.string().max(500).nullable().optional(),
  status: z.enum(["pending", "confirmed", "no_show", "released", "cancelled"]).optional(),
});

router.patch(
  "/:id/rooms/:rowId",
  requireAuth,
  requirePermission("manage_groups"),
  validate(roomingRowUpdateSchema),
  async (req, res) => {
    const { id, rowId } = req.params as { id: string; rowId: string };
    const propertyId = await resolveCurrentPropertyId(req);
    const patch = req.body as z.infer<typeof roomingRowUpdateSchema>;
    // Confirm the row belongs to this group + property.
    const [row] = await db
      .select({ id: groupBlockRooms.id })
      .from(groupBlockRooms)
      .innerJoin(groupBlocks, eq(groupBlocks.id, groupBlockRooms.groupBlockId))
      .where(
        and(
          eq(groupBlockRooms.id, rowId),
          eq(groupBlockRooms.groupBlockId, id),
          eq(groupBlocks.propertyId, propertyId),
        ),
      )
      .limit(1);
    if (!row) return fail(res, 404, "NOT_FOUND", "Row not found");
    const updateData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      if (k === "ratePerNight") updateData[k] = v == null ? null : String(v);
      else updateData[k] = v;
    }
    const [updated] = await db
      .update(groupBlockRooms)
      .set(updateData)
      .where(eq(groupBlockRooms.id, rowId))
      .returning();
    return ok(res, updated);
  },
);

router.delete(
  "/:id/rooms/:rowId",
  requireAuth,
  requirePermission("manage_groups"),
  async (req, res) => {
    const { id, rowId } = req.params as { id: string; rowId: string };
    const propertyId = await resolveCurrentPropertyId(req);
    const [block] = await db
      .select({ id: groupBlocks.id })
      .from(groupBlocks)
      .where(and(eq(groupBlocks.id, id), eq(groupBlocks.propertyId, propertyId)))
      .limit(1);
    if (!block) return fail(res, 404, "NOT_FOUND", "Group block not found");
    const [deleted] = await db
      .delete(groupBlockRooms)
      .where(and(eq(groupBlockRooms.id, rowId), eq(groupBlockRooms.groupBlockId, id)))
      .returning();
    if (!deleted) return fail(res, 404, "NOT_FOUND", "Row not found");
    return ok(res, { deleted: rowId });
  },
);

router.post(
  "/:id/rooms/:rowId/release",
  requireAuth,
  requirePermission("manage_groups"),
  async (req, res) => {
    const { id, rowId } = req.params as { id: string; rowId: string };
    const [updated] = await db
      .update(groupBlockRooms)
      .set({ status: "released", roomId: null })
      .where(and(eq(groupBlockRooms.id, rowId), eq(groupBlockRooms.groupBlockId, id)))
      .returning();
    if (!updated) return fail(res, 404, "NOT_FOUND", "Row not found");
    return ok(res, updated);
  },
);

export default router;
