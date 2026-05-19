import { endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import { and, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { Router } from "express";
import { db } from "../db/client.js";
import { guests } from "../db/schema/guests.js";
import { invoices, payments } from "../db/schema/invoices.js";
import { reservationRooms, reservations } from "../db/schema/reservations.js";
import { rooms } from "../db/schema/rooms.js";
import { env } from "../config/env.js";
import { logActivity } from "../lib/activity.js";
import { messaging } from "../lib/messaging.js";
import { fail, ok } from "../lib/response.js";
import { getSettings } from "../lib/settings.js";
import { renderTemplate } from "../lib/templates.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

const router = Router();

function rangeDefaults(req: { query: Record<string, string | undefined> }) {
  const from = req.query.date_from ? parseISO(req.query.date_from) : startOfMonth(new Date());
  const to = req.query.date_to ? parseISO(req.query.date_to) : endOfMonth(new Date());
  return { from, to };
}

router.get("/occupancy", requireAuth, requirePermission("view_reports"), async (req, res) => {
  const { from, to } = rangeDefaults(req as never);
  const totalRooms = (await db.select({ c: sql<number>`count(*)::int` }).from(rooms))[0]!.c;

  const rows = await db.execute<{ day: string; occupied: number }>(sql`
    SELECT gs::date::text as day,
      (SELECT count(*)::int FROM ${reservationRooms} rr
       INNER JOIN ${reservations} r ON r.id = rr.reservation_id
       WHERE r.check_in_date <= gs AND r.check_out_date > gs
       AND r.status IN ('checked_in','checked_out','confirmed')
       AND r.booking_source <> 'complimentary') as occupied
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

router.get("/revenue", requireAuth, requirePermission("view_reports"), async (req, res) => {
  const { from, to } = rangeDefaults(req as never);

  // Real revenue = received (not pending), not voided, not complimentary.
  //   - Pending = staff recorded a promise of payment ("unpaid"); not cash yet.
  //   - Voided = reversed for accounting.
  //   - Complimentary = owner-comp bookings; tracked in their own report.
  // The daily aggregate joins to reservations so it can apply the same
  // booking-source filter the per-type breakdowns use.
  const daily = await db.execute<{ day: string; total: string; count: number }>(sql`
    SELECT DATE(p.payment_date)::text as day,
      COALESCE(SUM(p.amount),0)::text as total,
      COUNT(*)::int as count
    FROM ${payments} p
    INNER JOIN ${reservations} r ON r.id = p.reservation_id
    WHERE p.payment_date >= ${from.toISOString()} AND p.payment_date <= ${to.toISOString()}
      AND p.voided = false
      AND p.status = 'received'
      AND r.booking_source <> 'complimentary'
    GROUP BY DATE(p.payment_date)
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
    .where(
      and(
        gte(payments.paymentDate, from),
        lte(payments.paymentDate, to),
        eq(payments.voided, false),
        eq(payments.status, "received"),
        sql`${reservations.bookingSource} <> 'complimentary'`,
      ),
    )
    .groupBy(rooms.roomType);

  // Day-use vs overnight split. Drives the "Booking types" summary block
  // on the Reports page so the owner can see how much short-stay revenue
  // the property is generating without slicing per-room manually.
  const byStayType = await db
    .select({
      stayType: reservations.stayType,
      bookings: sql<number>`count(distinct ${reservations.id})::int`,
      total: sql<string>`COALESCE(SUM(${payments.amount}),0)::text`,
    })
    .from(payments)
    .innerJoin(reservations, eq(reservations.id, payments.reservationId))
    .where(
      and(
        gte(payments.paymentDate, from),
        lte(payments.paymentDate, to),
        eq(payments.voided, false),
        eq(payments.status, "received"),
        sql`${reservations.bookingSource} <> 'complimentary'`,
      ),
    )
    .groupBy(reservations.stayType);

  return ok(res, { from, to, totalRevenue, daily, byRoomType: byType, byStayType });
});

router.get("/collections", requireAuth, requirePermission("view_reports"), async (req, res) => {
  const { from, to } = rangeDefaults(req as never);
  // Exclude complimentary-reservation payments from the by-method
  // breakdown. They're shown in the Complimentary report instead.
  const byMethod = await db
    .select({
      method: payments.paymentMethod,
      count: sql<number>`count(*)::int`,
      total: sql<string>`COALESCE(SUM(${payments.amount}),0)::text`,
    })
    .from(payments)
    .innerJoin(reservations, eq(reservations.id, payments.reservationId))
    .where(
      and(
        gte(payments.paymentDate, from),
        lte(payments.paymentDate, to),
        eq(payments.voided, false),
        eq(payments.status, "received"),
        sql`${reservations.bookingSource} <> 'complimentary'`,
      ),
    )
    .groupBy(payments.paymentMethod);

  // Full payments list — keep voided + pending visible so staff can see
  // what was voided/promised, but exclude complimentary-reservation rows
  // entirely (they live in their own report).
  const rows = await db
    .select()
    .from(payments)
    .innerJoin(reservations, eq(reservations.id, payments.reservationId))
    .where(
      and(
        gte(payments.paymentDate, from),
        lte(payments.paymentDate, to),
        sql`${reservations.bookingSource} <> 'complimentary'`,
      ),
    )
    .orderBy(desc(payments.paymentDate))
    .limit(500);

  return ok(res, { from, to, byMethod, payments: rows.map((r) => r.payments) });
});

router.get("/gst-summary", requireAuth, requirePermission("view_reports"), async (req, res) => {
  // Accept any of:
  //   ?month=YYYY-MM             — single calendar month (legacy callers)
  //   ?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD — explicit window (the
  //                                            Reports page uses this when
  //                                            the user picks Week / Year /
  //                                            Custom)
  //   neither                    — defaults to the current month
  // The response keeps the legacy `month` field as a human label so the
  // GST tab's section header doesn't break for month-based callers.
  const { month, date_from, date_to } = req.query as {
    month?: string;
    date_from?: string;
    date_to?: string;
  };

  let from: Date;
  let to: Date;
  let label: string;
  if (date_from && date_to) {
    from = parseISO(date_from);
    // Inclusive end-of-day so a single-day window includes invoices issued
    // anytime on date_to.
    to = new Date(parseISO(date_to).getTime() + 86_399_999);
    label = `${format(from, "dd MMM yyyy")} → ${format(parseISO(date_to), "dd MMM yyyy")}`;
  } else {
    const anchor = month ? parseISO(`${month}-01`) : new Date();
    from = startOfMonth(anchor);
    to = endOfMonth(anchor);
    label = format(anchor, "yyyy-MM");
  }

  // GST summary excludes invoices tied to complimentary reservations.
  // A comped booking is not a taxable sale from a management standpoint,
  // so its CGST/SGST shouldn't appear in the GST filing rollup.
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
    .innerJoin(reservations, eq(reservations.id, invoices.reservationId))
    .where(
      and(
        gte(invoices.createdAt, from),
        lte(invoices.createdAt, to),
        ne(invoices.status, "voided"),
        sql`${reservations.bookingSource} <> 'complimentary'`,
      ),
    )
    .groupBy(invoices.status);

  return ok(res, { month: label, from, to, byStatus: rows });
});

router.get("/outstanding", requireAuth, requirePermission("view_revenue"), async (_req, res) => {
  // Complimentary reservations are not chased — they were comped, there
  // is no debt. All three sub-queries below filter them out.
  // 1. Invoices that still have a balance.
  const rows = await db
    .select({
      invoiceId: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      reservationId: invoices.reservationId,
      reservationNumber: reservations.reservationNumber,
      guestId: invoices.guestId,
      guestName: guests.fullName,
      guestPhone: guests.phone,
      grandTotal: invoices.grandTotal,
      totalPaid: invoices.totalPaid,
      balanceDue: invoices.balanceDue,
      status: invoices.status,
      issuedAt: invoices.createdAt,
      checkedOutAt: reservations.checkedOutAt,
    })
    .from(invoices)
    .innerJoin(guests, eq(guests.id, invoices.guestId))
    .innerJoin(reservations, eq(reservations.id, invoices.reservationId))
    .where(
      and(
        ne(invoices.status, "voided"),
        ne(invoices.status, "paid"),
        sql`${reservations.bookingSource} <> 'complimentary'`,
      ),
    )
    .orderBy(desc(invoices.createdAt));

  // 2. Active reservations (confirmed / checked-in) that DON'T have an
  //    invoice yet but have a non-zero balance — these would be missed by
  //    the invoice-only query above. Examples: a guest who paid an advance
  //    but is still checked in; a confirmed booking with no advance.
  const preInvoiceRows = await db
    .select({
      reservationId: reservations.id,
      reservationNumber: reservations.reservationNumber,
      guestId: reservations.guestId,
      guestName: guests.fullName,
      guestPhone: guests.phone,
      grandTotal: reservations.grandTotal,
      advancePaid: reservations.advancePaid,
      balanceDue: reservations.balanceDue,
      status: reservations.status,
      checkInDate: reservations.checkInDate,
      checkOutDate: reservations.checkOutDate,
      createdAt: reservations.createdAt,
    })
    .from(reservations)
    .innerJoin(guests, eq(guests.id, reservations.guestId))
    .leftJoin(invoices, eq(invoices.reservationId, reservations.id))
    .where(
      and(
        inArray(reservations.status, ["confirmed", "checked_in"]),
        sql`${invoices.id} IS NULL`,
        sql`${reservations.balanceDue}::numeric > 0.009`,
        sql`${reservations.bookingSource} <> 'complimentary'`,
      ),
    )
    .orderBy(desc(reservations.createdAt));

  // Pending (unpaid-method) payments — separate stream for visibility
  const pendingPayments = await db
    .select({
      paymentId: payments.id,
      invoiceId: payments.invoiceId,
      reservationId: payments.reservationId,
      reservationNumber: reservations.reservationNumber,
      guestId: reservations.guestId,
      guestName: guests.fullName,
      guestPhone: guests.phone,
      amount: payments.amount,
      notes: payments.notes,
      promisedAt: payments.createdAt,
    })
    .from(payments)
    .innerJoin(reservations, eq(reservations.id, payments.reservationId))
    .innerJoin(guests, eq(guests.id, reservations.guestId))
    .where(
      and(
        eq(payments.status, "pending"),
        eq(payments.voided, false),
        sql`${reservations.bookingSource} <> 'complimentary'`,
      ),
    )
    .orderBy(desc(payments.createdAt));

  // Guest-level totals — combine invoice-based and pre-invoice balances.
  const byGuest = new Map<
    string,
    { guestId: string; guestName: string; guestPhone: string; balance: number; oldest: Date }
  >();
  function addToGuest(
    r: {
      guestId: string;
      guestName: string;
      guestPhone: string;
    },
    balance: number,
    when: Date,
  ) {
    if (balance <= 0.009) return;
    const cur = byGuest.get(r.guestId);
    if (cur) {
      cur.balance += balance;
      if (when < cur.oldest) cur.oldest = when;
    } else {
      byGuest.set(r.guestId, {
        guestId: r.guestId,
        guestName: r.guestName,
        guestPhone: r.guestPhone,
        balance,
        oldest: when,
      });
    }
  }
  for (const r of rows) addToGuest(r, Number(r.balanceDue), new Date(r.issuedAt));
  for (const r of preInvoiceRows) addToGuest(r, Number(r.balanceDue), new Date(r.createdAt));

  return ok(res, {
    invoices: rows,
    preInvoice: preInvoiceRows,
    pendingPayments,
    byGuest: Array.from(byGuest.values()).sort((a, b) => b.balance - a.balance),
    totalOutstanding: Array.from(byGuest.values()).reduce((s, g) => s + g.balance, 0),
  });
});

router.get("/room-performance", requireAuth, requirePermission("view_reports"), async (req, res) => {
  const { from, to } = rangeDefaults(req as never);
  // Complimentary reservations are filtered out of every aggregate — they
  // shouldn't inflate per-room booking counts or revenue.
  const notComp = sql`${reservations.bookingSource} <> 'complimentary'`;
  const rows = await db
    .select({
      roomId: rooms.id,
      roomNumber: rooms.roomNumber,
      roomType: rooms.roomType,
      baseRate: rooms.baseRate,
      bookings: sql<number>`count(distinct ${reservations.id}) filter (where ${notComp})::int`,
      // Split booking counts so a manager can see which rooms are being
      // used for day-use vs traditional overnight.
      overnightBookings: sql<number>`count(distinct ${reservations.id}) filter (where ${reservations.stayType} = 'overnight' AND ${notComp})::int`,
      shortStayBookings: sql<number>`count(distinct ${reservations.id}) filter (where ${reservations.stayType} = 'short_stay' AND ${notComp})::int`,
      revenue: sql<string>`COALESCE(SUM(${payments.amount}) filter (where ${payments.voided} = false AND ${payments.status} = 'received' AND ${notComp}),0)::text`,
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

router.post("/outstanding/remind/:guestId", requireAuth, requirePermission("send_reminders"), async (req, res) => {
  const guestId = req.params.guestId!;
  const [g] = await db.select().from(guests).where(eq(guests.id, guestId)).limit(1);
  if (!g) return fail(res, 404, "NOT_FOUND", "Guest not found");
  if (!g.phone) return fail(res, 400, "NO_PHONE", "Guest has no phone number");

  // Sum unpaid invoice balances for this guest
  const invs = await db
    .select({ balanceDue: invoices.balanceDue })
    .from(invoices)
    .where(
      and(
        eq(invoices.guestId, guestId),
        ne(invoices.status, "paid"),
        ne(invoices.status, "voided"),
      ),
    );
  const balance = invs.reduce((sum, r) => sum + Number(r.balanceDue), 0);
  if (balance <= 0.009) {
    return fail(res, 400, "NO_BALANCE", "Guest has no outstanding balance");
  }

  const settings = await getSettings();
  const t = await renderTemplate("payment_reminder_guest_sms", {
    hotel: env.HOTEL_DISPLAY_NAME,
    hotel_phone: settings.hotelPhone ?? "",
    guest_name: g.fullName,
    guest_phone: g.phone,
    balance: balance.toFixed(2),
  });
  if (!t.enabled) return fail(res, 400, "TEMPLATE_DISABLED", "Reminder template is disabled");

  const result = await messaging.sendSms({ to: g.phone, text: t.body });
  if (!result.ok) return fail(res, 502, "SEND_FAILED", result.error ?? "Send failed");

  await logActivity({
    action: "payment_reminder_sent",
    entityType: "guest",
    entityId: guestId,
    description: `Payment reminder sent to ${g.fullName} (₹${balance.toFixed(2)})`,
    performedBy: req.user!.id,
    ipAddress: req.ip,
  });
  return ok(res, {
    sent: true,
    balance,
    provider: result.provider,
    messageId: result.id ?? null,
    to: g.phone,
  });
});

router.get("/credit-bookings", requireAuth, requirePermission("view_reports"), async (req, res) => {
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
      // Sum of received, non-voided payments on this reservation. For
      // comped bookings this often > 0 — staff collected money before the
      // booking was reclassified to complimentary. The report surfaces it
      // so the owner sees both the "comped value" and "money already in
      // the till" for the same row.
      totalPaid: sql<string>`COALESCE((
        SELECT SUM(${payments.amount})
        FROM ${payments}
        WHERE ${payments.reservationId} = ${reservations.id}
          AND ${payments.voided} = false
          AND ${payments.status} = 'received'
      ), 0)::text`,
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
      acc.totalPaid += Number(r.totalPaid);
      if (r.bookingSource === "complimentary") acc.complimentary += Number(r.grandTotal);
      return acc;
    },
    { count: 0, grandTotal: 0, balanceDue: 0, totalPaid: 0, complimentary: 0 },
  );

  return ok(res, { from, to, totals, rows });
});

router.get("/guests", requireAuth, requirePermission("view_reports"), async (req, res) => {
  const { from, to } = rangeDefaults(req as never);
  // Stays count includes comps (a stay happened, even if comped). Revenue
  // excludes comp-booking payments — those live in the Complimentary
  // report so the guest's "real revenue" isn't inflated.
  const rows = await db
    .select({
      guestId: guests.id,
      fullName: guests.fullName,
      phone: guests.phone,
      stays: sql<number>`count(distinct ${reservations.id})::int`,
      revenue: sql<string>`COALESCE(SUM(${payments.amount}) filter (where ${payments.voided} = false AND ${payments.status} = 'received' AND ${reservations.bookingSource} <> 'complimentary'),0)::text`,
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
