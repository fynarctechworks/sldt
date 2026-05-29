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

// First IST instant of the current calendar month — used to scope the
// MTD revenue + ADR/RevPAR window. We rely on the IST date string so
// the calculation stays correct regardless of the server timezone.
function propertyStartOfMonth(): Date {
  const istToday = propertyToday();
  const firstOfMonth = `${istToday.slice(0, 7)}-01`;
  return new Date(`${firstOfMonth}T00:00:00+05:30`);
}

// IST yyyy-MM-dd N days from the property's "today" — positive N for
// future dates (forecast), negative for the past. Useful as inclusive
// upper bounds in date comparisons (which are pure strings).
function propertyDateOffset(days: number): string {
  const todayIst = propertyToday();
  const base = new Date(`${todayIst}T00:00:00+05:30`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toLocaleDateString("en-CA", { timeZone: PROPERTY_TIMEZONE });
}

async function buildDashboard() {
  const today = propertyToday();
  const startOfDay = propertyStartOfDay();
  const startOfMonth = propertyStartOfMonth();
  // 7-day forecast window. Inclusive on both ends. The "next 7 days"
  // means today + 6 in standard calendar talk.
  const forecastEnd = propertyDateOffset(6);
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
    mtdRevenueRow,
    mtdRoomNightsRow,
    forecastRows,
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
          // Each "slot" on a reservation is either:
          //   - one unsegmented reservation_rooms row → emit roomNumber
          //   - one or more rows sharing a swap_id (mid-stay swap) →
          //     collapse to "OLD→NEW" ordered by effective_from
          // Slots are then comma-joined for display.
          // Each "slot" on a reservation is either:
          //   - one unsegmented reservation_rooms row → emit roomNumber
          //   - one or more rows sharing a swap_id (mid-stay swap) →
          //     collapse to "OLD→NEW" ordered by effective_from
          // For swap groups we pick the earliest-created row as the
          // canonical representative to avoid duplicating the slot.
          // Slots are then comma-joined for display.
          roomNumbers: sql<string>`COALESCE((
            SELECT string_agg(slot_label, ',' ORDER BY slot_label)
            FROM (
              SELECT
                CASE
                  WHEN rr.swap_id IS NULL THEN r.room_number
                  ELSE (
                    SELECT string_agg(r2.room_number, '→' ORDER BY rr2.effective_from NULLS FIRST)
                    FROM reservation_rooms rr2
                    JOIN rooms r2 ON r2.id = rr2.room_id
                    WHERE rr2.swap_id = rr.swap_id
                  )
                END AS slot_label
              FROM reservation_rooms rr
              JOIN rooms r ON r.id = rr.room_id
              WHERE rr.reservation_id = ${reservations.id}
                AND (
                  rr.swap_id IS NULL
                  OR rr.created_at = (
                    SELECT MIN(rr3.created_at)
                    FROM reservation_rooms rr3
                    WHERE rr3.swap_id = rr.swap_id
                  )
                )
            ) slots
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
          // Each "slot" on a reservation is either:
          //   - one unsegmented reservation_rooms row → emit roomNumber
          //   - one or more rows sharing a swap_id (mid-stay swap) →
          //     collapse to "OLD→NEW" ordered by effective_from
          // Slots are then comma-joined for display.
          // Each "slot" on a reservation is either:
          //   - one unsegmented reservation_rooms row → emit roomNumber
          //   - one or more rows sharing a swap_id (mid-stay swap) →
          //     collapse to "OLD→NEW" ordered by effective_from
          // For swap groups we pick the earliest-created row as the
          // canonical representative to avoid duplicating the slot.
          // Slots are then comma-joined for display.
          roomNumbers: sql<string>`COALESCE((
            SELECT string_agg(slot_label, ',' ORDER BY slot_label)
            FROM (
              SELECT
                CASE
                  WHEN rr.swap_id IS NULL THEN r.room_number
                  ELSE (
                    SELECT string_agg(r2.room_number, '→' ORDER BY rr2.effective_from NULLS FIRST)
                    FROM reservation_rooms rr2
                    JOIN rooms r2 ON r2.id = rr2.room_id
                    WHERE rr2.swap_id = rr.swap_id
                  )
                END AS slot_label
              FROM reservation_rooms rr
              JOIN rooms r ON r.id = rr.room_id
              WHERE rr.reservation_id = ${reservations.id}
                AND (
                  rr.swap_id IS NULL
                  OR rr.created_at = (
                    SELECT MIN(rr3.created_at)
                    FROM reservation_rooms rr3
                    WHERE rr3.swap_id = rr.swap_id
                  )
                )
            ) slots
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
          entityType: activityLog.entityType,
          entityId: activityLog.entityId,
          // For reservation activities, join the room numbers so the UI can
          // show "RES-0031 (Room 302) checked in" instead of just the
          // reservation number. NULL for non-reservation activities.
          roomNumbers: sql<string | null>`(
            SELECT string_agg(${rooms.roomNumber}, ', ' ORDER BY ${rooms.roomNumber})
            FROM ${reservationRooms}
            INNER JOIN ${rooms} ON ${rooms.id} = ${reservationRooms.roomId}
            WHERE ${activityLog.entityType} = 'reservation'
              AND ${reservationRooms.reservationId} = ${activityLog.entityId}::uuid
          )`,
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
          // Each "slot" on a reservation is either:
          //   - one unsegmented reservation_rooms row → emit roomNumber
          //   - one or more rows sharing a swap_id (mid-stay swap) →
          //     collapse to "OLD→NEW" ordered by effective_from
          // Slots are then comma-joined for display.
          // Each "slot" on a reservation is either:
          //   - one unsegmented reservation_rooms row → emit roomNumber
          //   - one or more rows sharing a swap_id (mid-stay swap) →
          //     collapse to "OLD→NEW" ordered by effective_from
          // For swap groups we pick the earliest-created row as the
          // canonical representative to avoid duplicating the slot.
          // Slots are then comma-joined for display.
          roomNumbers: sql<string>`COALESCE((
            SELECT string_agg(slot_label, ',' ORDER BY slot_label)
            FROM (
              SELECT
                CASE
                  WHEN rr.swap_id IS NULL THEN r.room_number
                  ELSE (
                    SELECT string_agg(r2.room_number, '→' ORDER BY rr2.effective_from NULLS FIRST)
                    FROM reservation_rooms rr2
                    JOIN rooms r2 ON r2.id = rr2.room_id
                    WHERE rr2.swap_id = rr.swap_id
                  )
                END AS slot_label
              FROM reservation_rooms rr
              JOIN rooms r ON r.id = rr.room_id
              WHERE rr.reservation_id = ${reservations.id}
                AND (
                  rr.swap_id IS NULL
                  OR rr.created_at = (
                    SELECT MIN(rr3.created_at)
                    FROM reservation_rooms rr3
                    WHERE rr3.swap_id = rr.swap_id
                  )
                )
            ) slots
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
      // Month-to-date collected revenue. Same exclusions as revenue
      // today (received, non-voided, non-complimentary). Drives the
      // MTD KPI card; rolling forward into "this calendar month" so
      // it resets cleanly on the 1st.
      db
        .select({ total: sql<string>`COALESCE(SUM(${payments.amount}), 0)::text` })
        .from(payments)
        .innerJoin(reservations, eq(reservations.id, payments.reservationId))
        .where(
          and(
            gte(payments.paymentDate, startOfMonth),
            eq(payments.voided, false),
            eq(payments.status, "received"),
            sql`${reservations.bookingSource} <> 'complimentary'`,
          ),
        ),
      // Room nights sold MTD (used for ADR + RevPAR). A "room night"
      // is one reservation_rooms row per night of stay within the
      // current month. We compute via the parent reservation's date
      // range clipped to [startOfMonth, today]. Cancelled / no-show
      // don't count.
      db
        .select({
          revenue: sql<string>`COALESCE(SUM(CAST(${reservationRooms.ratePerNight} AS NUMERIC) * GREATEST(0, LEAST(${reservations.checkOutDate}, ${today}::date) - GREATEST(${reservations.checkInDate}, ${sql.raw(`'${propertyToday().slice(0, 7)}-01'::date`)}))), 0)::text`,
          nights: sql<number>`COALESCE(SUM(GREATEST(0, LEAST(${reservations.checkOutDate}, ${today}::date) - GREATEST(${reservations.checkInDate}, ${sql.raw(`'${propertyToday().slice(0, 7)}-01'::date`)}))), 0)::int`,
        })
        .from(reservationRooms)
        .innerJoin(reservations, eq(reservations.id, reservationRooms.reservationId))
        .where(
          and(
            inArray(reservations.status, ["confirmed", "checked_in", "checked_out"]),
            sql`${reservations.bookingSource} <> 'complimentary'`,
            // Reservation must touch the current month at all.
            lt(reservations.checkInDate, today),
          ),
        ),
      // 7-day forecast: per-day count of reservations occupying a
      // room. We unnest a generate_series over the window and join
      // against reservation_rooms whose parent overlaps the day. The
      // result is one row per day with a `count`.
      db.execute<{ day: string; occupied: number; arrivals: number }>(
        sql`
          WITH days AS (
            SELECT generate_series(
              ${today}::date,
              ${forecastEnd}::date,
              interval '1 day'
            )::date AS d
          )
          SELECT
            to_char(d, 'YYYY-MM-DD') AS day,
            COALESCE((
              SELECT COUNT(DISTINCT rr.room_id)::int
              FROM reservation_rooms rr
              JOIN reservations r ON r.id = rr.reservation_id
              WHERE r.status IN ('confirmed','checked_in','hold','pending_payment')
                AND daterange(r.check_in_date, GREATEST(r.check_out_date, r.check_in_date + 1), '[)')
                    @> d
            ), 0) AS occupied,
            COALESCE((
              SELECT COUNT(*)::int
              FROM reservations r
              WHERE r.status IN ('confirmed','checked_in','hold','pending_payment')
                AND r.check_in_date = d
            ), 0) AS arrivals
          FROM days
          ORDER BY d
        `,
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
    // Industry-standard hospitality KPIs.
    //   MTD revenue   = total collected since the 1st of this month.
    //   ADR           = room revenue / room nights sold (this month).
    //                   Tells the operator the average price they got
    //                   per occupied room — the price lever.
    //   RevPAR        = room revenue / available room-nights so far.
    //                   The single most important PMS metric: combines
    //                   ADR and occupancy into one number. Compared
    //                   month-over-month to gauge true performance.
    //
    // We compute "available room-nights so far" as total_rooms × days
    // elapsed this month (inclusive of today). Maintenance days are
    // not subtracted — the textbook definition keeps the denominator
    // simple. If we ever want "available excluding OOO", we'd subtract
    // OOO-days here.
    revenue_kpis: (() => {
      const mtdRevenue = Number(mtdRevenueRow[0]?.total ?? 0);
      const roomNights = Number(mtdRoomNightsRow[0]?.nights ?? 0);
      const roomRevenue = Number(mtdRoomNightsRow[0]?.revenue ?? 0);
      const totalRooms = roomRows.length;
      const dayOfMonth = Number(today.slice(-2));
      const availableRoomNights = totalRooms * dayOfMonth;
      const adr = roomNights > 0 ? roomRevenue / roomNights : 0;
      const revpar = availableRoomNights > 0 ? roomRevenue / availableRoomNights : 0;
      return {
        mtd_collected: +mtdRevenue.toFixed(2),
        mtd_room_revenue: +roomRevenue.toFixed(2),
        mtd_room_nights: roomNights,
        adr: +adr.toFixed(2),
        revpar: +revpar.toFixed(2),
      };
    })(),
    // 7-day occupancy + arrivals forecast. Drives the "next week"
    // strip on the dashboard. % is computed client-side so we don't
    // also have to plumb totalRooms into every row.
    forecast: {
      total_rooms: roomRows.length,
      days: (forecastRows as unknown as { day: string; occupied: number; arrivals: number }[]).map(
        (r) => ({
          day: r.day,
          occupied: Number(r.occupied),
          arrivals: Number(r.arrivals),
        }),
      ),
    },
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
    recent_activity: activity.map((a) => ({
      action: a.action,
      performedBy: a.performedBy,
      createdAt: a.createdAt,
      description: a.roomNumbers
        ? `${a.description} (Room ${a.roomNumbers})`
        : a.description,
    })),
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
// without `view_revenue`. Phase 1 added revenue_kpis (MTD/ADR/RevPAR);
// strip those alongside revenue_today. Forecast is occupancy-only with
// no money, so it stays visible to everyone (housekeeping needs it too).
function stripRevenue<T extends { revenue_today?: unknown; revenue_kpis?: unknown }>(
  data: T,
): Omit<T, "revenue_today" | "revenue_kpis"> {
  const { revenue_today: _r1, revenue_kpis: _r2, ...rest } = data;
  void _r1;
  void _r2;
  return rest;
}

export default router;
