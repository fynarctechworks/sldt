import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { guests } from "../db/schema/guests.js";
import { reservationRooms, reservations } from "../db/schema/reservations.js";
import { rooms } from "../db/schema/rooms.js";
import { RESERVATION_BLOCKING_STATUSES } from "../db/schema/enums.js";
import { ok } from "../lib/response.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const router = Router();
const BLOCKING_STATUSES = [...RESERVATION_BLOCKING_STATUSES];

// month: "YYYY-MM". We expand it on the server into the day-range that
// captures every reservation that *touches* that month — i.e. anything whose
// stay overlaps [first-of-month, last-of-month].
const querySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
});

router.get(
  "/",
  requireAuth,
  requirePermission("view_reservations"),
  validate(querySchema, "query"),
  async (req, res) => {
    const { month } = req.query as unknown as z.infer<typeof querySchema>;

    // First & last calendar day of the requested month (no timezone math —
    // the property's local IST calendar is what staff see). yyyy-mm-dd
    // strings are sortable and compare cleanly against the `date` columns.
    const [y, m] = month.split("-").map(Number);
    const firstDay = `${month}-01`;
    // Day 0 of next month = last day of this month.
    const lastDate = new Date(y!, m!, 0).getDate();
    const lastDay = `${month}-${String(lastDate).padStart(2, "0")}`;

    // A reservation overlaps the month when:
    //   checkInDate  <= lastDay  AND  checkOutDate >= firstDay
    // Day-use (short_stay) bookings have checkInDate === checkOutDate, so
    // the same overlap check still works.
    const rows = await db
      .select({
        id: reservations.id,
        reservationNumber: reservations.reservationNumber,
        status: reservations.status,
        bookingSource: reservations.bookingSource,
        stayType: reservations.stayType,
        durationHours: reservations.durationHours,
        checkInDate: reservations.checkInDate,
        checkOutDate: reservations.checkOutDate,
        guestName: guests.fullName,
        roomNumbers: sql<string>`COALESCE((
          SELECT string_agg(${rooms.roomNumber}, ', ' ORDER BY ${rooms.roomNumber})
          FROM ${reservationRooms}
          JOIN ${rooms} ON ${rooms.id} = ${reservationRooms.roomId}
          WHERE ${reservationRooms.reservationId} = ${reservations.id}
        ), '')`,
      })
      .from(reservations)
      .innerJoin(guests, eq(guests.id, reservations.guestId))
      .where(
        and(
          lte(reservations.checkInDate, lastDay),
          gte(reservations.checkOutDate, firstDay),
        ),
      )
      .orderBy(reservations.checkInDate);

    return ok(res, {
      month,
      firstDay,
      lastDay,
      bookings: rows,
    });
  },
);

// Tape-chart endpoint. Returns:
//   - rooms: every room ordered by floor + number
//   - days:  every date in the requested range (yyyy-MM-dd)
//   - segments: one entry per (room, reservation) overlapping the range
//
// The frontend turns this into a grid: rooms on the Y axis, dates on
// the X axis, segment bars positioned by (startCol, span). Active
// reservation statuses only (BLOCKING + checked_out so departing
// guests are visible the morning of departure).
const tapeQuerySchema = z.object({
  // start + end are inclusive dates in yyyy-MM-dd. The client picks
  // a window (typically 14 or 30 days starting today).
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // optional floor filter for very large properties.
  floor: z.coerce.number().int().min(0).max(99).optional(),
});

router.get(
  "/tape",
  requireAuth,
  requirePermission("view_reservations"),
  validate(tapeQuerySchema, "query"),
  async (req, res) => {
    const { start, end, floor } = req.query as unknown as z.infer<typeof tapeQuerySchema>;

    if (end < start) {
      return ok(res, { start, end, rooms: [], days: [], segments: [] });
    }

    // Build the day list once, server-side, so the client doesn't need
    // to recompute it. Cap at 92 days (a quarter) to keep the payload
    // bounded — that's already 12+ months of practical window for
    // small hotels.
    const days: string[] = [];
    {
      const s = new Date(`${start}T00:00:00Z`);
      const e = new Date(`${end}T00:00:00Z`);
      const max = 92 * 86400 * 1000;
      const span = e.getTime() - s.getTime();
      const cappedE = span > max ? new Date(s.getTime() + max) : e;
      for (let d = new Date(s); d <= cappedE; d.setUTCDate(d.getUTCDate() + 1)) {
        days.push(d.toISOString().slice(0, 10));
      }
    }
    const lastDay = days[days.length - 1] ?? start;

    const roomFilter = floor !== undefined ? eq(rooms.floor, floor) : undefined;

    const roomRows = await db
      .select({
        id: rooms.id,
        roomNumber: rooms.roomNumber,
        floor: rooms.floor,
        roomType: rooms.roomType,
        status: rooms.status,
      })
      .from(rooms)
      .where(roomFilter)
      .orderBy(asc(rooms.floor), asc(rooms.roomNumber));

    // Pull every reservation_room whose parent reservation overlaps
    // the window. We include `checked_out` so the departure morning
    // tile is visible — useful for "is this room ready?" at a glance.
    const visibleStatuses: ("hold" | "pending_payment" | "confirmed" | "checked_in" | "checked_out")[] = [
      "hold",
      "pending_payment",
      "confirmed",
      "checked_in",
      "checked_out",
    ];
    const segments = roomRows.length
      ? await db
          .select({
            roomId: reservationRooms.roomId,
            reservationId: reservations.id,
            reservationNumber: reservations.reservationNumber,
            status: reservations.status,
            bookingSource: reservations.bookingSource,
            stayType: reservations.stayType,
            durationHours: reservations.durationHours,
            checkInDate: reservations.checkInDate,
            checkOutDate: reservations.checkOutDate,
            guestName: guests.fullName,
            isVip: guests.isVip,
          })
          .from(reservationRooms)
          .innerJoin(reservations, eq(reservations.id, reservationRooms.reservationId))
          .innerJoin(guests, eq(guests.id, reservations.guestId))
          .where(
            and(
              inArray(reservationRooms.roomId, roomRows.map((r) => r.id)),
              inArray(reservations.status, visibleStatuses),
              lte(reservations.checkInDate, lastDay),
              gte(reservations.checkOutDate, start),
            ),
          )
      : [];

    return ok(res, {
      start,
      end: lastDay,
      days,
      rooms: roomRows,
      segments,
    });
  },
);

export default router;
