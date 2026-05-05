import { and, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { rooms } from "../db/schema/rooms.js";
import { logActivity } from "../lib/activity.js";
import { invalidateDashboard } from "../lib/redis.js";
import { fail, ok } from "../lib/response.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const router = Router();

const statusUpdate = z.object({
  status: z.enum(["dirty", "clean", "inspected", "available"]),
  reason: z.string().max(500).optional(),
});

const maintenanceFlag = z.object({
  reason: z.string().min(1).max(500),
});

router.get("/", requireAuth, async (req, res) => {
  const { floor, status } = req.query as Record<string, string | undefined>;
  const conditions = [];
  if (floor !== undefined) conditions.push(eq(rooms.floor, Number(floor)));
  if (status) conditions.push(eq(rooms.status, status as never));
  const rows = await db
    .select()
    .from(rooms)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(rooms.floor, rooms.roomNumber);
  return ok(res, rows);
});

router.patch("/:roomId", requireAuth, validate(statusUpdate), async (req, res) => {
  const roomId = req.params.roomId!;
  const { status, reason } = req.body as { status: string; reason?: string };

  const current = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1);
  if (!current.length) return fail(res, 404, "NOT_FOUND", "Room not found");
  const room = current[0]!;

  const validTransitions: Record<string, string[]> = {
    dirty: ["clean", "maintenance"],
    clean: ["inspected", "dirty"],
    inspected: ["available", "dirty"],
    available: ["dirty", "maintenance"],
    occupied: [],
    reserved: [],
    maintenance: ["available", "dirty"],
  };
  const allowed = validTransitions[room.status] ?? [];
  if (!allowed.includes(status)) {
    return fail(
      res,
      409,
      "INVALID_TRANSITION",
      `Cannot transition ${room.status} → ${status}`,
    );
  }

  const [updated] = await db
    .update(rooms)
    .set({ status: status as never, updatedAt: new Date() })
    .where(eq(rooms.id, roomId))
    .returning();

  await logActivity({
    action: "housekeeping_update",
    entityType: "room",
    entityId: roomId,
    description: `Room ${updated!.roomNumber}: ${room.status} → ${status}${reason ? ` (${reason})` : ""}`,
    performedBy: req.user!.id,
    ipAddress: req.ip,
  });
  await invalidateDashboard();
  return ok(res, updated);
});

router.post(
  "/:roomId/maintenance",
  requireAuth,
  validate(maintenanceFlag),
  async (req, res) => {
    const roomId = req.params.roomId!;
    const { reason } = req.body as { reason: string };
    const [updated] = await db
      .update(rooms)
      .set({ status: "maintenance", notes: reason, updatedAt: new Date() })
      .where(eq(rooms.id, roomId))
      .returning();
    if (!updated) return fail(res, 404, "NOT_FOUND", "Room not found");

    await logActivity({
      action: "maintenance_flagged",
      entityType: "room",
      entityId: roomId,
      description: `Room ${updated.roomNumber} flagged: ${reason}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    await invalidateDashboard();
    return ok(res, updated);
  },
);

router.post("/:roomId/resolve", requireAuth, requireAdmin, async (req, res) => {
  const roomId = req.params.roomId!;
  const [updated] = await db
    .update(rooms)
    .set({ status: "dirty", updatedAt: new Date() })
    .where(eq(rooms.id, roomId))
    .returning();
  if (!updated) return fail(res, 404, "NOT_FOUND", "Room not found");

  await logActivity({
    action: "maintenance_resolved",
    entityType: "room",
    entityId: roomId,
    description: `Room ${updated.roomNumber} maintenance resolved`,
    performedBy: req.user!.id,
    ipAddress: req.ip,
  });
  await invalidateDashboard();
  return ok(res, updated);
});

export default router;
