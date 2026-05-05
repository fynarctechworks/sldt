import { endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import { and, desc, eq, gte, lte, ne, sql } from "drizzle-orm";
import { Router } from "express";
import { db } from "../db/client.js";
import { guests } from "../db/schema/guests.js";
import { invoices, payments } from "../db/schema/invoices.js";
import { reservationRooms, reservations } from "../db/schema/reservations.js";
import { rooms } from "../db/schema/rooms.js";
import { ok } from "../lib/response.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

const router = Router();

function rangeDefaults(req: { query: Record<string, string | undefined> }) {
  const from = req.query.date_from ? parseISO(req.query.date_from) : startOfMonth(new Date());
  const to = req.query.date_to ? parseISO(req.query.date_to) : endOfMonth(new Date());
  return { from, to };
}

router.get("/occupancy", requireAuth, requireAdmin, async (req, res) => {
  const { from, to } = rangeDefaults(req as never);
  const totalRooms = (await db.select({ c: sql<number>`count(*)::int` }).from(rooms))[0]!.c;

  const rows = await db.execute<{ day: string; occupied: number }>(sql`
    SELECT gs::date::text as day,
      (SELECT count(*)::int FROM ${reservationRooms} rr
       INNER JOIN ${reservations} r ON r.id = rr.reservation_id
       WHERE r.check_in_date <= gs AND r.check_out_date > gs
       AND r.status IN ('checked_in','checked_out','confirmed')
       AND r.booking_source NOT IN ('credit','complimentary')) as occupied
    FROM generate_series(${format(from, "yyyy-MM-dd")}::date, ${format(to, "yyyy-MM-dd")}::date, '1 day') gs
  `);

  const daily = rows.map((r) => ({
    day: r.day,
    occupied: r.occupied,
    total: totalRooms,
    percentage: totalRooms ? Math.round((r.occupied / totalRooms) * 100) : 0,
  }));

  const avg = daily.length
    ? Math.round(daily.reduce((a, d) => a + d.percentage, 0) / daily.length)
    : 0;

  return ok(res, { from, to, totalRooms, avgOccupancy: avg, daily });
});

router.get("/revenue", requireAuth, requireAdmin, async (req, res) => {
  const { from, to } = rangeDefaults(req as never);

  const daily = await db.execute<{ day: string; total: string; count: number }>(sql`
    SELECT DATE(payment_date)::text as day,
      COALESCE(SUM(amount),0)::text as total,
      COUNT(*)::int as count
    FROM ${payments}
    WHERE payment_date >= ${from.toISOString()} AND payment_date <= ${to.toISOString()}
    GROUP BY DATE(payment_date)
    ORDER BY day
  `);

  const totalRevenue = daily.reduce((a, d) => a + Number(d.total), 0);

  const byType = await db
    .select({
      roomType: rooms.roomType,
      total: sql<string>`COALESCE(SUM(${payments.amount}),0)::text`,
    })
    .from(payments)
    .innerJoin(reservations, eq(reservations.id, payments.reservationId))
    .innerJoin(reservationRooms, eq(reservationRooms.reservationId, reservations.id))
    .innerJoin(rooms, eq(rooms.id, reservationRooms.roomId))
    .where(and(gte(payments.paymentDate, from), lte(payments.paymentDate, to)))
    .groupBy(rooms.roomType);

  return ok(res, { from, to, totalRevenue, daily, byRoomType: byType });
});

router.get("/collections", requireAuth, requireAdmin, async (req, res) => {
  const { from, to } = rangeDefaults(req as never);
  const byMethod = await db
    .select({
      method: payments.paymentMethod,
      count: sql<number>`count(*)::int`,
      total: sql<string>`COALESCE(SUM(${payments.amount}),0)::text`,
    })
    .from(payments)
    .where(and(gte(payments.paymentDate, from), lte(payments.paymentDate, to)))
    .groupBy(payments.paymentMethod);

  const rows = await db
    .select()
    .from(payments)
    .where(and(gte(payments.paymentDate, from), lte(payments.paymentDate, to)))
    .orderBy(desc(payments.paymentDate))
    .limit(500);

  return ok(res, { from, to, byMethod, payments: rows });
});

router.get("/gst-summary", requireAuth, requireAdmin, async (req, res) => {
  const { month } = req.query as { month?: string };
  const anchor = month ? parseISO(`${month}-01`) : new Date();
  const from = startOfMonth(anchor);
  const to = endOfMonth(anchor);

  const rows = await db
    .select({
      status: invoices.status,
      subtotal: sql<string>`COALESCE(SUM(${invoices.subtotal}),0)::text`,
      cgst: sql<string>`COALESCE(SUM(${invoices.cgstAmount}),0)::text`,
      sgst: sql<string>`COALESCE(SUM(${invoices.sgstAmount}),0)::text`,
      total: sql<string>`COALESCE(SUM(${invoices.grandTotal}),0)::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(invoices)
    .where(
      and(
        gte(invoices.createdAt, from),
        lte(invoices.createdAt, to),
        ne(invoices.status, "voided"),
      ),
    )
    .groupBy(invoices.status);

  return ok(res, { month: format(anchor, "yyyy-MM"), from, to, byStatus: rows });
});

router.get("/outstanding", requireAuth, requireAdmin, async (_req, res) => {
  const rows = await db
    .select()
    .from(invoices)
    .where(and(ne(invoices.status, "voided"), ne(invoices.status, "paid")))
    .orderBy(desc(invoices.createdAt));
  return ok(res, rows);
});

router.get("/room-performance", requireAuth, requireAdmin, async (req, res) => {
  const { from, to } = rangeDefaults(req as never);
  const rows = await db
    .select({
      roomId: rooms.id,
      roomNumber: rooms.roomNumber,
      roomType: rooms.roomType,
      baseRate: rooms.baseRate,
      bookings: sql<number>`count(distinct ${reservations.id})::int`,
      revenue: sql<string>`COALESCE(SUM(${payments.amount}),0)::text`,
    })
    .from(rooms)
    .leftJoin(reservationRooms, eq(reservationRooms.roomId, rooms.id))
    .leftJoin(reservations, eq(reservations.id, reservationRooms.reservationId))
    .leftJoin(
      payments,
      and(
        eq(payments.reservationId, reservations.id),
        gte(payments.paymentDate, from),
        lte(payments.paymentDate, to),
      ),
    )
    .groupBy(rooms.id)
    .orderBy(rooms.roomNumber);
  return ok(res, rows);
});

router.get("/credit-bookings", requireAuth, requireAdmin, async (req, res) => {
  const { from, to } = rangeDefaults(req as never);
  const rows = await db
    .select({
      id: reservations.id,
      reservationNumber: reservations.reservationNumber,
      guestName: guests.fullName,
      guestPhone: guests.phone,
      bookingSource: reservations.bookingSource,
      checkInDate: reservations.checkInDate,
      checkOutDate: reservations.checkOutDate,
      numNights: reservations.numNights,
      grandTotal: reservations.grandTotal,
      balanceDue: reservations.balanceDue,
      status: reservations.status,
      creditNotes: reservations.creditNotes,
      createdAt: reservations.createdAt,
    })
    .from(reservations)
    .innerJoin(guests, eq(guests.id, reservations.guestId))
    .where(
      and(
        eq(reservations.bookingSource, "complimentary"),
        gte(reservations.createdAt, from),
        lte(reservations.createdAt, to),
      ),
    )
    .orderBy(desc(reservations.createdAt));

  const totals = rows.reduce(
    (acc, r) => {
      acc.count += 1;
      acc.grandTotal += Number(r.grandTotal);
      acc.balanceDue += Number(r.balanceDue);
      if (r.bookingSource === "complimentary") acc.complimentary += Number(r.grandTotal);
      return acc;
    },
    { count: 0, grandTotal: 0, balanceDue: 0, complimentary: 0 },
  );

  return ok(res, { from, to, totals, rows });
});

router.get("/guests", requireAuth, requireAdmin, async (req, res) => {
  const { from, to } = rangeDefaults(req as never);
  const rows = await db
    .select({
      guestId: guests.id,
      fullName: guests.fullName,
      phone: guests.phone,
      stays: sql<number>`count(distinct ${reservations.id})::int`,
      revenue: sql<string>`COALESCE(SUM(${payments.amount}),0)::text`,
    })
    .from(guests)
    .leftJoin(reservations, eq(reservations.guestId, guests.id))
    .leftJoin(
      payments,
      and(
        eq(payments.reservationId, reservations.id),
        gte(payments.paymentDate, from),
        lte(payments.paymentDate, to),
      ),
    )
    .groupBy(guests.id)
    .orderBy(sql`count(distinct ${reservations.id}) DESC`)
    .limit(100);
  return ok(res, rows);
});

export default router;
