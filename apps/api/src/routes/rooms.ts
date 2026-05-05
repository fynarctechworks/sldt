import {
  availabilityQuerySchema,
  roomCreateSchema,
  roomListQuerySchema,
  roomStatusUpdateSchema,
  roomUpdateSchema,
} from "@hoteldesk/shared";
import { and, eq } from "drizzle-orm";
import { Router } from "express";
import { db } from "../db/client.js";
import { rooms } from "../db/schema/rooms.js";
import { logActivity } from "../lib/activity.js";
import { findAvailableRooms } from "../lib/availability.js";
import { invalidateDashboard } from "../lib/redis.js";
import { fail, ok } from "../lib/response.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const router = Router();

router.get(
  "/availability",
  requireAuth,
  validate(availabilityQuerySchema, "query"),
  async (req, res) => {
    const { check_in, check_out } = req.query as unknown as {
      check_in: string;
      check_out: string;
    };
    const available = await findAvailableRooms(check_in, check_out);
    return ok(res, available);
  },
);

router.get("/", requireAuth, validate(roomListQuerySchema, "query"), async (req, res) => {
  const { floor, status, type } = req.query as Record<string, string | undefined>;
  const conditions = [];
  if (floor !== undefined) conditions.push(eq(rooms.floor, Number(floor)));
  if (status) conditions.push(eq(rooms.status, status as never));
  if (type) conditions.push(eq(rooms.roomType, type as never));

  const data = await db
    .select()
    .from(rooms)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(rooms.roomNumber);
  return ok(res, data);
});

router.get("/:id", requireAuth, async (req, res) => {
  const id = req.params.id!;
  const found = await db.select().from(rooms).where(eq(rooms.id, id)).limit(1);
  if (!found.length) return fail(res, 404, "NOT_FOUND", "Room not found");
  return ok(res, found[0]);
});

router.post("/", requireAuth, requireAdmin, validate(roomCreateSchema), async (req, res) => {
  const input = req.body;
  try {
    const [created] = await db
      .insert(rooms)
      .values({
        ...input,
        baseRate: String(input.baseRate),
      })
      .returning();
    await logActivity({
      action: "room_created",
      entityType: "room",
      entityId: created!.id,
      description: `Room ${created!.roomNumber} created`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    return ok(res, created, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return fail(res, 409, "DUPLICATE_ROOM", "Room number already exists");
    }
    throw err;
  }
});

router.put("/:id", requireAuth, requireAdmin, validate(roomUpdateSchema), async (req, res) => {
  const id = req.params.id!;
  const input = req.body;
  const update: Record<string, unknown> = { ...input, updatedAt: new Date() };
  if (input.baseRate !== undefined) update.baseRate = String(input.baseRate);

  const [updated] = await db.update(rooms).set(update).where(eq(rooms.id, id)).returning();
  if (!updated) return fail(res, 404, "NOT_FOUND", "Room not found");

  await logActivity({
    action: "room_updated",
    entityType: "room",
    entityId: id,
    description: `Room ${updated.roomNumber} updated`,
    performedBy: req.user!.id,
    ipAddress: req.ip,
  });
  return ok(res, updated);
});

router.patch(
  "/:id/status",
  requireAuth,
  validate(roomStatusUpdateSchema),
  async (req, res) => {
    const id = req.params.id!;
    const { status, reason } = req.body as { status: string; reason?: string };
    const [updated] = await db
      .update(rooms)
      .set({ status: status as never, updatedAt: new Date() })
      .where(eq(rooms.id, id))
      .returning();
    if (!updated) return fail(res, 404, "NOT_FOUND", "Room not found");

    await logActivity({
      action: "room_status_change",
      entityType: "room",
      entityId: id,
      description: `Room ${updated.roomNumber} → ${status}${reason ? ` (${reason})` : ""}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
      metadata: { status, reason },
    });
    await invalidateDashboard();
    return ok(res, updated);
  },
);

export default router;
