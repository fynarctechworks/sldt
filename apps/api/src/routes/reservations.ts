import {
  addRoomSchema,
  additionalChargeSchema,
  cancelSchema,
  makeComplimentarySchema,
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
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { additionalCharges, invoiceLineItems, invoices, payments } from "../db/schema/invoices.js";
import { reservationRooms, reservations } from "../db/schema/reservations.js";
import { rooms } from "../db/schema/rooms.js";
import {
  DEFAULT_TASK_STEPS,
  housekeepingTaskSteps,
  housekeepingTasks,
} from "../db/schema/housekeepingTasks.js";
import { roomTypes } from "../db/schema/settings.js";
import { combinedRoomTypeLabel, type RoomTypeLabelMap } from "../lib/roomTypeLabel.js";
import { logActivity } from "../lib/activity.js";
import { logger } from "../lib/logger.js";
import {
  isRoomAvailable,
  lockKey,
  lockRoom,
  nextDailySequence,
  nextInvoiceSequence,
} from "../lib/availability.js";
import { getGuestBalance } from "../lib/ledger.js";
import { resolveCurrentPropertyId } from "../lib/currentProperty.js";
import { resolveAverageRate } from "../lib/ratePlanResolve.js";
import { calcGstBreakdown, getGstRate } from "../lib/gst.js";
import { ratePlans } from "../db/schema/ratePlans.js";
import { companies } from "../db/schema/companies.js";
import { invoiceNumber, reservationNumber } from "../lib/numbers.js";
import { hashOtp } from "../lib/otp.js";
import { renderInvoicePdf, renderReceiptPdf } from "../lib/pdf.js";
import { generateReceiptNumber } from "../lib/receipt.js";
import { signedKycUrl, uploadPublicPdf } from "../lib/storage.js";
import { dispatchNotification, notifyGuestSms, notifyOwner } from "../lib/notify.js";
import { renderTemplate } from "../lib/templates.js";
import { env } from "../config/env.js";
import { invalidateDashboard } from "../lib/redis.js";
import { fail, list, ok } from "../lib/response.js";
import { getSettings } from "../lib/settings.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { idempotent } from "../middleware/idempotency.js";
import { validate } from "../middleware/validate.js";
import { guests } from "../db/schema/guests.js";
import { otps } from "../db/schema/otps.js";
import { guestLedger } from "../db/schema/guestLedger.js";

const router = Router();

// Loads slug → label for every room type (active + archived). Used by the
// invoice/receipt rendering paths so the displayed room-type names match
// what staff typed in Settings → Room Types, including correct casing for
// types like "Non AC Single Bed Rooms" where the slug doesn't title-case.
async function buildRoomTypeLabelMap(): Promise<RoomTypeLabelMap> {
  const rows = await db.select({ slug: roomTypes.slug, label: roomTypes.label }).from(roomTypes);
  return new Map(rows.map((r) => [r.slug, r.label]));
}

router.get(
  "/",
  requireAuth,
  requirePermission("view_reservations"),
  validate(reservationListQuerySchema, "query"),
  async (req, res) => {
    const {
      status,
      date,
      q,
      date_from,
      date_to,
      room_id,
      floor,
      include_complimentary,
      page,
      per_page,
    } = req.query as unknown as {
      status?: string;
      date?: string;
      q?: string;
      date_from?: string;
      date_to?: string;
      room_id?: string;
      floor?: number;
      include_complimentary?: boolean;
      page: number;
      per_page: number;
    };
    const conditions = [];
    if (status) conditions.push(eq(reservations.status, status as never));
    if (date) {
      conditions.push(lte(reservations.checkInDate, date));
      conditions.push(gte(reservations.checkOutDate, date));
    }
    if (date_from) conditions.push(gte(reservations.checkInDate, date_from));
    if (date_to) conditions.push(lte(reservations.checkInDate, date_to));
    if (q) {
      const like = `%${q}%`;
      conditions.push(
        sql`(${reservations.reservationNumber} ILIKE ${like} OR ${guests.fullName} ILIKE ${like} OR ${guests.phone} ILIKE ${like})`,
      );
    }
    // Room / floor filters. EXISTS subqueries against reservation_rooms +
    // rooms so multi-room reservations match when ANY of their rooms
    // satisfies the filter. We don't add a JOIN to the main query
    // because that would force DISTINCT on every other path.
    if (room_id) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${reservationRooms} rr
          WHERE rr.reservation_id = ${reservations.id}
            AND rr.room_id = ${room_id}::uuid
        )`,
      );
    }
    if (floor !== undefined) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${reservationRooms} rr
          JOIN ${rooms} rm ON rm.id = rr.room_id
          WHERE rr.reservation_id = ${reservations.id}
            AND rm.floor = ${floor}
        )`,
      );
    }
    // Hide complimentary bookings from the main list by default — they
    // live in Reports → Complimentary. The override flag is for admin
    // tooling that needs to surface every reservation.
    if (!include_complimentary) {
      conditions.push(sql`${reservations.bookingSource} <> 'complimentary'`);
    }

    const [rows, total] = await Promise.all([
      db
        .select({
          reservation: reservations,
          guestName: guests.fullName,
          guestPhone: guests.phone,
          // Storage key for the guest's customer photo (uploaded during KYC).
          // Signed per-row below so the card can render <img>. Null when the
          // guest hasn't been photographed yet — the card then shows initials.
          guestPhotoKey: guests.guestPhoto,
          // Comma-separated room numbers so the list card can show the
          // allotted rooms without a second fetch per row. Subquery groups
          // by reservation id and orders numerically.
          roomNumbers: sql<string>`COALESCE((
            SELECT string_agg(${rooms.roomNumber}, ',' ORDER BY ${rooms.roomNumber})
            FROM ${reservationRooms}
            JOIN ${rooms} ON ${rooms.id} = ${reservationRooms.roomId}
            WHERE ${reservationRooms.reservationId} = ${reservations.id}
          ), '')`,
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
        .innerJoin(guests, eq(guests.id, reservations.guestId))
        .where(conditions.length ? and(...conditions) : undefined),
    ]);

    // Sign all storage keys in parallel. Null keys produce null URLs.
    const photoUrls = await Promise.all(
      rows.map((r) => (r.guestPhotoKey ? signedKycUrl(r.guestPhotoKey) : Promise.resolve(null))),
    );

    return list(
      res,
      rows.map((r, i) => ({
        ...r.reservation,
        guestName: r.guestName,
        guestPhone: r.guestPhone,
        guestPhotoUrl: photoUrls[i] ?? null,
        roomNumbers: r.roomNumbers,
      })),
      { total: total[0]?.count ?? 0, page, per_page },
    );
  },
);

router.get("/:id", requireAuth, requirePermission("view_reservations"), async (req, res) => {
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
  const pays = await db
    .select()
    .from(payments)
    .where(eq(payments.reservationId, id))
    .orderBy(desc(payments.paymentDate));

  const s = await getSettings();

  const guestPhotoUrl = guest[0]?.guestPhoto ? await signedKycUrl(guest[0].guestPhoto) : null;

  return ok(res, {
    ...r[0],
    guest: guest[0] ? { ...guest[0], photoUrl: guestPhotoUrl } : guest[0],
    rooms: await (async () => {
      const m = await buildRoomTypeLabelMap();
      return resRooms.map((x) => ({
        ...x.room,
        ratePerNight: x.rr.ratePerNight,
        soldAsType: x.rr.soldAsType,
        // Pre-rendered display label for the receipt + reservation detail:
        // "Ac Single Bed Rooms" or "Ac Single Bed Rooms booked as Non Ac
        // Bed Rooms" — see lib/roomTypeLabel.ts.
        displayType: combinedRoomTypeLabel(x.room.roomType, x.rr.soldAsType, m),
      }));
    })(),
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
  requirePermission("view_reservations"),
  idempotent("reservations.create"),
  validate(reservationCreateSchema),
  async (req, res) => {
    const input = req.body as import("@hoteldesk/shared").ReservationCreateInput;

    // Verify the OTP up-front. We intentionally do this BEFORE any
    // availability / pricing / lock work so a bad/missing OTP wastes no
    // DB time. The matching OTP row is selected for consumption later
    // inside the create transaction so a verified code can't be replayed
    // across two requests.
    let otpRowIdToConsume: string | null = null;
    if (input.otpCode) {
      const [otpRow] = await db
        .select()
        .from(otps)
        .where(
          and(
            eq(otps.guestId, input.guestId),
            isNull(otps.reservationId),
            isNull(otps.consumedAt),
            eq(otps.purpose, "checkin"),
          ),
        )
        .orderBy(desc(otps.createdAt))
        .limit(1);
      if (!otpRow) {
        return fail(res, 400, "OTP_REQUIRED", "OTP verification required before booking");
      }
      if (otpRow.expiresAt < new Date()) {
        return fail(res, 400, "OTP_EXPIRED", "OTP expired. Request a new code.");
      }
      if (otpRow.codeHash !== hashOtp(input.otpCode)) {
        return fail(res, 400, "OTP_INVALID", "Incorrect OTP code");
      }
      otpRowIdToConsume = otpRow.id;
    } else {
      // OTP is mandatory for every booking. We don't allow an opt-out
      // because every check-in needs guest acknowledgement (anti-fraud).
      return fail(res, 400, "OTP_REQUIRED", "OTP verification required before booking");
    }

    // Blacklist guard. Reject before any availability / pricing work
    // so a blacklisted guest can't even probe inventory. Returns 403
    // with the audit reason so the desk staff knows what to tell them.
    const [guestRow] = await db
      .select({
        isBlacklisted: guests.isBlacklisted,
        blacklistReason: guests.blacklistReason,
      })
      .from(guests)
      .where(eq(guests.id, input.guestId))
      .limit(1);
    if (!guestRow) {
      return fail(res, 404, "GUEST_NOT_FOUND", "Guest not found");
    }
    if (guestRow.isBlacklisted) {
      return fail(
        res,
        403,
        "GUEST_BLACKLISTED",
        `This guest is blacklisted${guestRow.blacklistReason ? ` (${guestRow.blacklistReason})` : ""}. An admin must clear the blacklist before booking.`,
      );
    }

    const roomIds = input.rooms.map((r) => r.roomId);

    // Phase 2: every new reservation + its payments are scoped to the
    // current property. Resolved once and threaded through the tx.
    const propertyId = await resolveCurrentPropertyId(req);

    const settings = await getSettings();
    const stayType = input.stayType ?? "overnight";
    const isShortStay = stayType === "short_stay";

    // Date / duration sanity. For overnight: nights >= 1, priced per-night
    // per-room. For short_stay: same-day, durationHours required, each
    // room's ratePerNight is interpreted as the FLAT short-stay price for
    // the requested duration (client derives this from the room type's
    // bands, or pro-rates a custom-hours entry).
    let nights = 0;
    let durationHours = 0;
    if (isShortStay) {
      if (input.checkInDate !== input.checkOutDate) {
        return fail(
          res,
          400,
          "INVALID_DATES",
          "Short-stay bookings must check-in and check-out on the same date",
        );
      }
      if (!input.durationHours || input.durationHours <= 0) {
        return fail(res, 400, "INVALID_DURATION", "Short-stay bookings require a positive duration");
      }
      durationHours = +input.durationHours;
    } else {
      nights = differenceInCalendarDays(
        new Date(input.checkOutDate),
        new Date(input.checkInDate),
      );
      if (nights < 1) {
        return fail(res, 400, "INVALID_DATES", "Check-out must be at least 1 day after check-in");
      }
    }

    // Phase 2: if the caller supplied a ratePlanId, look up its code
    // (snapshotted onto the reservation) and recompute each room's
    // per-night rate from the rate calendar. Overnight stays only —
    // day-use carries its own flat-price band system and is not
    // touched. Short-stay's input rate is left as the source of truth.
    let ratePlanCode: string | null = null;
    if (input.ratePlanId && !isShortStay) {
      const [plan] = await db
        .select({ code: ratePlans.code, propertyId: ratePlans.propertyId, isActive: ratePlans.isActive })
        .from(ratePlans)
        .where(eq(ratePlans.id, input.ratePlanId))
        .limit(1);
      if (!plan) {
        return fail(res, 404, "RATE_PLAN_NOT_FOUND", "Rate plan not found");
      }
      if (!plan.isActive) {
        return fail(res, 409, "RATE_PLAN_INACTIVE", "Rate plan is inactive");
      }
      if (plan.propertyId !== propertyId) {
        return fail(res, 403, "CROSS_PROPERTY", "Rate plan belongs to a different property");
      }
      ratePlanCode = plan.code;
      // Override each room's ratePerNight in-place via the resolver.
      // resolveAverageRate handles the "stay straddles a weekend
      // surcharge" case correctly by averaging across nights, AND
      // applies Phase 3 pricing rules on top (occupancy, LOS, etc.).
      for (const r of input.rooms) {
        const [roomRow] = await db
          .select({ roomType: rooms.roomType })
          .from(rooms)
          .where(eq(rooms.id, r.roomId))
          .limit(1);
        if (!roomRow) continue;
        const avg = await resolveAverageRate({
          propertyId,
          ratePlanId: input.ratePlanId,
          roomId: r.roomId,
          roomType: roomRow.roomType,
          checkInDate: input.checkInDate,
          checkOutDate: input.checkOutDate,
        });
        r.ratePerNight = avg;
      }
    }

    // Phase 2: optional company snapshot. Same property scoping check
    // as the rate plan above.
    let companyCode: string | null = null;
    if (input.companyId) {
      const [cmp] = await db
        .select({
          code: companies.code,
          propertyId: companies.propertyId,
          isActive: companies.isActive,
        })
        .from(companies)
        .where(eq(companies.id, input.companyId))
        .limit(1);
      if (!cmp) return fail(res, 404, "COMPANY_NOT_FOUND", "Company not found");
      if (!cmp.isActive) return fail(res, 409, "COMPANY_ARCHIVED", "Company is archived");
      if (cmp.propertyId !== propertyId) {
        return fail(res, 403, "CROSS_PROPERTY", "Company belongs to a different property");
      }
      companyCode = cmp.code;
    }

    // The user-typed rate is the grand-total amount per room when the
    // property is in 'inclusive' mode (GST already baked in) and the net
    // amount per room when in 'exclusive' mode (GST added on top).
    // We compute a single `roomAmount` that represents the user's input,
    // then derive both the stored subtotal (net) and the grand total
    // through calcGstBreakdown which handles both modes.
    const roomAmount = isShortStay
      ? +input.rooms.reduce((a, r) => a + r.ratePerNight, 0).toFixed(2)
      : +input.rooms.reduce((a, r) => a + r.ratePerNight * nights, 0).toFixed(2);
    const avgRate = isShortStay
      ? roomAmount / input.rooms.length
      : roomAmount / (nights * input.rooms.length);
    const gstRate = getGstRate(avgRate, {
      exemptBelow: Number(settings.gstSlabExemptBelow),
      lowRate: Number(settings.gstSlabLowRate),
      lowMax: Number(settings.gstSlabLowMax),
      highRate: Number(settings.gstSlabHighRate),
    });
    const gstMode = settings.gstMode ?? "exclusive";
    const { subtotal, gstAmount, grandTotal } = calcGstBreakdown(roomAmount, gstRate, gstMode);

    // Hard guard: advance can never exceed the bill. Over-collecting at
    // booking would create a negative balance_due and silently turn the
    // surplus into a phantom wallet credit, which is exactly the kind of
    // accounting hole this PMS shouldn't allow. Staff should record the
    // exact amount, then add a real wallet-credit entry separately if the
    // guest is pre-paying for a future stay.
    if (input.advancePaid > grandTotal + 0.009) {
      return fail(
        res,
        400,
        "ADVANCE_TOO_HIGH",
        `Advance ₹${input.advancePaid.toFixed(2)} exceeds grand total ₹${grandTotal.toFixed(2)}`,
      );
    }

    // Wrap everything in a single tx. Take per-room advisory locks first so
    // concurrent reservation creates for the same room serialize cleanly, then
    // re-check availability inside the locked window before inserting. The
    // sequence allocator also runs inside the tx with its own advisory lock,
    // so unique reservation_number collisions are impossible.
    let unavailableRoom: string | null = null;
    let created: typeof reservations.$inferSelect | null = null;
    let walletApplied = 0;
    type InsufficientInfo = { requested: number; available: number };
    const insufficientRef: { value: InsufficientInfo | null } = { value: null };
    try {
      created = await db.transaction(async (tx) => {
        // Deterministic lock order to avoid deadlocks between concurrent creates.
        const sorted = [...roomIds].sort();
        for (const rid of sorted) {
          await lockRoom(tx, rid);
        }

        for (const roomId of roomIds) {
          const ok = await isRoomAvailable(
            roomId,
            input.checkInDate,
            input.checkOutDate,
            undefined,
            tx,
          );
          if (!ok) {
            unavailableRoom = roomId;
            throw new Error("ROOM_UNAVAILABLE");
          }
        }

        // Wallet credit handling: cap requested amount at both (a) the
        // grandTotal (no over-applying) and (b) the guest's current balance.
        // Take a guest-scoped advisory lock so two concurrent applies can't
        // both pass the balance check and over-spend.
        const requestedCredit = +(input.useWalletCredit ?? 0).toFixed(2);
        if (requestedCredit > 0) {
          await lockKey(tx, `guest-wallet:${input.guestId}`);
          const balance = await getGuestBalance(input.guestId, tx);
          const cappedToBill = Math.min(requestedCredit, grandTotal);
          if (cappedToBill > balance + 0.009) {
            insufficientRef.value = { requested: cappedToBill, available: balance };
            throw new Error("INSUFFICIENT_WALLET_BALANCE");
          }
          walletApplied = +cappedToBill.toFixed(2);
        }

        const balanceDue = +(grandTotal - input.advancePaid - walletApplied).toFixed(2);

        const seq = await nextDailySequence(`SLDT-RES-%`, tx);
        const resNumber = reservationNumber(seq);

        // For short_stay, fold the chosen band label (e.g. "Day use · 6 hours")
        // into specialRequests so it surfaces on the reservation detail, the
        // receipt, and the invoice without needing another column.
        const composedSpecial = (() => {
          const parts: string[] = [];
          if (isShortStay) {
            const label = input.shortStayLabel?.trim();
            parts.push(label && label.length > 0 ? label : `Day use · ${durationHours} hours`);
          }
          const extra = input.specialRequests?.trim();
          if (extra) parts.push(extra);
          return parts.length ? parts.join(" — ") : null;
        })();

        const [r] = await tx
          .insert(reservations)
          .values({
            reservationNumber: resNumber,
            propertyId,
            guestId: input.guestId,
            checkInDate: input.checkInDate,
            checkOutDate: input.checkOutDate,
            stayType,
            durationHours: isShortStay ? String(durationHours.toFixed(2)) : null,
            numAdults: input.numAdults,
            numChildren: input.numChildren,
            ratePerNight: String(avgRate.toFixed(2)),
            subtotal: String(subtotal),
            gstRate: String(gstRate),
            gstAmount: String(gstAmount),
            grandTotal: String(grandTotal),
            // Snapshot the property's GST mode at create time. Recalcs
            // honour this so a later settings flip doesn't rewrite math
            // on existing bookings.
            gstMode,
            advancePaid: String(input.advancePaid),
            walletCreditApplied: String(walletApplied.toFixed(2)),
            balanceDue: String(balanceDue),
            status: "confirmed",
            bookingSource: input.bookingSource ?? "walkin",
            creditNotes: input.creditNotes ?? null,
            specialRequests: composedSpecial,
            // Phase 2 — rate plan / company / group attribution.
            ratePlanId: input.ratePlanId ?? null,
            ratePlanCode,
            companyId: input.companyId ?? null,
            companyCode,
            groupBlockId: input.groupBlockId ?? null,
            createdBy: req.user!.id,
          })
          .returning();

        // Record the credit_used ledger entry inside the same tx so it
        // commits atomically with the reservation.
        if (walletApplied > 0) {
          await tx.insert(guestLedger).values({
            guestId: input.guestId,
            entryType: "credit_used",
            amount: String(walletApplied.toFixed(2)),
            reservationId: r!.id,
            note: `Applied to booking ${r!.reservationNumber}`,
            createdBy: req.user!.id,
          });
        }

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

        // Always issue a receipt at booking, even when no advance is
        // collected. ₹0 receipts use 'cash' as a placeholder method and
        // carry a different note so reports can distinguish them. The
        // receipt-number sequence is shared with paid receipts.
        {
          const rcpNum = await generateReceiptNumber(tx);
          const amount = input.advancePaid > 0 ? input.advancePaid : 0;
          const method =
            input.advancePaid > 0 && input.advancePaymentMethod
              ? input.advancePaymentMethod
              : "cash";
          const notes =
            input.advancePaid > 0 ? "Advance at booking" : "Booking — no advance collected";
          await tx.insert(payments).values({
            receiptNumber: rcpNum,
            propertyId,
            invoiceId: null,
            reservationId: r!.id,
            amount: String(amount),
            paymentMethod: method,
            receivedBy: req.user!.id,
            notes,
          });
        }

        // Consume the OTP row we pre-verified above, and link it to this
        // reservation so the audit trail shows which booking it unlocked.
        // We do this inside the tx so either the reservation + OTP both
        // commit or neither does — preventing the OTP being re-used.
        if (otpRowIdToConsume) {
          await tx
            .update(otps)
            .set({ consumedAt: new Date(), reservationId: r!.id })
            .where(eq(otps.id, otpRowIdToConsume));
        }

        return r!;
      });
    } catch (err) {
      if (err instanceof Error && err.message === "ROOM_UNAVAILABLE") {
        return fail(res, 409, "ROOM_UNAVAILABLE", `Room is not available for those dates`, {
          roomId: unavailableRoom,
        });
      }
      if (err instanceof Error && err.message === "INSUFFICIENT_WALLET_BALANCE") {
        const info = insufficientRef.value;
        return fail(
          res,
          409,
          "INSUFFICIENT_WALLET_BALANCE",
          `Wallet balance is ₹${info?.available.toFixed(2) ?? "0"} — cannot apply ₹${info?.requested.toFixed(2) ?? "0"}.`,
          info ?? undefined,
        );
      }
      throw err;
    }
    if (!created) {
      return fail(res, 500, "INTERNAL_ERROR", "Reservation creation failed");
    }
    const createdReservation = created;

    await logActivity({
      action: "reservation_created",
      entityType: "reservation",
      entityId: createdReservation.id,
      description: `${createdReservation.reservationNumber} created`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });

    void (async () => {
      try {
        const [g] = await db
          .select()
          .from(guests)
          .where(eq(guests.id, createdReservation.guestId))
          .limit(1);

        // Always dispatch the in-app notification.
        const bookedRooms = await getReservationRoomNumbers(createdReservation.id);
        const roomSuffix = bookedRooms ? ` · Room ${bookedRooms}` : "";
        await dispatchNotification({
          type: "reservation_created",
          title: "New booking",
          body: `${createdReservation.reservationNumber} for ${g?.fullName ?? "guest"}${roomSuffix} (${createdReservation.checkInDate} to ${createdReservation.checkOutDate})`,
          href: `/reservations/${createdReservation.id}`,
          payload: { reservationId: createdReservation.id },
          recipientRoles: ["admin", "frontdesk"],
        });

        // Always render the booking receipt — paid or not. ₹0 advances
        // produce a receipt that says "Amount Received ₹0.00, Balance Due
        // <grand total>". The existing booking_advance_* templates are
        // reused; their copy already reads naturally for the ₹0 case
        // since they reference advance_paid + balance, both of which are
        // accurate in either path.
        {
          let receiptLink = "";
          try {
            const [latestPayment] = await db
              .select()
              .from(payments)
              .where(eq(payments.reservationId, createdReservation.id))
              .orderBy(desc(payments.createdAt))
              .limit(1);
            if (latestPayment) {
              const settingsForPdf = await getSettings();
              const pdf = await renderReceiptPdf({
                payment: latestPayment,
                reservation: createdReservation,
                guest: g!,
                invoice: null,
                settings: settingsForPdf,
              });
              const url = await uploadPublicPdf(
                `receipts/${latestPayment.receiptNumber ?? latestPayment.id}.pdf`,
                pdf,
              );
              if (url) receiptLink = url;
            }
          } catch (err) {
            logger.warn(
              { err, reservationId: createdReservation.id },
              "booking receipt PDF render/upload failed",
            );
          }

          const settingsForMsg = await getSettings();
          const receiptBlock = receiptLink ? `\n\nReceipt: ${receiptLink}` : "";
          const baseVars = {
            hotel: env.HOTEL_DISPLAY_NAME,
            hotel_phone: settingsForMsg.hotelPhone ?? "",
            guest_name: g?.fullName ?? "guest",
            guest_phone: g?.phone ?? "",
            guest_email: g?.email ?? "",
            reservation_number: createdReservation.reservationNumber,
            check_in_date: createdReservation.checkInDate,
            check_out_date: createdReservation.checkOutDate,
            total: createdReservation.grandTotal,
            advance_paid: createdReservation.advancePaid,
            balance: createdReservation.balanceDue,
            receipt_link: receiptLink,
            receipt_block: receiptBlock,
          };

          if (g?.phone) {
            const t = await renderTemplate("booking_advance_guest_sms", baseVars);
            if (t.enabled) await notifyGuestSms({ to: g.phone, text: t.body });
          }
          const ownerT = await renderTemplate("booking_advance_owner_sms", baseVars);
          if (ownerT.enabled) await notifyOwner(ownerT.body);
        }
      } catch (err) {
        logger.warn({ err, reservationId: createdReservation.id }, "post-create notification failed");
      }
    })();

    await invalidateDashboard();
    return ok(res, createdReservation, 201);
  },
);

// Returns the projected impact of shifting this reservation's check-in date to
// today, WITHOUT mutating anything. The client uses this for a confirm-impact
// step before actually committing.
router.get(
  "/:id/early-check-in/preview",
  requireAuth,
  requirePermission("view_reservations"),
  async (req, res) => {
    const id = req.params.id!;
    const r = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
    if (!r.length) return fail(res, 404, "NOT_FOUND", "Reservation not found");
    const current = r[0]!;
    if (current.status !== "confirmed") {
      return fail(
        res,
        409,
        "INVALID_STATUS",
        `Cannot preview early check-in for a ${current.status} reservation`,
      );
    }

    const today = format(new Date(), "yyyy-MM-dd");
    if (current.checkInDate <= today) {
      return fail(res, 400, "NOT_EARLY", "Reservation is not in the future.");
    }
    if (current.checkOutDate <= today) {
      return fail(res, 400, "INVALID_DATES", "Reservation has already passed.");
    }

    const assigned = await db
      .select({ roomId: reservationRooms.roomId, ratePerNight: reservationRooms.ratePerNight })
      .from(reservationRooms)
      .where(eq(reservationRooms.reservationId, id));

    // Same availability check as the commit endpoint. Surface conflict but
    // don't 409 here — let the UI render the impact AND the conflict together
    // so staff sees the full picture.
    const conflictingRoomIds: string[] = [];
    for (const a of assigned) {
      const ok2 = await isRoomAvailable(a.roomId, today, current.checkInDate, id);
      if (!ok2) conflictingRoomIds.push(a.roomId);
    }

    const oldNights = Number(current.numNights);
    const newNights = differenceInCalendarDays(
      new Date(current.checkOutDate),
      new Date(today),
    );
    const extraNights = newNights - oldNights;

    // Honour inclusive vs exclusive mode (see lib/gst.ts). The amount
    // assembled from rate × nights is treated as a gross total when the
    // property is on inclusive pricing.
    const newRoomAmount = +(
      assigned.reduce((a, rm) => a + Number(rm.ratePerNight) * newNights, 0)
    ).toFixed(2);

    const settings = await getSettings();
    const avgRate = assigned.length ? newRoomAmount / (newNights * assigned.length) : 0;
    const newGstRate = getGstRate(avgRate, {
      exemptBelow: Number(settings.gstSlabExemptBelow),
      lowRate: Number(settings.gstSlabLowRate),
      lowMax: Number(settings.gstSlabLowMax),
      highRate: Number(settings.gstSlabHighRate),
    });
    const {
      subtotal: newSubtotal,
      gstAmount: newGstAmount,
      grandTotal: newGrandTotal,
    } = calcGstBreakdown(newRoomAmount, newGstRate, settings.gstMode ?? "exclusive");
    const advancePaid = Number(current.advancePaid);
    const newBalanceDue = +(newGrandTotal - advancePaid).toFixed(2);

    return ok(res, {
      today,
      conflictingRoomIds,
      old: {
        checkInDate: current.checkInDate,
        nights: oldNights,
        subtotal: Number(current.subtotal),
        gstRate: Number(current.gstRate),
        gstAmount: Number(current.gstAmount),
        grandTotal: Number(current.grandTotal),
        balanceDue: Number(current.balanceDue),
      },
      new: {
        checkInDate: today,
        nights: newNights,
        subtotal: newSubtotal,
        gstRate: newGstRate,
        gstAmount: newGstAmount,
        grandTotal: newGrandTotal,
        balanceDue: newBalanceDue,
      },
      delta: {
        extraNights,
        subtotalDelta: +(newSubtotal - Number(current.subtotal)).toFixed(2),
        gstAmountDelta: +(newGstAmount - Number(current.gstAmount)).toFixed(2),
        grandTotalDelta: +(newGrandTotal - Number(current.grandTotal)).toFixed(2),
        balanceDueDelta: +(newBalanceDue - Number(current.balanceDue)).toFixed(2),
      },
      advancePaid,
    });
  },
);

// Shifts a reservation's check-in date to today so the guest can be checked
// in early. Verifies every assigned room is available for the extended
// window — refuses if any room is taken by another booking or in maintenance.
// Recomputes subtotal / GST / grand total / balance based on the new night
// count. Does NOT actually perform check-in; the client should follow up with
// POST /reservations/:id/check-in once this returns success.
router.post(
  "/:id/early-check-in",
  requireAuth,
  requirePermission("view_reservations"),
  async (req, res) => {
    const id = req.params.id!;
    const r = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
    if (!r.length) return fail(res, 404, "NOT_FOUND", "Reservation not found");
    const current = r[0]!;
    if (current.status !== "confirmed") {
      return fail(
        res,
        409,
        "INVALID_STATUS",
        `Cannot early-check-in a ${current.status} reservation`,
      );
    }

    const today = format(new Date(), "yyyy-MM-dd");
    if (current.checkInDate <= today) {
      return fail(
        res,
        400,
        "NOT_EARLY",
        "Reservation is already due today or earlier — use the regular check-in endpoint.",
      );
    }
    if (current.checkOutDate <= today) {
      return fail(
        res,
        400,
        "INVALID_DATES",
        "Reservation has already passed — early check-in not possible.",
      );
    }

    const assigned = await db
      .select({ roomId: reservationRooms.roomId })
      .from(reservationRooms)
      .where(eq(reservationRooms.reservationId, id));

    let unavailableRoom: string | null = null;
    try {
      await db.transaction(async (tx) => {
        // Deterministic lock order to avoid deadlocks with concurrent creates.
        const sorted = [...assigned.map((a) => a.roomId)].sort();
        for (const rid of sorted) {
          await lockRoom(tx, rid);
        }

        // Verify each room is free for the *new* extended window
        // (today → original checkInDate). Exclude this reservation itself.
        for (const a of assigned) {
          const ok2 = await isRoomAvailable(
            a.roomId,
            today,
            current.checkInDate,
            id,
            tx,
          );
          if (!ok2) {
            unavailableRoom = a.roomId;
            throw new Error("ROOM_UNAVAILABLE");
          }
        }

        // Shift the check-in date and recompute totals. numNights is a
        // generated column derived from (checkOutDate - checkInDate), so we
        // only need to update subtotal / gst / grandTotal / balanceDue.
        const newNights = differenceInCalendarDays(
          new Date(current.checkOutDate),
          new Date(today),
        );
        const roomRates = await tx
          .select({ ratePerNight: reservationRooms.ratePerNight })
          .from(reservationRooms)
          .where(eq(reservationRooms.reservationId, id));

        // Mode-aware totals. `newRoomAmount` is the raw rate × nights;
        // the breakdown helper extracts net subtotal vs grand total
        // depending on inclusive/exclusive mode.
        const newRoomAmount = +(
          roomRates.reduce((a, rm) => a + Number(rm.ratePerNight) * newNights, 0)
        ).toFixed(2);

        const settings = await getSettings();
        const avgRate = roomRates.length
          ? newRoomAmount / (newNights * roomRates.length)
          : 0;
        const gstRate = getGstRate(avgRate, {
          exemptBelow: Number(settings.gstSlabExemptBelow),
          lowRate: Number(settings.gstSlabLowRate),
          lowMax: Number(settings.gstSlabLowMax),
          highRate: Number(settings.gstSlabHighRate),
        });
        const { subtotal: newSubtotal, gstAmount, grandTotal } = calcGstBreakdown(
          newRoomAmount,
          gstRate,
          settings.gstMode ?? "exclusive",
        );
        const balanceDue = +(grandTotal - Number(current.advancePaid)).toFixed(2);

        await tx
          .update(reservations)
          .set({
            checkInDate: today,
            ratePerNight: String(avgRate.toFixed(2)),
            subtotal: String(newSubtotal),
            gstRate: String(gstRate),
            gstAmount: String(gstAmount),
            grandTotal: String(grandTotal),
            balanceDue: String(balanceDue),
            updatedAt: new Date(),
          })
          .where(eq(reservations.id, id));
      });
    } catch (err) {
      if (err instanceof Error && err.message === "ROOM_UNAVAILABLE") {
        return fail(
          res,
          409,
          "ROOM_UNAVAILABLE",
          "Room is not available for the extended early-check-in window. Cancel or swap the conflicting reservation first.",
          { roomId: unavailableRoom },
        );
      }
      throw err;
    }

    await logActivity({
      action: "early_check_in",
      entityType: "reservation",
      entityId: id,
      description: `${current.reservationNumber} early check-in: dates shifted from ${current.checkInDate} → ${today}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
      metadata: { originalCheckIn: current.checkInDate, newCheckIn: today },
    });
    await invalidateDashboard();

    const [updated] = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
    return ok(res, updated);
  },
);

router.post(
  "/:id/check-in",
  requireAuth,
  requirePermission("view_reservations"),
  idempotent("reservations.checkIn"),
  validate(checkInSchema),
  async (req, res) => {
    const id = req.params.id!;
    const input = req.body as import("@hoteldesk/shared").CheckInInput;

    const r = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
    if (!r.length) return fail(res, 404, "NOT_FOUND", "Reservation not found");
    if (r[0]!.status !== "confirmed") {
      return fail(res, 409, "INVALID_STATUS", `Cannot check in a ${r[0]!.status} reservation`);
    }

    // Block early check-in. Use the early-check-in endpoint to shift dates and
    // re-verify room availability for the extra nights.
    const today = format(new Date(), "yyyy-MM-dd");
    if (r[0]!.checkInDate > today) {
      return fail(
        res,
        409,
        "EARLY_CHECK_IN",
        `Reservation is for ${r[0]!.checkInDate}. To check in early on ${today}, the booking dates must be shifted and rooms re-verified.`,
        { reservationCheckInDate: r[0]!.checkInDate, today },
      );
    }

    const guestRow = await db
      .select({
        kycVerifiedAt: guests.kycVerifiedAt,
        idProofPhotoFront: guests.idProofPhotoFront,
        guestPhoto: guests.guestPhoto,
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
    if (!guestRow[0]!.guestPhoto) {
      return fail(
        res,
        422,
        "PHOTO_REQUIRED",
        "Customer photo required before check-in. Upload via the KYC documents button.",
      );
    }

    const otpRow = await db
      .select({ id: otps.id })
      .from(otps)
      .where(
        and(
          eq(otps.reservationId, id),
          eq(otps.purpose, "checkin"),
          isNotNull(otps.consumedAt),
          gte(otps.consumedAt, sql`now() - interval '15 minutes'`),
        ),
      )
      .limit(1);
    if (!otpRow.length) {
      return fail(
        res,
        422,
        "OTP_REQUIRED",
        "OTP verification required. Send and verify a code before check-in.",
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

      // Always issue a check-in receipt — paid or not. ₹0 advances at
      // check-in get a receipt with method='cash' so staff have a printable
      // acknowledgement for the guest even when no payment is collected.
      {
        const rcpNum = await generateReceiptNumber(tx);
        const advance = input.advancePayment ?? 0;
        const amount = advance > 0 ? advance : 0;
        const method = advance > 0 && input.paymentMethod ? input.paymentMethod : "cash";
        const notes = advance > 0 ? "Advance at check-in" : "Check-in — no advance collected";
        await tx.insert(payments).values({
          receiptNumber: rcpNum,
          propertyId: r[0]!.propertyId,
          invoiceId: null,
          reservationId: id,
          amount: String(amount),
          paymentMethod: method,
          receivedBy: req.user!.id,
          notes,
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

        // Re-read fresh reservation totals (advance was just applied in the tx)
        const [fresh] = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
        const total = fresh?.grandTotal ?? r[0]!.grandTotal;
        const advancePaid = fresh?.advancePaid ?? r[0]!.advancePaid;
        const balance = fresh?.balanceDue ?? r[0]!.balanceDue;

        const settings = await getSettings();

        // Always render the check-in receipt PDF — paid or not. The
        // payment row was inserted above regardless of advance amount, so
        // there's always exactly one fresh row to render.
        let receiptLink = "";
        try {
          const [latestPayment] = await db
            .select()
            .from(payments)
            .where(eq(payments.reservationId, id))
            .orderBy(desc(payments.createdAt))
            .limit(1);
          if (latestPayment) {
            const pdf = await renderReceiptPdf({
              payment: latestPayment,
              reservation: r[0]!,
              guest: g!,
              invoice: null,
              settings,
            });
            const url = await uploadPublicPdf(
              `receipts/${latestPayment.receiptNumber ?? latestPayment.id}.pdf`,
              pdf,
            );
            if (url) receiptLink = url;
          }
        } catch (err) {
          logger.warn({ err, reservationId: id }, "check-in receipt PDF render/upload failed");
        }

        const wifiBlock =
          settings.wifiSsid && settings.wifiPassword
            ? `\n📶 Wi-Fi: ${settings.wifiSsid} / ${settings.wifiPassword}`
            : "";
        const receiptBlock = receiptLink ? `\n\nView receipt: ${receiptLink}` : "";

        const baseVars = {
          hotel: env.HOTEL_DISPLAY_NAME,
          hotel_phone: settings.hotelPhone ?? "",
          wifi_ssid: settings.wifiSsid ?? "",
          wifi_password: settings.wifiPassword ?? "",
          wifi_block: wifiBlock,
          guest_name: g?.fullName ?? "guest",
          guest_phone: g?.phone ?? "",
          guest_email: g?.email ?? "",
          reservation_number: r[0]!.reservationNumber,
          check_in_date: r[0]!.checkInDate,
          check_out_date: r[0]!.checkOutDate,
          room_numbers: roomNumbers,
          total,
          advance_paid: advancePaid,
          balance,
          receipt_link: receiptLink,
          receipt_block: receiptBlock,
        };
        await dispatchNotification({
          type: "guest_checked_in",
          title: "Guest checked in",
          body: `${g?.fullName ?? "Guest"} checked in (${r[0]!.reservationNumber}${roomNumbers ? ` · Room ${roomNumbers}` : ""})`,
          href: `/reservations/${id}`,
          payload: { reservationId: id },
          recipientRoles: ["admin", "frontdesk", "housekeeping"],
        });
        if (g?.phone) {
          const t = await renderTemplate("checkin_guest_sms", baseVars);
          if (t.enabled) await notifyGuestSms({ to: g.phone, text: t.body });
        }
        const ownerT = await renderTemplate("checkin_owner_sms", baseVars);
        if (ownerT.enabled) await notifyOwner(ownerT.body);
      } catch (err) {
        logger.warn({ err, reservationId: id }, "post-check-in notification failed");
      }
    })();

    await invalidateDashboard();
    return ok(res, { success: true });
  },
);

router.post(
  "/:id/check-out",
  requireAuth,
  requirePermission("view_reservations"),
  idempotent("reservations.checkOut"),
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
    const labelMap = await buildRoomTypeLabelMap();

    const isShortStayInvoice = r[0]!.stayType === "short_stay";
    const shortStayHours = Number(r[0]!.durationHours ?? 0);
    const nights = Number(r[0]!.numNights);
    // For short_stay the room line is one flat charge (quantity 1, rate =
    // the FLAT short-stay price stored on reservation_rooms.ratePerNight).
    // For overnight we keep the original "rate × nights" line.
    const roomUnits = isShortStayInvoice ? 1 : nights;
    const roomGstRate = Number(r[0]!.gstRate);
    const reservationGstMode = r[0]!.gstMode ?? "exclusive";

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
      // In exclusive mode the stored rate IS the net price per unit.
      // In inclusive mode the stored rate is the gross per unit, so we
      // extract the per-unit net via the breakdown helper and store
      // that as the line item's `rate` and `amount` (×qty). The
      // breakdown's grand_total == stored gross == what the guest pays.
      const storedRate = Number(rr.rr.ratePerNight);
      const lineGross = +(storedRate * roomUnits).toFixed(2);
      const lineBreakdown = calcGstBreakdown(lineGross, roomGstRate, reservationGstMode);
      const netRate =
        reservationGstMode === "inclusive" && roomUnits > 0
          ? +(lineBreakdown.subtotal / roomUnits).toFixed(2)
          : storedRate;
      const amount = lineBreakdown.subtotal;
      const gstAmount = lineBreakdown.gstAmount;
      subtotal += amount;
      // If staff used the "Sell as" picker on the booking form, show both:
      // "<physical> booked as <sold-as>". If no override, show just the
      // physical label. See lib/roomTypeLabel.ts.
      const displayType = combinedRoomTypeLabel(
        rr.room.roomType,
        rr.rr.soldAsType,
        labelMap,
      );
      const description = isShortStayInvoice
        ? `Room ${rr.room.roomNumber} - ${displayType} (Day use · ${shortStayHours} hours)`
        : `Room ${rr.room.roomNumber} - ${displayType} (${nights} nights)`;
      lineItems.push({
        description,
        // 996311 — Room/unit accommodation services by hotels, inn, guest
        // houses. The precise SAC for hotel room nights. 9963 (chapter)
        // is still valid but 996311 is the recommended 6-digit form.
        sacCode: "996311",
        quantity: roomUnits,
        rate: String(netRate),
        amount: String(amount),
        gstRate: String(roomGstRate),
        gstAmount: String(gstAmount),
        itemType: "room_charge",
      });
    }

    // The room GST is already captured per-line above. Sum it instead of
    // applying the rate to the subtotal again (which would double-count
    // in inclusive mode and slightly drift in exclusive mode).
    let totalGst = +lineItems
      .reduce((s, li) => s + Number(li.gstAmount), 0)
      .toFixed(2);
    for (const c of charges) {
      const amount = Number(c.amount);
      const gstAmount = +(amount * (Number(c.gstRate) / 100)).toFixed(2);
      subtotal += amount;
      totalGst += gstAmount;
      lineItems.push({
        description: c.description,
        // 9963 (chapter-level) for misc additional charges. Restaurant,
        // laundry etc. have their own 6-digit codes — if you start
        // categorising charges in Settings, swap to the specific one.
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
    // Wallet credit already applied to this reservation reduces what's owed
    // at checkout — count it just like cash already paid in.
    const walletCreditApplied = Number(r[0]!.walletCreditApplied ?? 0);
    const isUnpaid = input.paymentMethod === "unpaid";

    // Require a method whenever any balance remains.
    // If already overpaid (e.g. early checkout), no final payment is required.
    const remainingBeforeFinal = +(grandTotal - previouslyPaid - walletCreditApplied).toFixed(2);
    if (remainingBeforeFinal > 0.009) {
      if (!input.paymentMethod) {
        return fail(res, 400, "PAYMENT_REQUIRED", "Payment method is required at check-out");
      }
      if (finalPayment <= 0.009) {
        return fail(res, 400, "PAYMENT_REQUIRED", "Final payment amount is required at check-out");
      }
      if (isUnpaid && (!input.paymentNotes || input.paymentNotes.trim() === "")) {
        return fail(res, 400, "NOTES_REQUIRED", "Notes are required for unpaid checkouts");
      }
    }

    // Pending (unpaid) payments don't actually clear the balance.
    // Wallet credit is treated as already-applied money against the bill.
    const realFinalPaid = isUnpaid ? 0 : finalPayment;
    const collectedSoFar = +(previouslyPaid + realFinalPaid + walletCreditApplied).toFixed(2);
    const overpaidAmount = +(collectedSoFar - grandTotal).toFixed(2);
    const hasOverpaid = overpaidAmount > 0.009;
    if (hasOverpaid && !input.refundMode) {
      return fail(
        res,
        400,
        "REFUND_MODE_REQUIRED",
        `Guest overpaid by ₹${overpaidAmount}. Choose refund mode (cash or credit).`,
      );
    }
    const totalPaid = hasOverpaid ? grandTotal : collectedSoFar;
    const balanceDue = +(grandTotal - totalPaid).toFixed(2);
    const invStatus =
      balanceDue <= 0.009 ? "paid" : totalPaid > 0 ? "partial" : "issued";

    const cgstRate = +(roomGstRate / 2).toFixed(2);
    const sgstRate = +(roomGstRate / 2).toFixed(2);

    let invNumber = "";
    const created = await db.transaction(async (tx) => {
      const invoiceSeq = await nextInvoiceSequence(`SLDT-INV-%`, tx);
      invNumber = invoiceNumber(settings.invoicePrefix, invoiceSeq);
      const [inv] = await tx
        .insert(invoices)
        .values({
          invoiceNumber: invNumber,
          propertyId: r[0]!.propertyId,
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
          walletCreditApplied: String(walletCreditApplied.toFixed(2)),
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
        const rcpNum = await generateReceiptNumber(tx);
        await tx.insert(payments).values({
          receiptNumber: rcpNum,
          propertyId: r[0]!.propertyId,
          invoiceId: inv!.id,
          reservationId: id,
          amount: String(finalPayment),
          paymentMethod: input.paymentMethod,
          status: isUnpaid ? "pending" : "received",
          receivedBy: req.user!.id,
          notes: input.paymentNotes ?? null,
        });
      }

      if (hasOverpaid && input.refundMode === "credit") {
        await tx.insert(guestLedger).values({
          guestId: r[0]!.guestId,
          entryType: "credit_issued",
          amount: String(overpaidAmount.toFixed(2)),
          reservationId: id,
          invoiceId: inv!.id,
          note:
            input.refundNote ??
            `Refund issued as wallet credit on early checkout (reservation ${r[0]!.reservationNumber})`,
          createdBy: req.user!.id,
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

      const checkoutRoomIds = resRooms.map((x) => x.room.id);
      await tx
        .update(rooms)
        .set({ status: "dirty", updatedAt: new Date() })
        .where(inArray(rooms.id, checkoutRoomIds));

      // Phase 2: auto-create a checkout-clean housekeeping task per
      // vacated room with the default checklist. Inside the same tx so
      // the task only exists if checkout actually committed. Idempotent
      // per (reservation, room) — a re-run won't duplicate.
      for (const roomId of checkoutRoomIds) {
        const [hkTask] = await tx
          .insert(housekeepingTasks)
          .values({
            propertyId: r[0]!.propertyId,
            roomId,
            reservationId: id,
            taskType: "checkout_clean",
            status: "pending",
            priority: 70,
            createdBy: req.user!.id,
          })
          .returning({ id: housekeepingTasks.id });
        if (hkTask) {
          await tx.insert(housekeepingTaskSteps).values(
            DEFAULT_TASK_STEPS.checkout_clean.map((label, i) => ({
              taskId: hkTask.id,
              label,
              sortOrder: (i + 1) * 10,
            })),
          );
        }
      }

      return inv!;
    });

    void (async () => {
      try {
        const [g] = await db.select().from(guests).where(eq(guests.id, r[0]!.guestId)).limit(1);

        // Generate invoice PDF and upload for public link
        let invoiceLink = "";
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
              stay: {
                checkInDate: r[0]!.checkInDate,
                checkOutDate: r[0]!.checkOutDate,
                numNights: Number(r[0]!.numNights),
                stayType: r[0]!.stayType,
                durationHours: r[0]!.durationHours ? Number(r[0]!.durationHours) : null,
                checkedInAt: r[0]!.checkedInAt
                  ? r[0]!.checkedInAt.toISOString()
                  : null,
              },
            });
            const url = await uploadPublicPdf(`invoices/${invNumber}.pdf`, pdf);
            if (url) invoiceLink = url;
          }
        } catch (err) {
          logger.warn({ err, invoiceNumber: invNumber }, "invoice PDF render/upload failed");
        }

        const settingsCo = await getSettings();
        const baseVars = {
          hotel: env.HOTEL_DISPLAY_NAME,
          hotel_phone: settingsCo.hotelPhone ?? "",
          guest_name: g?.fullName ?? "guest",
          guest_phone: g?.phone ?? "",
          guest_email: g?.email ?? "",
          reservation_number: r[0]!.reservationNumber,
          check_out_date: r[0]!.checkOutDate,
          invoice_number: invNumber,
          invoice_link: invoiceLink,
          total: r[0]!.grandTotal,
        };

        const checkedOutRooms = await getReservationRoomNumbers(id);
        const coRoomSuffix = checkedOutRooms ? ` · Room ${checkedOutRooms}` : "";
        await dispatchNotification({
          type: "guest_checked_out",
          title: "Guest checked out",
          body: `${g?.fullName ?? "Guest"} (${r[0]!.reservationNumber}${coRoomSuffix}). Invoice ${invNumber}.`,
          href: `/reservations/${id}`,
          payload: { reservationId: id, invoiceNumber: invNumber, invoiceLink },
          recipientRoles: ["admin", "frontdesk", "housekeeping"],
        });
        if (g?.phone) {
          const t = await renderTemplate("checkout_guest_sms", baseVars);
          if (t.enabled) await notifyGuestSms({ to: g.phone, text: t.body });
        }
        const ownerT = await renderTemplate("checkout_owner_sms", baseVars);
        if (ownerT.enabled) await notifyOwner(ownerT.body);

        // Phase 5 — review automation. We schedule a follow-up review
        // prompt 4 hours after checkout (long enough for the guest to
        // have gotten home + settled in, short enough to be on the same
        // day they remember the stay). The link points to GOOGLE_REVIEW_URL
        // if set; otherwise we send the bare prompt.
        //
        // NOTE: this uses setTimeout, which is in-process and lost on
        // restart. For a busier property, swap for a job queue.
        if (g?.phone) {
          const reviewLink = (env.GOOGLE_REVIEW_URL ?? "").trim();
          const reviewVars = {
            ...baseVars,
            review_link: reviewLink,
          };
          const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
          setTimeout(() => {
            void (async () => {
              try {
                const t = await renderTemplate("review_prompt_guest_sms", reviewVars);
                if (t.enabled && g.phone) {
                  await notifyGuestSms({ to: g.phone, text: t.body });
                }
              } catch (e) {
                logger.warn(
                  { err: e, reservationId: id },
                  "review-prompt send failed",
                );
              }
            })();
          }, FOUR_HOURS_MS).unref();
        }
      } catch (err) {
        logger.warn({ err, reservationId: id }, "post-check-out notification failed");
      }
    })();

    await logActivity({
      action: "check_out",
      entityType: "reservation",
      entityId: id,
      description: `${r[0]!.reservationNumber} checked out, invoice ${invNumber}${hasOverpaid ? ` (refund ₹${overpaidAmount} as ${input.refundMode})` : ""}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
      metadata: {
        invoiceId: created.id,
        finalPayment,
        overpaidAmount: hasOverpaid ? overpaidAmount : 0,
        refundMode: hasOverpaid ? input.refundMode : null,
      },
    });
    await invalidateDashboard();
    return ok(res, { invoice: created });
  },
);

// Reclassify an existing booking as complimentary AFTER it was created.
// Pure accounting reclassification — nothing destructive. The invoice
// (if any) and all payments stay exactly as they are.
//
// The product rule is: a complimentary booking is REMOVED from every
// "real revenue" surface (Dashboard revenue, Revenue report, GST report,
// Collections, Room Performance, main Reservations list) and APPEARS
// ONLY in the Complimentary report. The booking row itself is kept so
// the URL still resolves and the guest's stay history still shows the
// stay happened.
//
// Implementation: filter out `bookingSource = 'complimentary'` in every
// revenue query. The comp report is the single place that includes them.
//
// Works on confirmed / checked_in / checked_out. Blocked on cancelled
// and already-complimentary.
router.post(
  "/:id/make-complimentary",
  requireAuth,
  requirePermission("view_reservations"),
  validate(makeComplimentarySchema),
  async (req, res) => {
    const id = req.params.id!;
    const { reason, approver } = req.body as { reason: string; approver?: string | null };

    const r = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
    if (!r.length) return fail(res, 404, "NOT_FOUND", "Reservation not found");
    const current = r[0]!;

    if (!["confirmed", "checked_in", "checked_out"].includes(current.status)) {
      return fail(
        res,
        409,
        "INVALID_STATUS",
        `Cannot reclassify a ${current.status} reservation as complimentary.`,
      );
    }

    if (current.bookingSource === "complimentary") {
      return fail(res, 409, "ALREADY_COMPLIMENTARY", "This booking is already complimentary.");
    }

    // Compose the audit trail string we store on creditNotes. Pairs the
    // human reason with the approver name when given, plus the prior
    // bookingSource + status so we can tell at a glance the prior state
    // ("was walkin / checked_out — comped on <date>").
    const stamp = new Date().toISOString();
    const previousSource = current.bookingSource;
    const composedNote = [
      `Comped on ${stamp} (was ${previousSource}, status ${current.status})`,
      approver?.trim() ? `Approved by: ${approver.trim()}` : null,
      `Reason: ${reason.trim()}`,
      current.creditNotes ? `Prior notes: ${current.creditNotes}` : null,
    ]
      .filter(Boolean)
      .join(" — ");

    // Pure reclassification — no invoice or payment changes. Every revenue
    // query filters on bookingSource so this booking will silently fall
    // out of Dashboard / Revenue / GST / Collections / Room Performance,
    // and the Complimentary report (which filters the other direction)
    // will pick it up.
    await db
      .update(reservations)
      .set({
        bookingSource: "complimentary",
        creditNotes: composedNote,
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, id));

    await logActivity({
      action: "reservation_made_complimentary",
      entityType: "reservation",
      entityId: id,
      description: `${current.reservationNumber} reclassified as complimentary (was ${previousSource})`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
      metadata: {
        previousSource,
        previousStatus: current.status,
        reason: reason.trim(),
        approver: approver?.trim() || null,
        grandTotal: current.grandTotal,
      },
    });
    await invalidateDashboard();

    const [updated] = await db
      .select()
      .from(reservations)
      .where(eq(reservations.id, id))
      .limit(1);
    return ok(res, updated);
  },
);

router.post(
  "/:id/cancel",
  requireAuth,
  requirePermission("view_reservations"),
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

    // Room target status after cancel: a confirmed (not-yet-arrived) booking
    // frees the room outright; a checked_in booking leaves the room dirty
    // because the guest physically used it.
    const wasCheckedIn = r[0]!.status === "checked_in";
    const targetRoomStatus = wasCheckedIn ? "dirty" : "available";

    let voidedPaymentCount = 0;
    let voidedPaymentTotal = 0;
    const walletCreditRestored = Number(r[0]!.walletCreditApplied ?? 0);

    await db.transaction(async (tx) => {
      // 1. Void every non-voided payment on this reservation. Cancellation
      //    reverses the entire booking; any cash collected goes back to the
      //    guest (or sits as wallet credit if the staff chose that, but we
      //    don't auto-issue credit here — that's a staff decision in a
      //    separate flow).
      const livePays = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.reservationId, id), eq(payments.voided, false)));
      for (const p of livePays) {
        await tx
          .update(payments)
          .set({
            voided: true,
            voidedReason: `Reservation cancelled: ${cancellationReason}`,
            voidedBy: req.user!.id,
            voidedAt: new Date(),
          })
          .where(eq(payments.id, p.id));
        if (p.status === "received") {
          voidedPaymentCount += 1;
          voidedPaymentTotal += Number(p.amount);
        }
      }

      // 2. If wallet credit had been applied to this reservation, refund it
      //    back to the guest's wallet as a new credit_issued entry. The
      //    original credit_used entry stays (audit trail), but the new
      //    entry zeroes its effect on the running balance. We lock the
      //    guest's wallet first so concurrent applies elsewhere can't race.
      if (walletCreditRestored > 0.009) {
        await lockKey(tx, `guest-wallet:${r[0]!.guestId}`);
        await tx.insert(guestLedger).values({
          guestId: r[0]!.guestId,
          entryType: "credit_issued",
          amount: String(walletCreditRestored.toFixed(2)),
          reservationId: id,
          note: `Refund: cancelled reservation ${r[0]!.reservationNumber}`,
          createdBy: req.user!.id,
        });
      }

      // 3. Update the reservation: status + clear balance + reset
      //    advancePaid + walletCreditApplied (everything is voided/refunded).
      //    The grandTotal stays for historical record.
      await tx
        .update(reservations)
        .set({
          status: "cancelled",
          cancellationReason,
          advancePaid: "0",
          walletCreditApplied: "0",
          balanceDue: "0",
          updatedAt: new Date(),
        })
        .where(eq(reservations.id, id));

      // 4. Free / dirty the rooms.
      if (roomIds.length) {
        await tx
          .update(rooms)
          .set({ status: targetRoomStatus, updatedAt: new Date() })
          .where(inArray(rooms.id, roomIds));
      }
    });

    const descBits = [
      `${r[0]!.reservationNumber} cancelled: ${cancellationReason}`,
    ];
    if (voidedPaymentCount > 0) {
      descBits.push(`${voidedPaymentCount} payment(s) voided, ₹${voidedPaymentTotal.toFixed(2)} reversed`);
    }
    if (walletCreditRestored > 0.009) {
      descBits.push(`₹${walletCreditRestored.toFixed(2)} wallet credit refunded`);
    }
    await logActivity({
      action: "reservation_cancelled",
      entityType: "reservation",
      entityId: id,
      description: descBits.join(" · "),
      performedBy: req.user!.id,
      ipAddress: req.ip,
      metadata: {
        voidedPaymentCount,
        voidedPaymentTotal,
        walletCreditRestored,
        roomStatus: targetRoomStatus,
      },
    });
    await invalidateDashboard();
    return ok(res, {
      success: true,
      voidedPaymentCount,
      voidedPaymentTotal,
      walletCreditRestored,
      roomStatus: targetRoomStatus,
    });
  },
);

router.post(
  "/:id/swap-room",
  requireAuth,
  requirePermission("view_reservations"),
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
  requirePermission("view_reservations"),
  idempotent("reservations.addCharge"),
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

    await recalcReservation(id);
    await logActivity({
      action: "charge_added",
      entityType: "reservation",
      entityId: id,
      description: `Charge: ${input.description} ₹${amount}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    await invalidateDashboard();
    return ok(res, created, 201);
  },
);

router.post(
  "/:id/extend",
  requireAuth,
  requirePermission("view_reservations"),
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
    if (current.stayType === "short_stay") {
      return fail(
        res,
        400,
        "SHORT_STAY_NOT_EXTENDABLE",
        "Short-stay (day-use) bookings can't be extended. Create a new reservation instead.",
      );
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

    // Number of NEW nights being added (the extension window only).
    const extraNights = differenceInCalendarDays(
      new Date(input.newCheckOutDate),
      new Date(current.checkOutDate),
    );

    // Pricing model for the extension:
    //   - The existing nights keep their rate. We do NOT touch
    //     reservation_rooms.ratePerNight, so recalcReservation continues
    //     to bill the room at its original rate for ALL nights (including
    //     the new ones at the original rate).
    //   - If the staff agreed a DIFFERENT rate for the new night(s), we
    //     don't re-rate the whole stay. Instead we add a single
    //     "Stay extension" additional_charge for the DELTA only:
    //         extraNights × (newRate − roomRate) × roomCount
    //     Added to the room line (original rate × all nights), this
    //     yields exactly: oldNights×oldRate + newNights×newRate.
    //   - If no rate (or the same rate) is given, the new nights simply
    //     bill at the existing room rate and no extra charge is created.
    //
    // The delta charge is taxed at the same GST slab as the room so the
    // extra night is treated consistently with the rest of the stay.
    //
    // GST MODE: the extension must honour the reservation's GST mode so
    // it matches the rest of the bill.
    //   - exclusive: the agreed per-night rate is NET. The delta is net
    //     and we store it as-is; recalcReservation adds GST on top.
    //   - inclusive: the agreed per-night rate is GROSS (all-in). The
    //     guest expects ₹2,000/night to mean ₹2,000 including tax, same
    //     as the room nights. But recalcReservation always treats a
    //     charge's stored `amount` as NET and re-adds GST on top. So we
    //     extract the NET portion from the gross delta here, store that;
    //     recalc then adds the GST back → the line totals to the gross
    //     the guest agreed to. Net result: identical tax treatment to
    //     the inclusive-mode room nights.
    const settings = await getSettings();
    const reservationGstMode = current.gstMode ?? "exclusive";
    let extensionChargeId: string | null = null;
    if (input.ratePerNight && assigned.length > 0) {
      // Per-room delta vs each room's own rate (rooms can differ). This
      // delta is in the SAME mode as the rates (gross if inclusive, net
      // if exclusive) because both sides of the subtraction are in that
      // mode.
      let deltaAmount = 0;
      for (const rm of assigned) {
        const delta = (input.ratePerNight - Number(rm.ratePerNight)) * extraNights;
        deltaAmount += delta;
      }
      deltaAmount = +deltaAmount.toFixed(2);

      // Only create a charge if the agreed rate actually differs. A zero
      // or negative-rounding delta means "same rate" → nothing to add.
      if (Math.abs(deltaAmount) > 0.009) {
        const gstRate = getGstRate(input.ratePerNight, {
          exemptBelow: Number(settings.gstSlabExemptBelow),
          lowRate: Number(settings.gstSlabLowRate),
          lowMax: Number(settings.gstSlabLowMax),
          highRate: Number(settings.gstSlabHighRate),
        });
        // In inclusive mode, convert the gross delta to its net portion
        // so recalc's add-GST-on-top yields the original gross. In
        // exclusive mode the delta is already net — store as-is.
        const storedAmount =
          reservationGstMode === "inclusive"
            ? calcGstBreakdown(deltaAmount, gstRate, "inclusive").subtotal
            : deltaAmount;
        const nightWord = extraNights === 1 ? "night" : "nights";
        const [charge] = await db
          .insert(additionalCharges)
          .values({
            reservationId: id,
            description: `Stay extension — ${extraNights} ${nightWord} @ ₹${input.ratePerNight.toFixed(2)}/night${reservationGstMode === "inclusive" ? " (incl. GST)" : ""}`,
            quantity: 1,
            rate: String(storedAmount.toFixed(2)),
            amount: String(storedAmount.toFixed(2)),
            gstRate: String(gstRate),
            addedBy: req.user!.id,
          })
          .returning();
        extensionChargeId = charge?.id ?? null;
      }
    }

    // Extend the dates only. The room rate is intentionally left as-is so
    // existing nights aren't re-priced.
    await db
      .update(reservations)
      .set({
        checkOutDate: input.newCheckOutDate,
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, id));

    await recalcReservation(id);
    const [updated] = await db
      .select()
      .from(reservations)
      .where(eq(reservations.id, id))
      .limit(1);

    await logActivity({
      action: "reservation_extended",
      entityType: "reservation",
      entityId: id,
      description: input.ratePerNight
        ? `${current.reservationNumber} extended to ${input.newCheckOutDate} (+${extraNights} night${extraNights === 1 ? "" : "s"} @ ₹${input.ratePerNight.toFixed(2)})`
        : `${current.reservationNumber} extended to ${input.newCheckOutDate} (+${extraNights} night${extraNights === 1 ? "" : "s"} at existing rate)`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
      metadata: {
        oldCheckOut: current.checkOutDate,
        newCheckOut: input.newCheckOutDate,
        extraNights,
        extensionRate: input.ratePerNight ?? null,
        extensionChargeId,
      },
    });
    await invalidateDashboard();
    return ok(res, updated);
  },
);

router.post(
  "/:id/late-checkout",
  requireAuth,
  requirePermission("view_reservations"),
  validate(lateCheckoutSchema),
  async (req, res) => {
    const id = req.params.id!;
    const input = req.body as { hours: number; fee: number; notes?: string | null };

    const r = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
    if (!r[0]) return fail(res, 404, "NOT_FOUND", "Reservation not found");
    if (r[0].status !== "confirmed" && r[0].status !== "checked_in") {
      return fail(res, 400, "INVALID_STATE", "Only active reservations can have late checkout");
    }
    if (r[0].stayType === "short_stay") {
      return fail(
        res,
        400,
        "SHORT_STAY_NO_LATE_CHECKOUT",
        "Late checkout doesn't apply to short-stay (day-use) bookings.",
      );
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

    // Always persist the granted hours so the dashboard's checkout-alert
    // query can compute the effective check-out time. Hours stack with any
    // prior late-checkout grant for the same stay.
    const cumulativeHours = +(
      Number(r[0].lateCheckoutHours ?? 0) + input.hours
    ).toFixed(2);
    if (input.fee > 0) {
      const newBalance = +(Number(r[0].balanceDue) + input.fee).toFixed(2);
      const newGrand = +(Number(r[0].grandTotal) + input.fee).toFixed(2);
      await db
        .update(reservations)
        .set({
          grandTotal: String(newGrand),
          balanceDue: String(newBalance),
          lateCheckoutHours: String(cumulativeHours),
          updatedAt: new Date(),
        })
        .where(eq(reservations.id, id));
    } else {
      await db
        .update(reservations)
        .set({
          lateCheckoutHours: String(cumulativeHours),
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
  requirePermission("view_reservations"),
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
    const addedRoomAmount = +(input.ratePerNight * addedNights).toFixed(2);

    const settings = await getSettings();
    const gstMode = settings.gstMode ?? "exclusive";
    const gstRate = getGstRate(input.ratePerNight, {
      exemptBelow: Number(settings.gstSlabExemptBelow),
      lowRate: Number(settings.gstSlabLowRate),
      lowMax: Number(settings.gstSlabLowMax),
      highRate: Number(settings.gstSlabHighRate),
    });
    const effectiveGstRate = Math.max(Number(current.gstRate), gstRate);
    // Combine the existing booking with the added room. In exclusive
    // mode we sum the stored net subtotals (input.ratePerNight is net).
    // In inclusive mode we sum gross amounts (input.ratePerNight is gross,
    // current.grandTotal is gross) and let the breakdown helper extract
    // the new net subtotal.
    const combinedAmount =
      gstMode === "inclusive"
        ? +(Number(current.grandTotal) + addedRoomAmount).toFixed(2)
        : +(Number(current.subtotal) + addedRoomAmount).toFixed(2);
    const {
      subtotal: newSubtotal,
      gstAmount,
      grandTotal,
    } = calcGstBreakdown(combinedAmount, effectiveGstRate, gstMode);
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
    return ok(res, { success: true, addedSubtotal: addedRoomAmount, newGrandTotal: grandTotal }, 201);
  },
);

async function getReservationRoomNumbers(reservationId: string): Promise<string> {
  const rows = await db
    .select({ roomNumber: rooms.roomNumber })
    .from(reservationRooms)
    .innerJoin(rooms, eq(rooms.id, reservationRooms.roomId))
    .where(eq(reservationRooms.reservationId, reservationId))
    .orderBy(rooms.roomNumber);
  return rows.map((r) => r.roomNumber).join(", ");
}

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

  // For short-stay, ratePerNight on reservation_rooms holds the FLAT
  // short-stay price for the chosen duration. The recalc multiplies by 1
  // (not by night count) so dates-edit / room-rate-edit on day-use bookings
  // recompute correctly. Overnight stays still multiply by nights.
  const isShortStay = current.stayType === "short_stay";
  const nights = isShortStay
    ? 1
    : differenceInCalendarDays(new Date(current.checkOutDate), new Date(current.checkInDate));
  // Mode-aware math, snapshotted from the reservation row so a later
  // settings flip doesn't rewrite history.
  //   exclusive: stored room rate IS net; sum gives net subtotal.
  //   inclusive: stored room rate IS gross; sum gives gross room total
  //              and we extract net subtotal via calcGstBreakdown.
  // additionalCharges always store a net amount + GST rate of their own
  // (the schema predates inclusive mode), so they get treated as
  // exclusive regardless of the reservation's mode.
  const reservationGstMode = current.gstMode ?? "exclusive";
  const roomAmount = assigned.reduce((a, rm) => a + Number(rm.ratePerNight) * nights, 0);

  const settings = await getSettings();
  const avgRate = assigned.length ? roomAmount / (nights * assigned.length) : 0;
  const roomGstRate = getGstRate(avgRate, {
    exemptBelow: Number(settings.gstSlabExemptBelow),
    lowRate: Number(settings.gstSlabLowRate),
    lowMax: Number(settings.gstSlabLowMax),
    highRate: Number(settings.gstSlabHighRate),
  });
  const roomBreakdown = calcGstBreakdown(roomAmount, roomGstRate, reservationGstMode);
  const roomNet = roomBreakdown.subtotal;
  const roomGst = roomBreakdown.gstAmount;
  const chargesSubtotal = charges.reduce((a, c) => a + Number(c.amount), 0);
  const chargesGst = charges.reduce(
    (a, c) => a + +(Number(c.amount) * (Number(c.gstRate) / 100)).toFixed(2),
    0,
  );
  const subtotal = +(roomNet + chargesSubtotal).toFixed(2);
  const gstAmount = +(roomGst + chargesGst).toFixed(2);
  const grandTotal = +(subtotal + gstAmount).toFixed(2);
  const balanceDue = +(grandTotal - Number(current.advancePaid)).toFixed(2);

  await db
    .update(reservations)
    .set({
      subtotal: String(subtotal),
      gstRate: String(roomGstRate),
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
  requirePermission("view_reservations"),
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
  requirePermission("view_reservations"),
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
  requirePermission("view_reservations"),
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
  requirePermission("view_reservations"),
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

    const [stayRow] = await db
      .select({ stayType: reservations.stayType })
      .from(reservations)
      .where(eq(reservations.id, id))
      .limit(1);
    if (stayRow?.stayType === "short_stay" && checkInDate !== checkOutDate) {
      return fail(
        res,
        400,
        "INVALID_DATES",
        "Short-stay bookings must check-in and check-out on the same date",
      );
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

router.get("/:id/charges", requireAuth, requirePermission("view_reservations"), async (req, res) => {
  const id = req.params.id!;
  const rows = await db
    .select()
    .from(additionalCharges)
    .where(eq(additionalCharges.reservationId, id))
    .orderBy(asc(additionalCharges.createdAt));
  return ok(res, rows);
});

router.get(
  "/:id/invoice-preview",
  requireAuth,
  requirePermission("view_reservations"),
  async (req, res) => {
    const id = req.params.id!;
    const r = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
    if (!r.length) return fail(res, 404, "NOT_FOUND", "Reservation not found");

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
    const labelMap = await buildRoomTypeLabelMap();

    const nights = Number(r[0]!.numNights);
    const isShortStayPreview = r[0]!.stayType === "short_stay";
    const shortStayHoursPreview = Number(r[0]!.durationHours ?? 0);
    const roomUnitsPreview = isShortStayPreview ? 1 : nights;
    const roomGstRate = Number(r[0]!.gstRate);
    const previewGstMode = r[0]!.gstMode ?? "exclusive";

    let subtotal = 0;
    const lineItems = [] as Array<{
      id: string;
      invoiceId: string;
      description: string;
      sacCode: string;
      quantity: number;
      rate: string;
      amount: string;
      gstRate: string;
      gstAmount: string;
      itemType: "room_charge" | "additional_charge";
      createdAt: Date;
    }>;
    const now = new Date();

    for (const rr of resRooms) {
      const storedRate = Number(rr.rr.ratePerNight);
      const lineGross = +(storedRate * roomUnitsPreview).toFixed(2);
      const lineBreakdown = calcGstBreakdown(lineGross, roomGstRate, previewGstMode);
      const netRate =
        previewGstMode === "inclusive" && roomUnitsPreview > 0
          ? +(lineBreakdown.subtotal / roomUnitsPreview).toFixed(2)
          : storedRate;
      const amount = lineBreakdown.subtotal;
      const gstAmount = lineBreakdown.gstAmount;
      subtotal += amount;
      const displayType = combinedRoomTypeLabel(
        rr.room.roomType,
        rr.rr.soldAsType,
        labelMap,
      );
      const description = isShortStayPreview
        ? `Room ${rr.room.roomNumber} - ${displayType} (Day use · ${shortStayHoursPreview} hours)`
        : `Room ${rr.room.roomNumber} - ${displayType} (${nights} nights)`;
      lineItems.push({
        id: `preview-${rr.room.id}`,
        invoiceId: "preview",
        description,
        // 996311 — Room/unit accommodation services. See checkout flow
        // (router POST /:id/check-out) for the same code on the real
        // invoice this preview mirrors.
        sacCode: "996311",
        quantity: roomUnitsPreview,
        rate: String(netRate),
        amount: String(amount),
        gstRate: String(roomGstRate),
        gstAmount: String(gstAmount),
        itemType: "room_charge",
        createdAt: now,
      });
    }

    // Sum room-line GST instead of re-applying the rate to the subtotal —
    // avoids double counting in inclusive mode and matches the real
    // checkout flow's line-by-line math.
    let totalGst = +lineItems
      .reduce((s, li) => s + Number(li.gstAmount), 0)
      .toFixed(2);
    for (const c of charges) {
      const amount = Number(c.amount);
      const gstAmount = +(amount * (Number(c.gstRate) / 100)).toFixed(2);
      subtotal += amount;
      totalGst += gstAmount;
      lineItems.push({
        id: `preview-${c.id}`,
        invoiceId: "preview",
        description: c.description,
        sacCode: "9963",
        quantity: c.quantity,
        rate: String(c.rate),
        amount: String(amount),
        gstRate: String(c.gstRate),
        gstAmount: String(gstAmount),
        itemType: "additional_charge",
        createdAt: now,
      });
    }

    subtotal = +subtotal.toFixed(2);
    totalGst = +totalGst.toFixed(2);
    const cgst = +(totalGst / 2).toFixed(2);
    const sgst = +(totalGst - cgst).toFixed(2);
    const grandTotal = +(subtotal + totalGst).toFixed(2);
    const totalPaid = Number(r[0]!.advancePaid);
    const balanceDue = +(grandTotal - totalPaid).toFixed(2);
    const status: "issued" | "partial" | "paid" =
      balanceDue <= 0.009 ? "paid" : totalPaid > 0 ? "partial" : "issued";

    const previewInvoice = {
      id: "preview",
      invoiceNumber: "PREVIEW (not issued)",
      reservationId: id,
      guestId: r[0]!.guestId,
      hotelName: settings.hotelName,
      hotelAddress: settings.hotelAddress,
      hotelGstin: settings.hotelGstin,
      guestName: guest.fullName,
      guestAddress: guest.address ?? null,
      guestGstin: guest.gstin ?? null,
      subtotal: String(subtotal),
      cgstRate: String(+(roomGstRate / 2).toFixed(2)),
      cgstAmount: String(cgst),
      sgstRate: String(+(roomGstRate / 2).toFixed(2)),
      sgstAmount: String(sgst),
      grandTotal: String(grandTotal),
      totalPaid: String(totalPaid),
      balanceDue: String(balanceDue),
      status,
      notes: null as string | null,
      reissuedFrom: null as string | null,
      voidedReason: null as string | null,
      voidedBy: null as string | null,
      issuedBy: req.user!.id,
      issueDate: now,
      createdAt: now,
      updatedAt: now,
    };

    const existingPays = await db
      .select()
      .from(payments)
      .where(eq(payments.reservationId, id))
      .orderBy(desc(payments.paymentDate));

    const pdf = await renderInvoicePdf({
      invoice: previewInvoice as never,
      lineItems: lineItems as never,
      payments: existingPays,
      settings,
      stay: {
        checkInDate: r[0]!.checkInDate,
        checkOutDate: r[0]!.checkOutDate,
        numNights: Number(r[0]!.numNights),
        stayType: r[0]!.stayType,
        durationHours: r[0]!.durationHours ? Number(r[0]!.durationHours) : null,
        checkedInAt: r[0]!.checkedInAt ? r[0]!.checkedInAt.toISOString() : null,
      },
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${r[0]!.reservationNumber}-preview.pdf"`,
    );
    return res.send(pdf);
  },
);

const advancePaymentSchema = z.object({
  amount: z.coerce.number().positive(),
  paymentMethod: z.enum(["cash", "upi", "card", "bank_transfer"]),
  notes: z.string().max(500).optional(),
});

router.post(
  "/:id/payments",
  requireAuth,
  requirePermission("view_reservations"),
  idempotent("reservations.advancePayment"),
  validate(advancePaymentSchema),
  async (req, res) => {
    const id = req.params.id!;
    const input = req.body as z.infer<typeof advancePaymentSchema>;

    const r = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
    if (!r.length) return fail(res, 404, "NOT_FOUND", "Reservation not found");
    if (r[0]!.status === "cancelled") {
      return fail(res, 409, "CANCELLED", "Reservation is cancelled");
    }

    const existingInvoice = await db
      .select()
      .from(invoices)
      .where(eq(invoices.reservationId, id))
      .limit(1);

    const created = await db.transaction(async (tx) => {
      const rcpNum = await generateReceiptNumber(tx);
      const [pay] = await tx
        .insert(payments)
        .values({
          receiptNumber: rcpNum,
          propertyId: r[0]!.propertyId,
          invoiceId: existingInvoice[0]?.id ?? null,
          reservationId: id,
          amount: String(input.amount),
          paymentMethod: input.paymentMethod,
          status: "received",
          receivedBy: req.user!.id,
          notes: input.notes ?? null,
        })
        .returning();

      if (existingInvoice.length) {
        const inv = existingInvoice[0]!;
        const newTotalPaid = +(Number(inv.totalPaid) + input.amount).toFixed(2);
        const newBalance = +(Number(inv.grandTotal) - newTotalPaid).toFixed(2);
        const newStatus = newBalance <= 0.009 ? "paid" : "partial";
        await tx
          .update(invoices)
          .set({
            totalPaid: String(newTotalPaid),
            balanceDue: String(newBalance),
            status: newStatus,
            updatedAt: new Date(),
          })
          .where(eq(invoices.id, inv.id));
        await tx
          .update(reservations)
          .set({ balanceDue: String(newBalance), updatedAt: new Date() })
          .where(eq(reservations.id, id));
      } else {
        const newAdvance = +(Number(r[0]!.advancePaid) + input.amount).toFixed(2);
        const newBalance = +(Number(r[0]!.grandTotal) - newAdvance).toFixed(2);
        await tx
          .update(reservations)
          .set({
            advancePaid: String(newAdvance),
            balanceDue: String(newBalance),
            updatedAt: new Date(),
          })
          .where(eq(reservations.id, id));
      }
      return pay!;
    });

    await logActivity({
      action: "payment_recorded",
      entityType: "reservation",
      entityId: id,
      description: `Payment ₹${input.amount} via ${input.paymentMethod} on ${r[0]!.reservationNumber}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    await invalidateDashboard();
    return ok(res, created, 201);
  },
);

// Preview applying wallet credit to a reservation that already exists.
// Returns the maximum redeemable amount (min of guest balance and current
// balance due) so the dialog can show the cap.
router.get(
  "/:id/wallet-credit-preview",
  requireAuth,
  requirePermission("view_reservations"),
  async (req, res) => {
    const id = req.params.id!;
    const [r] = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
    if (!r) return fail(res, 404, "NOT_FOUND", "Reservation not found");

    const balance = await getGuestBalance(r.guestId);
    const reservationBalanceDue = Number(r.balanceDue);
    const maxRedeemable = +Math.min(balance, Math.max(0, reservationBalanceDue)).toFixed(2);

    return ok(res, {
      reservationId: r.id,
      reservationNumber: r.reservationNumber,
      reservationBalanceDue,
      walletBalance: balance,
      walletCreditAlreadyApplied: Number(r.walletCreditApplied),
      maxRedeemable,
    });
  },
);

// Apply wallet credit to an existing reservation. Behaves as a discount —
// reduces reservation.balanceDue, increments reservation.walletCreditApplied,
// and adds a credit_used ledger entry. Capped server-side; refuses if the
// guest balance is too low or the reservation is cancelled.
const applyCreditSchema = z.object({
  amount: z.coerce.number().positive(),
});
router.post(
  "/:id/apply-wallet-credit",
  requireAuth,
  requirePermission("view_reservations"),
  idempotent("reservations.applyWalletCredit"),
  validate(applyCreditSchema),
  async (req, res) => {
    const id = req.params.id!;
    const { amount } = req.body as z.infer<typeof applyCreditSchema>;

    let result:
      | { reservation: typeof reservations.$inferSelect; applied: number; remainingBalance: number }
      | null = null;
    type ConflictInfo = { code: string; message: string; details?: unknown };
    const conflictRef: { value: ConflictInfo | null } = { value: null };

    try {
      result = await db.transaction(async (tx) => {
        const [r] = await tx.select().from(reservations).where(eq(reservations.id, id)).limit(1);
        if (!r) {
          conflictRef.value = { code: "NOT_FOUND", message: "Reservation not found" };
          throw new Error("ABORT");
        }
        if (r.status === "cancelled") {
          conflictRef.value = { code: "CANCELLED", message: "Reservation is cancelled" };
          throw new Error("ABORT");
        }
        const currentBalance = Number(r.balanceDue);
        if (currentBalance <= 0.009) {
          conflictRef.value = {
            code: "NO_BALANCE",
            message: "Reservation has no outstanding balance",
          };
          throw new Error("ABORT");
        }

        await lockKey(tx, `guest-wallet:${r.guestId}`);
        const walletBalance = await getGuestBalance(r.guestId, tx);

        // Cap requested amount at both the wallet balance and the remaining
        // bill — no over-applying, no negative wallet.
        const capped = +Math.min(amount, walletBalance, currentBalance).toFixed(2);
        if (capped <= 0.009) {
          conflictRef.value = {
            code: "INSUFFICIENT_WALLET_BALANCE",
            message: `Wallet balance is ₹${walletBalance.toFixed(2)} — nothing to apply.`,
            details: { walletBalance, currentBalance },
          };
          throw new Error("ABORT");
        }

        const newApplied = +(Number(r.walletCreditApplied) + capped).toFixed(2);
        const newBalance = +(currentBalance - capped).toFixed(2);

        const [updated] = await tx
          .update(reservations)
          .set({
            walletCreditApplied: String(newApplied),
            balanceDue: String(newBalance),
            updatedAt: new Date(),
          })
          .where(eq(reservations.id, r.id))
          .returning();

        await tx.insert(guestLedger).values({
          guestId: r.guestId,
          entryType: "credit_used",
          amount: String(capped.toFixed(2)),
          reservationId: r.id,
          note: `Applied to booking ${r.reservationNumber}`,
          createdBy: req.user!.id,
        });

        return { reservation: updated!, applied: capped, remainingBalance: newBalance };
      });
    } catch (err) {
      const c = conflictRef.value;
      if (err instanceof Error && err.message === "ABORT" && c) {
        return fail(res, 409, c.code, c.message, c.details);
      }
      throw err;
    }

    if (!result) {
      return fail(res, 500, "INTERNAL_ERROR", "Could not apply wallet credit");
    }

    await logActivity({
      action: "wallet_credit_applied",
      entityType: "reservation",
      entityId: id,
      description: `₹${result.applied.toFixed(2)} wallet credit applied to ${result.reservation.reservationNumber}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
      metadata: { applied: result.applied, remainingBalance: result.remainingBalance },
    });
    await invalidateDashboard();
    return ok(res, result);
  },
);

export default router;
