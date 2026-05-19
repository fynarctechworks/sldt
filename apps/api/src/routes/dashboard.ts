import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
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
import { getSettings } from "../lib/settings.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { hasPermission } from "../lib/permission-resolver.js";

const router = Router();
const TTL_SECONDS = 30;

// Single-property hotel in Sabbavaram (IST). The "today" used for
// check-in/check-out matching MUST be the property's local date, otherwise
// when the API runs in UTC (Render/Vercel/Docker) the panels will be wrong
// for ~5.5 hours each morning.
const PROPERTY_TIMEZONE = "Asia/Kolkata";

function propertyToday(): string {
  // en-CA gives yyyy-MM-dd reliably across runtimes.
  return new Date().toLocaleDateString("en-CA", { timeZone: PROPERTY_TIMEZONE });
}

function propertyStartOfDay(): Date {
  // Start-of-day in IST, expressed as an absolute Date. We do this by
  // taking the IST date string, treating it as midnight in IST, then
  // converting to the equivalent UTC instant.
  const istDate = propertyToday(); // yyyy-MM-dd in IST
  // IST is UTC+05:30, so IST midnight === previous-day 18:30 UTC.
  return new Date(`${istDate}T00:00:00+05:30`);
}

async function buildDashboard() {
  const today = propertyToday();
  const startOfDay = propertyStartOfDay();
  const settings = await getSettings();

  const [
    roomRows,
    occupiedRows,
    todaysCheckins,
    todaysCheckouts,
    overdue,
    revenueRow,
    activity,
    upcomingCheckoutRows,
  ] = await Promise.all([
      db.select().from(rooms).orderBy(rooms.floor, rooms.roomNumber),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(rooms)
        .where(eq(rooms.status, "occupied")),
      // "Arriving today" — every reservation whose check-in date is today
      // and isn't cancelled/no-show. Includes already-checked-in so staff
      // can see "they did arrive" rather than the row vanishing the moment
      // someone hits the check-in button. room_numbers is a comma-joined
      // list because a single reservation can span multiple rooms.
      db
        .select({
          id: reservations.id,
          reservationNumber: reservations.reservationNumber,
          guestName: guests.fullName,
          status: reservations.status,
          roomNumbers: sql<string>`COALESCE((
            SELECT string_agg(${rooms.roomNumber}, ',' ORDER BY ${rooms.roomNumber})
            FROM ${reservationRooms}
            JOIN ${rooms} ON ${rooms.id} = ${reservationRooms.roomId}
            WHERE ${reservationRooms.reservationId} = ${reservations.id}
          ), '')`,
        })
        .from(reservations)
        .innerJoin(guests, eq(guests.id, reservations.guestId))
        .where(
          and(
            eq(reservations.checkInDate, today),
            inArray(reservations.status, ["confirmed", "checked_in"]),
          ),
        ),
      // "Leaving today" — every reservation whose check-out date is today
      // and isn't cancelled/no-show. Includes already-checked-out for the
      // same reason as above.
      db
        .select({
          id: reservations.id,
          reservationNumber: reservations.reservationNumber,
          guestName: guests.fullName,
          status: reservations.status,
          roomNumbers: sql<string>`COALESCE((
            SELECT string_agg(${rooms.roomNumber}, ',' ORDER BY ${rooms.roomNumber})
            FROM ${reservationRooms}
            JOIN ${rooms} ON ${rooms.id} = ${reservationRooms.roomId}
            WHERE ${reservationRooms.reservationId} = ${reservations.id}
          ), '')`,
        })
        .from(reservations)
        .innerJoin(guests, eq(guests.id, reservations.guestId))
        .where(
          and(
            eq(reservations.checkOutDate, today),
            inArray(reservations.status, ["checked_in", "checked_out"]),
          ),
        ),
      db
        .select({
          id: reservations.id,
          reservationNumber: reservations.reservationNumber,
          guestName: guests.fullName,
          status: reservations.status,
          checkOutDate: reservations.checkOutDate,
        })
        .from(reservations)
        .innerJoin(guests, eq(guests.id, reservations.guestId))
        .where(and(lt(reservations.checkOutDate, today), eq(reservations.status, "checked_in"))),
      // Revenue today — payments received today on non-complimentary
      // reservations only. Comp bookings live in Reports → Complimentary;
      // their cash flow is intentionally excluded from "real revenue".
      db
        .select({ total: sql<string>`COALESCE(SUM(${payments.amount}), 0)::text` })
        .from(payments)
        .innerJoin(reservations, eq(reservations.id, payments.reservationId))
        .where(
          and(
            gte(payments.paymentDate, startOfDay),
            eq(payments.voided, false),
            eq(payments.status, "received"),
            sql`${reservations.bookingSource} <> 'complimentary'`,
          ),
        ),
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
      // Upcoming check-outs — every reservation that is checked_in and is
      // supposed to leave today. We pull the per-reservation late-checkout
      // grant so the client can compute an accurate effective check-out
      // datetime (hotel default + extension). Rooms are joined as a
      // comma-list for display.
      db
        .select({
          id: reservations.id,
          reservationNumber: reservations.reservationNumber,
          guestName: guests.fullName,
          checkInDate: reservations.checkInDate,
          checkOutDate: reservations.checkOutDate,
          stayType: reservations.stayType,
          durationHours: reservations.durationHours,
          checkedInAt: reservations.checkedInAt,
          lateCheckoutHours: reservations.lateCheckoutHours,
          roomNumbers: sql<string>`COALESCE((
            SELECT string_agg(${rooms.roomNumber}, ',' ORDER BY ${rooms.roomNumber})
            FROM ${reservationRooms}
            JOIN ${rooms} ON ${rooms.id} = ${reservationRooms.roomId}
            WHERE ${reservationRooms.reservationId} = ${reservations.id}
          ), '')`,
        })
        .from(reservations)
        .innerJoin(guests, eq(guests.id, reservations.guestId))
        .where(
          and(
            eq(reservations.checkOutDate, today),
            eq(reservations.status, "checked_in"),
          ),
        ),
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
    overdue: {
      count: overdue.length,
      reservations: overdue.map((o) => ({
        id: o.id,
        reservationNumber: o.reservationNumber,
        guestName: o.guestName,
        status: o.status,
        checkOutDate: o.checkOutDate,
        daysOverdue: Math.max(
          0,
          Math.floor(
            (new Date(today + "T00:00:00").getTime() - new Date(o.checkOutDate + "T00:00:00").getTime()) /
              86400000,
          ),
        ),
      })),
    },
    // Upcoming check-outs for today — used by the front-desk's checkout
    // alert bar. For overnight stays the effective time is the hotel's
    // default checkOutTime + any lateCheckoutHours grant. For short_stay
    // (day-use) the effective time is checkedInAt + durationHours, or, if
    // not yet checked in, checkInDate + checkInTime + durationHours. All
    // computed in IST so the client just renders the ISO string.
    upcoming_checkouts: upcomingCheckoutRows.map((u) => {
      const isShortStay = u.stayType === "short_stay";
      let effectiveMs: number;
      if (isShortStay) {
        const durMs = Math.round(Number(u.durationHours ?? 0) * 3600 * 1000);
        const startMs = u.checkedInAt
          ? new Date(u.checkedInAt).getTime()
          : (() => {
              const [ch, cm] = (settings.checkInTime ?? "12:00").split(":");
              return new Date(
                `${u.checkInDate}T${(ch ?? "12").padStart(2, "0")}:${(cm ?? "00").padStart(2, "0")}:00+05:30`,
              ).getTime();
            })();
        effectiveMs = startMs + durMs;
      } else {
        const [hh, mm] = (settings.checkOutTime ?? "11:00").split(":");
        const baseMs = new Date(
          `${u.checkOutDate}T${(hh ?? "11").padStart(2, "0")}:${(mm ?? "00").padStart(2, "0")}:00+05:30`,
        ).getTime();
        const extraMs = Math.round(Number(u.lateCheckoutHours ?? 0) * 3600 * 1000);
        effectiveMs = baseMs + extraMs;
      }
      return {
        id: u.id,
        reservationNumber: u.reservationNumber,
        guestName: u.guestName,
        roomNumbers: u.roomNumbers,
        stayType: u.stayType,
        durationHours: u.durationHours ? Number(u.durationHours) : null,
        lateCheckoutHours: Number(u.lateCheckoutHours ?? 0),
        effectiveCheckoutAt: new Date(effectiveMs).toISOString(),
      };
    }),
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

router.get("/", requireAuth, requirePermission("view_dashboard"), async (req, res) => {
  // Cache key is always the full payload (with revenue). Per-request we
  // strip the revenue field if the caller lacks `view_revenue`, so two
  // staff with different perms hit the same cache entry. Stripping is
  // cheap; keeping two cache variants would invalidate twice.
  const canSeeRevenue = hasPermission(req.user!, "view_revenue");

  try {
    const cached = await redis.get<string>(dashboardKey);
    if (cached) {
      const data = typeof cached === "string" ? JSON.parse(cached) : cached;
      return ok(res, canSeeRevenue ? data : stripRevenue(data));
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
  return ok(res, canSeeRevenue ? data : stripRevenue(data));
});

// Remove revenue-bearing fields so they never leave the server for users
// without `view_revenue`. Currently the only field is revenue_today; if we
// add more (collected-by-method, outstanding aggregates, etc.) extend here.
function stripRevenue<T extends { revenue_today?: unknown }>(data: T): Omit<T, "revenue_today"> {
  const { revenue_today: _omit, ...rest } = data;
  return rest;
}

export default router;
