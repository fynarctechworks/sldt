import { format } from "date-fns";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { Router } from "express";
import { db } from "../db/client.js";
import { activityLog } from "../db/schema/activity.js";
import { guests } from "../db/schema/guests.js";
import { payments } from "../db/schema/invoices.js";
import { profiles } from "../db/schema/profiles.js";
import { reservationRooms, reservations } from "../db/schema/reservations.js";
import { rooms } from "../db/schema/rooms.js";
import { logger } from "../lib/logger.js";
import { dashboardKey, redis } from "../lib/redis.js";
import { ok } from "../lib/response.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

const router = Router();
const TTL_SECONDS = 30;

async function buildDashboard() {
  const today = format(new Date(), "yyyy-MM-dd");
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [roomRows, occupiedRows, todaysCheckins, todaysCheckouts, revenueRow, activity] =
    await Promise.all([
      db.select().from(rooms).orderBy(rooms.floor, rooms.roomNumber),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(rooms)
        .where(eq(rooms.status, "occupied")),
      db
        .select({
          id: reservations.id,
          reservationNumber: reservations.reservationNumber,
          guestName: guests.fullName,
          status: reservations.status,
        })
        .from(reservations)
        .innerJoin(guests, eq(guests.id, reservations.guestId))
        .where(and(eq(reservations.checkInDate, today), eq(reservations.status, "confirmed"))),
      db
        .select({
          id: reservations.id,
          reservationNumber: reservations.reservationNumber,
          guestName: guests.fullName,
          status: reservations.status,
        })
        .from(reservations)
        .innerJoin(guests, eq(guests.id, reservations.guestId))
        .where(and(eq(reservations.checkOutDate, today), eq(reservations.status, "checked_in"))),
      db
        .select({ total: sql<string>`COALESCE(SUM(${payments.amount}), 0)::text` })
        .from(payments)
        .where(gte(payments.paymentDate, startOfDay)),
      db
        .select({
          action: activityLog.action,
          description: activityLog.description,
          performedBy: profiles.fullName,
          createdAt: activityLog.createdAt,
        })
        .from(activityLog)
        .innerJoin(profiles, eq(profiles.id, activityLog.performedBy))
        .orderBy(desc(activityLog.createdAt))
        .limit(10),
    ]);

  const occupiedCount = occupiedRows[0]?.count ?? 0;
  const total = roomRows.length;
  const percentage = total ? Math.round((occupiedCount / total) * 100) : 0;

  const roomResMap = new Map<
    string,
    { reservationId: string; guestName: string; resStatus: string }
  >();
  const liveReservations = await db
    .select({
      roomId: reservationRooms.roomId,
      reservationId: reservations.id,
      guestName: guests.fullName,
      resStatus: reservations.status,
    })
    .from(reservationRooms)
    .innerJoin(reservations, eq(reservations.id, reservationRooms.reservationId))
    .innerJoin(guests, eq(guests.id, reservations.guestId))
    .where(inArray(reservations.status, ["checked_in", "confirmed"]));
  for (const r of liveReservations) {
    // Prefer checked_in over confirmed when both exist
    const existing = roomResMap.get(r.roomId);
    if (!existing || (existing.resStatus !== "checked_in" && r.resStatus === "checked_in")) {
      roomResMap.set(r.roomId, {
        reservationId: r.reservationId,
        guestName: r.guestName,
        resStatus: r.resStatus,
      });
    }
  }

  return {
    occupancy: { occupied: occupiedCount, total, percentage },
    today_checkins: { count: todaysCheckins.length, reservations: todaysCheckins },
    today_checkouts: { count: todaysCheckouts.length, reservations: todaysCheckouts },
    revenue_today: { total_collected: Number(revenueRow[0]?.total ?? 0) },
    room_grid: roomRows.map((r) => {
      const live = roomResMap.get(r.id);
      const effectiveStatus = live
        ? live.resStatus === "checked_in"
          ? "occupied"
          : "reserved"
        : r.status;
      return {
        id: r.id,
        room_number: r.roomNumber,
        room_type: r.roomType,
        status: effectiveStatus,
        guest_name: live?.guestName ?? null,
        reservation_id: live?.reservationId ?? null,
      };
    }),
    recent_activity: activity,
  };
}

router.get("/", requireAuth, requirePermission("view_dashboard"), async (_req, res) => {
  try {
    const cached = await redis.get<string>(dashboardKey);
    if (cached) {
      const data = typeof cached === "string" ? JSON.parse(cached) : cached;
      return ok(res, data);
    }
  } catch (err) {
    logger.warn({ err }, "dashboard cache read failed");
  }

  const data = await buildDashboard();
  try {
    await redis.setex(dashboardKey, TTL_SECONDS, JSON.stringify(data));
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : err }, "dashboard cache write skipped");
  }
  return ok(res, data);
});

export default router;
