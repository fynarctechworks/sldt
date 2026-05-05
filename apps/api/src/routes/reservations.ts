import {
  addRoomSchema,
  additionalChargeSchema,
  cancelSchema,
  checkInSchema,
  checkOutSchema,
  editChargeSchema,
  editDatesSchema,
  editRoomRateSchema,
  extendReservationSchema,
  lateCheckoutSchema,
  reservationCreateSchema,
  reservationListQuerySchema,
  swapRoomSchema,
} from "@hoteldesk/shared";
import { differenceInCalendarDays, format } from "date-fns";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { Router } from "express";
import { db } from "../db/client.js";
import { additionalCharges, invoiceLineItems, invoices, payments } from "../db/schema/invoices.js";
import { reservationRooms, reservations } from "../db/schema/reservations.js";
import { rooms } from "../db/schema/rooms.js";
import { logActivity } from "../lib/activity.js";
import {
  isRoomAvailable,
  nextDailySequence,
  nextInvoiceSequence,
} from "../lib/availability.js";
import { calcGstBreakdown, getGstRate } from "../lib/gst.js";
import { invoiceNumber, reservationNumber } from "../lib/numbers.js";
import { renderInvoicePdf } from "../lib/pdf.js";
import { generateReceiptNumber } from "../lib/receipt.js";
import { dispatchNotification, notifyGuestEmail, notifyGuestSms, notifyOwner } from "../lib/notify.js";
import { renderTemplate } from "../lib/templates.js";
import { env } from "../config/env.js";
import { invalidateDashboard } from "../lib/redis.js";
import { fail, list, ok } from "../lib/response.js";
import { getSettings } from "../lib/settings.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { guests } from "../db/schema/guests.js";

const router = Router();
const STAFF_ROLES = ["admin", "frontdesk"] as const;

router.get(
  "/",
  requireAuth,
  requireRole(...STAFF_ROLES),
  validate(reservationListQuerySchema, "query"),
  async (req, res) => {
    const { status, date, page, per_page } = req.query as unknown as {
      status?: string;
      date?: string;
      page: number;
      per_page: number;
    };
    const conditions = [];
    if (status) conditions.push(eq(reservations.status, status as never));
    if (date) {
      conditions.push(lte(reservations.checkInDate, date));
      conditions.push(gte(reservations.checkOutDate, date));
    }

    const [rows, total] = await Promise.all([
      db
        .select({
          reservation: reservations,
          guestName: guests.fullName,
          guestPhone: guests.phone,
        })
        .from(reservations)
        .innerJoin(guests, eq(guests.id, reservations.guestId))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(reservations.createdAt))
        .limit(per_page)
        .offset((page - 1) * per_page),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(reservations)
        .where(conditions.length ? and(...conditions) : undefined),
    ]);

    return list(
      res,
      rows.map((r) => ({ ...r.reservation, guestName: r.guestName, guestPhone: r.guestPhone })),
      { total: total[0]?.count ?? 0, page, per_page },
    );
  },
);

router.get("/:id", requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  const id = req.params.id!;
  const r = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
  if (!r.length) return fail(res, 404, "NOT_FOUND", "Reservation not found");

  const [resRooms, charges, guest] = await Promise.all([
    db
      .select({ rr: reservationRooms, room: rooms })
      .from(reservationRooms)
      .innerJoin(rooms, eq(rooms.id, reservationRooms.roomId))
      .where(eq(reservationRooms.reservationId, id)),
    db
      .select()
      .from(additionalCharges)
      .where(eq(additionalCharges.reservationId, id))
      .orderBy(asc(additionalCharges.createdAt)),
    db.select().from(guests).where(eq(guests.id, r[0]!.guestId)).limit(1),
  ]);

  const inv = await db.select().from(invoices).where(eq(invoices.reservationId, id)).limit(1);
  const pays = inv.length
    ? await db.select().from(payments).where(eq(payments.reservationId, id))
    : [];

  const s = await getSettings();

  return ok(res, {
    ...r[0],
    guest: guest[0],
    rooms: resRooms.map((x) => ({ ...x.room, ratePerNight: x.rr.ratePerNight })),
    additionalCharges: charges,
    invoice: inv[0] ?? null,
    payments: pays,
    hotelCheckInTime: s.checkInTime,
    hotelCheckOutTime: s.checkOutTime,
  });
});

router.post(
  "/",
  requireAuth,
  requireRole(...STAFF_ROLES),
  validate(reservationCreateSchema),
  async (req, res) => {
    const input = req.body as import("@hoteldesk/shared").ReservationCreateInput;

    const roomIds = input.rooms.map((r) => r.roomId);
    for (const roomId of roomIds) {
      const ok = await isRoomAvailable(roomId, input.checkInDate, input.checkOutDate);
      if (!ok) {
        return fail(res, 409, "ROOM_UNAVAILABLE", `Room is not available for those dates`, { roomId });
      }
    }

    const settings = await getSettings();
    const nights = differenceInCalendarDays(
      new Date(input.checkOutDate),
      new Date(input.checkInDate),
    );
    if (nights < 1) {
      return fail(res, 400, "INVALID_DATES", "Check-out must be at least 1 day after check-in");
    }

    const subtotal = +input.rooms.reduce((a, r) => a + r.ratePerNight * nights, 0).toFixed(2);
    const avgRate = subtotal / (nights * input.rooms.length);
    const gstRate = getGstRate(avgRate, {
      exemptBelow: Number(settings.gstSlabExemptBelow),
      lowRate: Number(settings.gstSlabLowRate),
      lowMax: Number(settings.gstSlabLowMax),
      highRate: Number(settings.gstSlabHighRate),
    });
    const { gstAmount, grandTotal } = calcGstBreakdown(subtotal, gstRate);
    const balanceDue = +(grandTotal - input.advancePaid).toFixed(2);

    const seq = await nextDailySequence("RES", `RES-${format(new Date(), "yyyyMMdd")}-%`);
    const resNumber = reservationNumber(seq);

    const created = await db.transaction(async (tx) => {
      const [r] = await tx
        .insert(reservations)
        .values({
          reservationNumber: resNumber,
          guestId: input.guestId,
          checkInDate: input.checkInDate,
          checkOutDate: input.checkOutDate,
          numAdults: input.numAdults,
          numChildren: input.numChildren,
          ratePerNight: String(avgRate.toFixed(2)),
          subtotal: String(subtotal),
          gstRate: String(gstRate),
          gstAmount: String(gstAmount),
          grandTotal: String(grandTotal),
          advancePaid: String(input.advancePaid),
          balanceDue: String(balanceDue),
          status: "confirmed",
          bookingSource: input.bookingSource ?? "walkin",
          creditNotes: input.creditNotes ?? null,
          specialRequests: input.specialRequests ?? null,
          createdBy: req.user!.id,
        })
        .returning();

      await tx.insert(reservationRooms).values(
        input.rooms.map((rm) => ({
          reservationId: r!.id,
          roomId: rm.roomId,
          ratePerNight: String(rm.ratePerNight),
          soldAsType: rm.soldAsType ?? null,
        })),
      );

      await tx
        .update(rooms)
        .set({ status: "reserved", updatedAt: new Date() })
        .where(inArray(rooms.id, roomIds));

      if (input.advancePaid > 0 && input.advancePaymentMethod) {
        const rcpNum = await generateReceiptNumber();
        await tx.insert(payments).values({
          receiptNumber: rcpNum,
          invoiceId: null,
          reservationId: r!.id,
          amount: String(input.advancePaid),
          paymentMethod: input.advancePaymentMethod,
          receivedBy: req.user!.id,
          notes: "Advance at booking",
        });
      }

      return r!;
    });

    await logActivity({
      action: "reservation_created",
      entityType: "reservation",
      entityId: created.id,
      description: `${created.reservationNumber} created`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });

    void (async () => {
      try {
        const [g] = await db.select().from(guests).where(eq(guests.id, created.guestId)).limit(1);
        const baseVars = {
          hotel: env.HOTEL_DISPLAY_NAME,
          guest_name: g?.fullName ?? "guest",
          guest_phone: g?.phone ?? "",
          guest_email: g?.email ?? "",
          reservation_number: created.reservationNumber,
          check_in_date: created.checkInDate,
          check_out_date: created.checkOutDate,
          nights: created.numNights ?? "",
          total: created.grandTotal,
          advance_paid: created.advancePaid,
          balance: created.balanceDue,
        };
        await dispatchNotification({
          type: "reservation_created",
          title: "New booking",
          body: `${created.reservationNumber} for ${g?.fullName ?? "guest"} (${created.checkInDate} to ${created.checkOutDate})`,
          href: `/reservations/${created.id}`,
          payload: { reservationId: created.id },
          recipientRoles: ["admin", "frontdesk"],
        });
        if (g?.phone) {
          const t = await renderTemplate("booking_created_guest_sms", baseVars);
          if (t.enabled) await notifyGuestSms({ to: g.phone, text: t.body });
        }
        if (g?.email) {
          const t = await renderTemplate("booking_created_guest_email", baseVars);
          if (t.enabled) await notifyGuestEmail({ to: g.email, subject: t.subject ?? "", text: t.body });
        }
        const ownerT = await renderTemplate("booking_created_owner_sms", baseVars);
        if (ownerT.enabled) await notifyOwner(ownerT.body);
      } catch {
        // best-effort, do not fail the booking
      }
    })();

    await invalidateDashboard();
    return ok(res, created, 201);
  },
);

router.post(
  "/:id/check-in",
  requireAuth,
  requireRole(...STAFF_ROLES),
  validate(checkInSchema),
  async (req, res) => {
    const id = req.params.id!;
    const input = req.body as import("@hoteldesk/shared").CheckInInput;

    const r = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
    if (!r.length) return fail(res, 404, "NOT_FOUND", "Reservation not found");
    if (r[0]!.status !== "confirmed") {
      return fail(res, 409, "INVALID_STATUS", `Cannot check in a ${r[0]!.status} reservation`);
    }

    const guestRow = await db
      .select({
        kycVerifiedAt: guests.kycVerifiedAt,
        idProofPhotoFront: guests.idProofPhotoFront,
      })
      .from(guests)
      .where(eq(guests.id, r[0]!.guestId))
      .limit(1);
    if (!guestRow.length || !guestRow[0]!.kycVerifiedAt || !guestRow[0]!.idProofPhotoFront) {
      return fail(
        res,
        422,
        "KYC_REQUIRED",
        "Guest KYC documents required before check-in. Upload ID proof photo first.",
      );
    }

    const roomIds = (
      await db
        .select({ roomId: reservationRooms.roomId })
        .from(reservationRooms)
        .where(eq(reservationRooms.reservationId, id))
    ).map((x) => x.roomId);

    await db.transaction(async (tx) => {
      const newAdvance = Number(r[0]!.advancePaid) + (input.advancePayment ?? 0);
      const newBalance = +(Number(r[0]!.grandTotal) - newAdvance).toFixed(2);
      await tx
        .update(reservations)
        .set({
          status: "checked_in",
          checkedInAt: new Date(),
          checkedInBy: req.user!.id,
          advancePaid: String(newAdvance),
          balanceDue: String(newBalance),
          updatedAt: new Date(),
        })
        .where(eq(reservations.id, id));
      await tx
        .update(rooms)
        .set({ status: "occupied", updatedAt: new Date() })
        .where(inArray(rooms.id, roomIds));

      if ((input.advancePayment ?? 0) > 0 && input.paymentMethod) {
        const rcpNum = await generateReceiptNumber();
        await tx.insert(payments).values({
          receiptNumber: rcpNum,
          invoiceId: null,
          reservationId: id,
          amount: String(input.advancePayment),
          paymentMethod: input.paymentMethod,
          receivedBy: req.user!.id,
          notes: "Advance at check-in",
        });
      }
    });

    await logActivity({
      action: "check_in",
      entityType: "reservation",
      entityId: id,
      description: `${r[0]!.reservationNumber} checked in`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
      metadata: { advancePayment: input.advancePayment ?? 0 },
    });

    void (async () => {
      try {
        const [g] = await db.select().from(guests).where(eq(guests.id, r[0]!.guestId)).limit(1);
        const roomNumbers = (
          await db
            .select({ n: rooms.roomNumber })
            .from(reservationRooms)
            .innerJoin(rooms, eq(rooms.id, reservationRooms.roomId))
            .where(eq(reservationRooms.reservationId, id))
        )
          .map((r) => r.n)
          .join(", ");
        const baseVars = {
          hotel: env.HOTEL_DISPLAY_NAME,
          guest_name: g?.fullName ?? "guest",
          guest_phone: g?.phone ?? "",
          guest_email: g?.email ?? "",
          reservation_number: r[0]!.reservationNumber,
          check_in_date: r[0]!.checkInDate,
          check_out_date: r[0]!.checkOutDate,
          room_numbers: roomNumbers,
        };
        await dispatchNotification({
          type: "guest_checked_in",
          title: "Guest checked in",
          body: `${g?.fullName ?? "Guest"} checked in (${r[0]!.reservationNumber})`,
          href: `/reservations/${id}`,
          payload: { reservationId: id },
          recipientRoles: ["admin", "frontdesk", "housekeeping"],
        });
        if (g?.phone) {
          const t = await renderTemplate("checkin_guest_sms", baseVars);
          if (t.enabled) await notifyGuestSms({ to: g.phone, text: t.body });
        }
        if (g?.email) {
          const t = await renderTemplate("checkin_guest_email", baseVars);
          if (t.enabled) await notifyGuestEmail({ to: g.email, subject: t.subject ?? "", text: t.body });
        }
        const ownerT = await renderTemplate("checkin_owner_sms", baseVars);
        if (ownerT.enabled) await notifyOwner(ownerT.body);
      } catch {
        // best-effort
      }
    })();

    await invalidateDashboard();
    return ok(res, { success: true });
  },
);

router.post(
  "/:id/check-out",
  requireAuth,
  requireRole(...STAFF_ROLES),
  validate(checkOutSchema),
  async (req, res) => {
    const id = req.params.id!;
    const input = req.body as import("@hoteldesk/shared").CheckOutInput;

    const r = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
    if (!r.length) return fail(res, 404, "NOT_FOUND", "Reservation not found");
    if (r[0]!.status !== "checked_in") {
      return fail(res, 409, "INVALID_STATUS", `Cannot check out a ${r[0]!.status} reservation`);
    }

    const settings = await getSettings();
    const guest = (await db.select().from(guests).where(eq(guests.id, r[0]!.guestId)).limit(1))[0]!;
    const resRooms = await db
      .select({ rr: reservationRooms, room: rooms })
      .from(reservationRooms)
      .innerJoin(rooms, eq(rooms.id, reservationRooms.roomId))
      .where(eq(reservationRooms.reservationId, id));
    const charges = await db
      .select()
      .from(additionalCharges)
      .where(eq(additionalCharges.reservationId, id));

    const nights = Number(r[0]!.numNights);
    const roomGstRate = Number(r[0]!.gstRate);

    let subtotal = 0;
    const lineItems: Array<{
      description: string;
      sacCode: string;
      quantity: number;
      rate: string;
      amount: string;
      gstRate: string;
      gstAmount: string;
      itemType: "room_charge" | "additional_charge";
    }> = [];

    for (const rr of resRooms) {
      const rate = Number(rr.rr.ratePerNight);
      const amount = +(rate * nights).toFixed(2);
      const gstAmount = +(amount * (roomGstRate / 100)).toFixed(2);
      subtotal += amount;
      lineItems.push({
        description: `Room ${rr.room.roomNumber} - ${rr.room.roomType} (${nights} nights)`,
        sacCode: "9963",
        quantity: nights,
        rate: String(rate),
        amount: String(amount),
        gstRate: String(roomGstRate),
        gstAmount: String(gstAmount),
        itemType: "room_charge",
      });
    }

    let totalGst = +(subtotal * (roomGstRate / 100)).toFixed(2);
    for (const c of charges) {
      const amount = Number(c.amount);
      const gstAmount = +(amount * (Number(c.gstRate) / 100)).toFixed(2);
      subtotal += amount;
      totalGst += gstAmount;
      lineItems.push({
        description: c.description,
        sacCode: "9963",
        quantity: c.quantity,
        rate: String(c.rate),
        amount: String(amount),
        gstRate: String(c.gstRate),
        gstAmount: String(gstAmount),
        itemType: "additional_charge",
      });
    }

    subtotal = +subtotal.toFixed(2);
    totalGst = +totalGst.toFixed(2);
    const cgst = +(totalGst / 2).toFixed(2);
    const sgst = +(totalGst - cgst).toFixed(2);
    const grandTotal = +(subtotal + totalGst).toFixed(2);

    const finalPayment = input.finalPayment ?? 0;
    const previouslyPaid = Number(r[0]!.advancePaid);
    const totalPaid = +(previouslyPaid + finalPayment).toFixed(2);
    const balanceDue = +(grandTotal - totalPaid).toFixed(2);
    const invStatus =
      balanceDue <= 0.009 ? "paid" : totalPaid > 0 ? "partial" : "issued";

    const invoiceSeq = await nextInvoiceSequence(
      `${settings.invoicePrefix}-${format(new Date(), "yyyyMM")}-%`,
    );
    const invNumber = invoiceNumber(settings.invoicePrefix, invoiceSeq);
    const cgstRate = +(roomGstRate / 2).toFixed(2);
    const sgstRate = +(roomGstRate / 2).toFixed(2);

    const created = await db.transaction(async (tx) => {
      const [inv] = await tx
        .insert(invoices)
        .values({
          invoiceNumber: invNumber,
          reservationId: id,
          guestId: r[0]!.guestId,
          hotelName: settings.hotelName,
          hotelAddress: settings.hotelAddress,
          hotelGstin: settings.hotelGstin,
          guestName: guest.fullName,
          guestAddress: guest.address ?? null,
          guestGstin: guest.gstin ?? null,
          subtotal: String(subtotal),
          cgstRate: String(cgstRate),
          cgstAmount: String(cgst),
          sgstRate: String(sgstRate),
          sgstAmount: String(sgst),
          grandTotal: String(grandTotal),
          totalPaid: String(totalPaid),
          balanceDue: String(balanceDue),
          status: invStatus,
          issuedBy: req.user!.id,
        })
        .returning();

      await tx
        .insert(invoiceLineItems)
        .values(lineItems.map((li) => ({ invoiceId: inv!.id, ...li })));

      await tx
        .update(payments)
        .set({ invoiceId: inv!.id })
        .where(and(eq(payments.reservationId, id), sql`${payments.invoiceId} IS NULL`));

      if (finalPayment > 0 && input.paymentMethod) {
        const rcpNum = await generateReceiptNumber();
        await tx.insert(payments).values({
          receiptNumber: rcpNum,
          invoiceId: inv!.id,
          reservationId: id,
          amount: String(finalPayment),
          paymentMethod: input.paymentMethod,
          receivedBy: req.user!.id,
        });
      }

      await tx
        .update(reservations)
        .set({
          status: "checked_out",
          checkedOutAt: new Date(),
          checkedOutBy: req.user!.id,
          balanceDue: String(balanceDue),
          updatedAt: new Date(),
        })
        .where(eq(reservations.id, id));

      const roomIds = resRooms.map((x) => x.room.id);
      await tx
        .update(rooms)
        .set({ status: "dirty", updatedAt: new Date() })
        .where(inArray(rooms.id, roomIds));

      return inv!;
    });

    void (async () => {
      try {
        const [g] = await db.select().from(guests).where(eq(guests.id, r[0]!.guestId)).limit(1);
        const baseVars = {
          hotel: env.HOTEL_DISPLAY_NAME,
          guest_name: g?.fullName ?? "guest",
          guest_phone: g?.phone ?? "",
          guest_email: g?.email ?? "",
          reservation_number: r[0]!.reservationNumber,
          invoice_number: invNumber,
          total: r[0]!.grandTotal,
        };
        await dispatchNotification({
          type: "guest_checked_out",
          title: "Guest checked out",
          body: `${g?.fullName ?? "Guest"} (${r[0]!.reservationNumber}). Invoice ${invNumber}.`,
          href: `/reservations/${id}`,
          payload: { reservationId: id, invoiceNumber: invNumber },
          recipientRoles: ["admin", "frontdesk", "housekeeping"],
        });
        if (g?.phone) {
          const t = await renderTemplate("checkout_guest_sms", baseVars);
          if (t.enabled) await notifyGuestSms({ to: g.phone, text: t.body });
        }
        if (g?.email) {
          let attachments: { filename: string; content: Buffer }[] | undefined;
          try {
            const [fullInv] = await db
              .select()
              .from(invoices)
              .where(eq(invoices.invoiceNumber, invNumber))
              .limit(1);
            if (fullInv) {
              const [items, pays, settings] = await Promise.all([
                db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, fullInv.id)),
                db.select().from(payments).where(eq(payments.invoiceId, fullInv.id)),
                getSettings(),
              ]);
              const pdf = await renderInvoicePdf({
                invoice: fullInv,
                lineItems: items,
                payments: pays,
                settings,
              });
              attachments = [{ filename: `${invNumber}.pdf`, content: pdf }];
            }
          } catch {
            // PDF attach best-effort; email still goes
          }
          const t = await renderTemplate("checkout_guest_email", baseVars);
          if (t.enabled) {
            await notifyGuestEmail({
              to: g.email,
              subject: t.subject ?? "",
              text: t.body,
              attachments,
            });
          }
        }
        const ownerT = await renderTemplate("checkout_owner_sms", baseVars);
        if (ownerT.enabled) await notifyOwner(ownerT.body);
      } catch {
        // best-effort
      }
    })();

    await logActivity({
      action: "check_out",
      entityType: "reservation",
      entityId: id,
      description: `${r[0]!.reservationNumber} checked out, invoice ${invNumber}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
      metadata: { invoiceId: created.id, finalPayment },
    });
    await invalidateDashboard();
    return ok(res, { invoice: created });
  },
);

router.post(
  "/:id/cancel",
  requireAuth,
  requireRole(...STAFF_ROLES),
  validate(cancelSchema),
  async (req, res) => {
    const id = req.params.id!;
    const { cancellationReason } = req.body as { cancellationReason: string };
    const r = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
    if (!r.length) return fail(res, 404, "NOT_FOUND", "Reservation not found");
    if (!["confirmed", "checked_in"].includes(r[0]!.status)) {
      return fail(res, 409, "INVALID_STATUS", `Cannot cancel ${r[0]!.status}`);
    }

    const roomIds = (
      await db
        .select({ roomId: reservationRooms.roomId })
        .from(reservationRooms)
        .where(eq(reservationRooms.reservationId, id))
    ).map((x) => x.roomId);

    await db.transaction(async (tx) => {
      await tx
        .update(reservations)
        .set({ status: "cancelled", cancellationReason, updatedAt: new Date() })
        .where(eq(reservations.id, id));
      if (roomIds.length) {
        await tx
          .update(rooms)
          .set({ status: "available", updatedAt: new Date() })
          .where(inArray(rooms.id, roomIds));
      }
    });

    await logActivity({
      action: "reservation_cancelled",
      entityType: "reservation",
      entityId: id,
      description: `${r[0]!.reservationNumber} cancelled: ${cancellationReason}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    await invalidateDashboard();
    return ok(res, { success: true });
  },
);

router.post(
  "/:id/swap-room",
  requireAuth,
  requireRole(...STAFF_ROLES),
  validate(swapRoomSchema),
  async (req, res) => {
    const id = req.params.id!;
    const { newRoomId } = req.body as { newRoomId: string };

    const r = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
    if (!r.length) return fail(res, 404, "NOT_FOUND", "Reservation not found");
    if (!["confirmed", "checked_in"].includes(r[0]!.status)) {
      return fail(res, 409, "INVALID_STATUS", `Cannot swap room on ${r[0]!.status}`);
    }

    const available = await isRoomAvailable(newRoomId, r[0]!.checkInDate, r[0]!.checkOutDate, id);
    if (!available) return fail(res, 409, "ROOM_UNAVAILABLE", "New room is not available");

    const oldRows = await db
      .select()
      .from(reservationRooms)
      .where(eq(reservationRooms.reservationId, id));
    if (!oldRows.length) return fail(res, 400, "NO_ROOMS", "Reservation has no rooms");
    const oldRoomId = oldRows[0]!.roomId;

    await db.transaction(async (tx) => {
      await tx
        .update(reservationRooms)
        .set({ roomId: newRoomId })
        .where(eq(reservationRooms.id, oldRows[0]!.id));
      await tx
        .update(rooms)
        .set({
          status: r[0]!.status === "checked_in" ? "dirty" : "available",
          updatedAt: new Date(),
        })
        .where(eq(rooms.id, oldRoomId));
      await tx
        .update(rooms)
        .set({
          status: r[0]!.status === "checked_in" ? "occupied" : "reserved",
          updatedAt: new Date(),
        })
        .where(eq(rooms.id, newRoomId));
    });

    await logActivity({
      action: "room_swap",
      entityType: "reservation",
      entityId: id,
      description: `${r[0]!.reservationNumber}: room swapped`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
      metadata: { oldRoomId, newRoomId },
    });
    await invalidateDashboard();
    return ok(res, { success: true });
  },
);

router.post(
  "/:id/charges",
  requireAuth,
  requireRole(...STAFF_ROLES),
  validate(additionalChargeSchema),
  async (req, res) => {
    const id = req.params.id!;
    const input = req.body as import("@hoteldesk/shared").AdditionalChargeInput;
    const amount = +(input.quantity * input.rate).toFixed(2);
    const [created] = await db
      .insert(additionalCharges)
      .values({
        reservationId: id,
        description: input.description,
        quantity: input.quantity,
        rate: String(input.rate),
        amount: String(amount),
        gstRate: String(input.gstRate),
        addedBy: req.user!.id,
      })
      .returning();

    await logActivity({
      action: "charge_added",
      entityType: "reservation",
      entityId: id,
      description: `Charge: ${input.description} ₹${amount}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    return ok(res, created, 201);
  },
);

router.post(
  "/:id/extend",
  requireAuth,
  requireRole(...STAFF_ROLES),
  validate(extendReservationSchema),
  async (req, res) => {
    const id = req.params.id!;
    const input = req.body as { newCheckOutDate: string; ratePerNight?: number };

    const r = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
    if (!r[0]) return fail(res, 404, "NOT_FOUND", "Reservation not found");
    const current = r[0];
    if (current.status !== "confirmed" && current.status !== "checked_in") {
      return fail(res, 400, "INVALID_STATE", "Only confirmed or checked-in reservations can be extended");
    }
    if (new Date(input.newCheckOutDate) <= new Date(current.checkOutDate)) {
      return fail(res, 400, "INVALID_DATES", "New check-out must be after current check-out");
    }

    const assigned = await db
      .select({ roomId: reservationRooms.roomId, ratePerNight: reservationRooms.ratePerNight })
      .from(reservationRooms)
      .where(eq(reservationRooms.reservationId, id));

    for (const rm of assigned) {
      const ok = await isRoomAvailable(rm.roomId, current.checkOutDate, input.newCheckOutDate, id);
      if (!ok) {
        return fail(res, 409, "ROOM_UNAVAILABLE", "Room is not available for the extended period", {
          roomId: rm.roomId,
        });
      }
    }

    const settings = await getSettings();
    const newNights = differenceInCalendarDays(
      new Date(input.newCheckOutDate),
      new Date(current.checkInDate),
    );

    const perRoomRate = input.ratePerNight ?? Number(current.ratePerNight);
    const subtotal = +(perRoomRate * newNights * assigned.length).toFixed(2);
    const gstRate = getGstRate(perRoomRate, {
      exemptBelow: Number(settings.gstSlabExemptBelow),
      lowRate: Number(settings.gstSlabLowRate),
      lowMax: Number(settings.gstSlabLowMax),
      highRate: Number(settings.gstSlabHighRate),
    });
    const { gstAmount, grandTotal } = calcGstBreakdown(subtotal, gstRate);
    const balanceDue = +(grandTotal - Number(current.advancePaid)).toFixed(2);

    const [updated] = await db
      .update(reservations)
      .set({
        checkOutDate: input.newCheckOutDate,
        numNights: newNights,
        ratePerNight: String(perRoomRate.toFixed(2)),
        subtotal: String(subtotal),
        gstRate: String(gstRate),
        gstAmount: String(gstAmount),
        grandTotal: String(grandTotal),
        balanceDue: String(balanceDue),
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, id))
      .returning();

    if (input.ratePerNight) {
      await db
        .update(reservationRooms)
        .set({ ratePerNight: String(input.ratePerNight) })
        .where(eq(reservationRooms.reservationId, id));
    }

    await logActivity({
      action: "reservation_extended",
      entityType: "reservation",
      entityId: id,
      description: `${current.reservationNumber} extended to ${input.newCheckOutDate}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
      metadata: { oldCheckOut: current.checkOutDate, newCheckOut: input.newCheckOutDate },
    });
    await invalidateDashboard();
    return ok(res, updated);
  },
);

router.post(
  "/:id/late-checkout",
  requireAuth,
  requireRole(...STAFF_ROLES),
  validate(lateCheckoutSchema),
  async (req, res) => {
    const id = req.params.id!;
    const input = req.body as { hours: number; fee: number; notes?: string | null };

    const r = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
    if (!r[0]) return fail(res, 404, "NOT_FOUND", "Reservation not found");
    if (r[0].status !== "confirmed" && r[0].status !== "checked_in") {
      return fail(res, 400, "INVALID_STATE", "Only active reservations can have late checkout");
    }

    const description = `Late checkout (${input.hours} hrs)${input.notes ? `: ${input.notes}` : ""}`;
    const [charge] = await db
      .insert(additionalCharges)
      .values({
        reservationId: id,
        description,
        quantity: 1,
        rate: String(input.fee),
        amount: String(input.fee),
        gstRate: "0",
        addedBy: req.user!.id,
      })
      .returning();

    if (input.fee > 0) {
      const newBalance = +(Number(r[0].balanceDue) + input.fee).toFixed(2);
      const newGrand = +(Number(r[0].grandTotal) + input.fee).toFixed(2);
      await db
        .update(reservations)
        .set({
          grandTotal: String(newGrand),
          balanceDue: String(newBalance),
          updatedAt: new Date(),
        })
        .where(eq(reservations.id, id));
    }

    await logActivity({
      action: "late_checkout",
      entityType: "reservation",
      entityId: id,
      description: `${r[0].reservationNumber}: late checkout ${input.hours}h (₹${input.fee})`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
      metadata: { hours: input.hours, fee: input.fee },
    });
    return ok(res, charge, 201);
  },
);

router.post(
  "/:id/add-room",
  requireAuth,
  requireRole(...STAFF_ROLES),
  validate(addRoomSchema),
  async (req, res) => {
    const id = req.params.id!;
    const input = req.body as {
      roomId: string;
      ratePerNight: number;
      soldAsType?: string | null;
      startDate?: string;
    };

    const r = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
    if (!r[0]) return fail(res, 404, "NOT_FOUND", "Reservation not found");
    const current = r[0];
    if (current.status !== "confirmed" && current.status !== "checked_in") {
      return fail(res, 400, "INVALID_STATE", "Can only add rooms to active reservations");
    }

    const existing = await db
      .select({ roomId: reservationRooms.roomId })
      .from(reservationRooms)
      .where(eq(reservationRooms.reservationId, id));
    if (existing.some((x) => x.roomId === input.roomId)) {
      return fail(res, 400, "DUPLICATE_ROOM", "Room already assigned to this reservation");
    }

    const today = format(new Date(), "yyyy-MM-dd");
    const startDate = input.startDate ?? (current.checkInDate > today ? current.checkInDate : today);
    if (startDate >= current.checkOutDate) {
      return fail(res, 400, "INVALID_DATES", "Start date must be before check-out date");
    }

    const ok2 = await isRoomAvailable(input.roomId, startDate, current.checkOutDate, id);
    if (!ok2) {
      return fail(res, 409, "ROOM_UNAVAILABLE", "Room is not available for the selected period", {
        roomId: input.roomId,
      });
    }

    const addedNights = differenceInCalendarDays(
      new Date(current.checkOutDate),
      new Date(startDate),
    );
    const addedRoomSubtotal = +(input.ratePerNight * addedNights).toFixed(2);

    const settings = await getSettings();
    const newSubtotal = +(Number(current.subtotal) + addedRoomSubtotal).toFixed(2);
    const gstRate = getGstRate(input.ratePerNight, {
      exemptBelow: Number(settings.gstSlabExemptBelow),
      lowRate: Number(settings.gstSlabLowRate),
      lowMax: Number(settings.gstSlabLowMax),
      highRate: Number(settings.gstSlabHighRate),
    });
    const effectiveGstRate = Math.max(Number(current.gstRate), gstRate);
    const { gstAmount, grandTotal } = calcGstBreakdown(newSubtotal, effectiveGstRate);
    const balanceDue = +(grandTotal - Number(current.advancePaid)).toFixed(2);

    await db.transaction(async (tx) => {
      await tx.insert(reservationRooms).values({
        reservationId: id,
        roomId: input.roomId,
        ratePerNight: String(input.ratePerNight),
        soldAsType: input.soldAsType ?? null,
      });
      await tx
        .update(reservations)
        .set({
          subtotal: String(newSubtotal),
          gstRate: String(effectiveGstRate),
          gstAmount: String(gstAmount),
          grandTotal: String(grandTotal),
          balanceDue: String(balanceDue),
          updatedAt: new Date(),
        })
        .where(eq(reservations.id, id));
      await tx
        .update(rooms)
        .set({
          status: current.status === "checked_in" ? "occupied" : "reserved",
          updatedAt: new Date(),
        })
        .where(eq(rooms.id, input.roomId));
    });

    await logActivity({
      action: "room_added",
      entityType: "reservation",
      entityId: id,
      description: `${current.reservationNumber}: room added (${addedNights}n @ ₹${input.ratePerNight})`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
      metadata: { roomId: input.roomId, startDate, ratePerNight: input.ratePerNight },
    });
    await invalidateDashboard();
    return ok(res, { success: true, addedSubtotal: addedRoomSubtotal, newGrandTotal: grandTotal }, 201);
  },
);

async function recalcReservation(id: string) {
  const r = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
  if (!r[0]) return null;
  const current = r[0];

  const assigned = await db
    .select({ ratePerNight: reservationRooms.ratePerNight })
    .from(reservationRooms)
    .where(eq(reservationRooms.reservationId, id));
  const charges = await db
    .select()
    .from(additionalCharges)
    .where(eq(additionalCharges.reservationId, id));

  const nights = differenceInCalendarDays(
    new Date(current.checkOutDate),
    new Date(current.checkInDate),
  );
  const roomSubtotal = assigned.reduce((a, rm) => a + Number(rm.ratePerNight) * nights, 0);
  const chargesSubtotal = charges.reduce((a, c) => a + Number(c.amount), 0);
  const subtotal = +(roomSubtotal + chargesSubtotal).toFixed(2);

  const settings = await getSettings();
  const avgRate = assigned.length ? roomSubtotal / (nights * assigned.length) : 0;
  const gstRate = getGstRate(avgRate, {
    exemptBelow: Number(settings.gstSlabExemptBelow),
    lowRate: Number(settings.gstSlabLowRate),
    lowMax: Number(settings.gstSlabLowMax),
    highRate: Number(settings.gstSlabHighRate),
  });
  const { gstAmount, grandTotal } = calcGstBreakdown(subtotal, gstRate);
  const balanceDue = +(grandTotal - Number(current.advancePaid)).toFixed(2);

  await db
    .update(reservations)
    .set({
      numNights: nights,
      subtotal: String(subtotal),
      gstRate: String(gstRate),
      gstAmount: String(gstAmount),
      grandTotal: String(grandTotal),
      balanceDue: String(balanceDue),
      updatedAt: new Date(),
    })
    .where(eq(reservations.id, id));
  return { subtotal, grandTotal, balanceDue };
}

async function hasInvoice(reservationId: string) {
  const inv = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(eq(invoices.reservationId, reservationId))
    .limit(1);
  return inv.length > 0;
}

router.patch(
  "/:id/rooms/:roomId",
  requireAuth,
  requireRole(...STAFF_ROLES),
  validate(editRoomRateSchema),
  async (req, res) => {
    const { id, roomId } = req.params as { id: string; roomId: string };
    const { ratePerNight } = req.body as { ratePerNight: number };

    if (await hasInvoice(id)) {
      return fail(res, 400, "INVOICE_EXISTS", "Cannot edit rates after invoice is generated. Void invoice first.");
    }

    const [updated] = await db
      .update(reservationRooms)
      .set({ ratePerNight: String(ratePerNight) })
      .where(and(eq(reservationRooms.reservationId, id), eq(reservationRooms.roomId, roomId)))
      .returning();
    if (!updated) return fail(res, 404, "NOT_FOUND", "Room not in reservation");

    const totals = await recalcReservation(id);
    await logActivity({
      action: "rate_edited",
      entityType: "reservation",
      entityId: id,
      description: `Room rate changed to ₹${ratePerNight}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
      metadata: { roomId, ratePerNight },
    });
    await invalidateDashboard();
    return ok(res, { success: true, ...totals });
  },
);

router.patch(
  "/:id/charges/:chargeId",
  requireAuth,
  requireRole(...STAFF_ROLES),
  validate(editChargeSchema),
  async (req, res) => {
    const { id, chargeId } = req.params as { id: string; chargeId: string };
    const input = req.body as {
      description?: string;
      quantity?: number;
      rate?: number;
      gstRate?: number;
    };

    if (await hasInvoice(id)) {
      return fail(res, 400, "INVOICE_EXISTS", "Cannot edit charges after invoice is generated");
    }

    const existing = await db
      .select()
      .from(additionalCharges)
      .where(eq(additionalCharges.id, chargeId))
      .limit(1);
    if (!existing.length) return fail(res, 404, "NOT_FOUND", "Charge not found");

    const newQty = input.quantity ?? existing[0]!.quantity;
    const newRate = input.rate ?? Number(existing[0]!.rate);
    const newAmount = +(newQty * newRate).toFixed(2);

    const patch: Record<string, unknown> = { amount: String(newAmount) };
    if (input.description !== undefined) patch.description = input.description;
    if (input.quantity !== undefined) patch.quantity = input.quantity;
    if (input.rate !== undefined) patch.rate = String(input.rate);
    if (input.gstRate !== undefined) patch.gstRate = String(input.gstRate);

    await db.update(additionalCharges).set(patch).where(eq(additionalCharges.id, chargeId));
    const totals = await recalcReservation(id);

    await logActivity({
      action: "charge_edited",
      entityType: "reservation",
      entityId: id,
      description: `Charge edited: ${input.description ?? existing[0]!.description} ₹${newAmount}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
      metadata: { chargeId, ...input },
    });
    return ok(res, { success: true, ...totals });
  },
);

router.delete(
  "/:id/charges/:chargeId",
  requireAuth,
  requireRole(...STAFF_ROLES),
  async (req, res) => {
    const { id, chargeId } = req.params as { id: string; chargeId: string };
    if (await hasInvoice(id)) {
      return fail(res, 400, "INVOICE_EXISTS", "Cannot delete charges after invoice is generated");
    }
    const [deleted] = await db
      .delete(additionalCharges)
      .where(eq(additionalCharges.id, chargeId))
      .returning();
    if (!deleted) return fail(res, 404, "NOT_FOUND", "Charge not found");
    const totals = await recalcReservation(id);

    await logActivity({
      action: "charge_deleted",
      entityType: "reservation",
      entityId: id,
      description: `Charge deleted: ${deleted.description}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    return ok(res, { success: true, ...totals });
  },
);

router.patch(
  "/:id/dates",
  requireAuth,
  requireRole(...STAFF_ROLES),
  validate(editDatesSchema),
  async (req, res) => {
    const id = req.params.id!;
    const { checkInDate, checkOutDate } = req.body as {
      checkInDate: string;
      checkOutDate: string;
    };
    if (await hasInvoice(id)) {
      return fail(res, 400, "INVOICE_EXISTS", "Cannot edit dates after invoice is generated");
    }

    const assigned = await db
      .select({ roomId: reservationRooms.roomId })
      .from(reservationRooms)
      .where(eq(reservationRooms.reservationId, id));
    for (const rm of assigned) {
      const ok2 = await isRoomAvailable(rm.roomId, checkInDate, checkOutDate, id);
      if (!ok2) {
        return fail(res, 409, "ROOM_UNAVAILABLE", "One or more rooms unavailable for the new dates", {
          roomId: rm.roomId,
        });
      }
    }

    await db
      .update(reservations)
      .set({ checkInDate, checkOutDate, updatedAt: new Date() })
      .where(eq(reservations.id, id));
    const totals = await recalcReservation(id);

    await logActivity({
      action: "dates_edited",
      entityType: "reservation",
      entityId: id,
      description: `Dates changed to ${checkInDate} → ${checkOutDate}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    await invalidateDashboard();
    return ok(res, { success: true, ...totals });
  },
);

router.get("/:id/charges", requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  const id = req.params.id!;
  const rows = await db
    .select()
    .from(additionalCharges)
    .where(eq(additionalCharges.reservationId, id))
    .orderBy(asc(additionalCharges.createdAt));
  return ok(res, rows);
});

export default router;
