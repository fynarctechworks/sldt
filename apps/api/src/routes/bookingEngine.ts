// Booking engine — split between admin config (authed) and public
// endpoints (no auth, served to anonymous browsers via the widget).
//
// Admin endpoints (mounted under /booking-engine):
//   GET   /booking-engine                — read settings
//   PUT   /booking-engine                — update settings
//   GET   /booking-engine/pending        — inbox of public submissions
//   POST  /booking-engine/pending/:id/review  — accept/reject
//
// Public endpoints (mounted under /public/booking, no auth required):
//   GET   /public/booking/:propertyCode  — property "card" for the widget
//   GET   /public/booking/quote          — quote for a stay
//   POST  /public/booking/submit         — create a pending booking
//
// The public path is heavily rate-limited at the gateway layer; the
// route also re-validates property is enabled before doing any work.

import {
  bookingEngineSettingsSchema,
  pendingBookingReviewSchema,
  publicBookingSubmitSchema,
  publicQuoteQuerySchema,
} from "@hoteldesk/shared";
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { bookingEngineSettings, pendingBookings } from "../db/schema/bookingEngine.js";
import { guests } from "../db/schema/guests.js";
import { properties } from "../db/schema/properties.js";
import { ratePlans } from "../db/schema/ratePlans.js";
import { reservationRooms, reservations } from "../db/schema/reservations.js";
import { rooms } from "../db/schema/rooms.js";
import { RESERVATION_BLOCKING_STATUSES } from "../db/schema/enums.js";
import { logActivity } from "../lib/activity.js";
import { resolveCurrentPropertyId } from "../lib/currentProperty.js";
import { resolveAverageRate } from "../lib/ratePlanResolve.js";
import { fail, list, ok } from "../lib/response.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

// ---------- Admin router ----------
export const adminBookingEngineRouter = Router();

adminBookingEngineRouter.get(
  "/",
  requireAuth,
  requirePermission("configure_booking_engine"),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const [row] = await db
      .select()
      .from(bookingEngineSettings)
      .where(eq(bookingEngineSettings.propertyId, propertyId))
      .limit(1);
    return ok(res, row ?? null);
  },
);

adminBookingEngineRouter.put(
  "/",
  requireAuth,
  requirePermission("configure_booking_engine"),
  validate(bookingEngineSettingsSchema),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const patch = req.body as z.infer<typeof bookingEngineSettingsSchema>;
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      updateData[k] = v;
    }
    const [updated] = await db
      .update(bookingEngineSettings)
      .set(updateData)
      .where(eq(bookingEngineSettings.propertyId, propertyId))
      .returning();
    return ok(res, updated);
  },
);

adminBookingEngineRouter.get(
  "/pending",
  requireAuth,
  requirePermission("review_pending_bookings"),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const q = req.query as Record<string, string | undefined>;
    const statusFilter = q.status as "received" | "accepted" | "rejected" | undefined;
    const conditions = [eq(pendingBookings.propertyId, propertyId)];
    if (statusFilter) conditions.push(eq(pendingBookings.status, statusFilter));
    const rows = await db
      .select()
      .from(pendingBookings)
      .where(and(...conditions))
      .orderBy(desc(pendingBookings.submittedAt))
      .limit(100);
    return list(res, rows, { total: rows.length, page: 1, per_page: rows.length });
  },
);

adminBookingEngineRouter.post(
  "/pending/:id/review",
  requireAuth,
  requirePermission("review_pending_bookings"),
  validate(pendingBookingReviewSchema),
  async (req, res) => {
    const id = req.params.id!;
    const propertyId = await resolveCurrentPropertyId(req);
    const input = req.body as z.infer<typeof pendingBookingReviewSchema>;
    const [pending] = await db
      .select()
      .from(pendingBookings)
      .where(and(eq(pendingBookings.id, id), eq(pendingBookings.propertyId, propertyId)))
      .limit(1);
    if (!pending) return fail(res, 404, "NOT_FOUND", "Pending booking not found");
    if (pending.status !== "received") {
      return fail(res, 409, "ALREADY_REVIEWED", "This booking was already reviewed");
    }

    if (input.action === "reject") {
      const [updated] = await db
        .update(pendingBookings)
        .set({
          status: "rejected",
          rejectedReason: input.reason,
          reviewedAt: new Date(),
          reviewedBy: req.user!.id,
        })
        .where(eq(pendingBookings.id, id))
        .returning();
      await logActivity({
        action: "pending_booking_rejected",
        entityType: "pending_booking",
        entityId: id,
        description: `${pending.publicRef} rejected: ${input.reason}`,
        performedBy: req.user!.id,
        ipAddress: req.ip,
      });
      return ok(res, updated);
    }

    // Accept — promote into a real reservation. We do NOT touch the
    // main reservation create flow; this is a lean conversion that
    // creates a confirmed reservation, attaches the chosen room, and
    // marks the pending row accepted. KYC is collected at check-in.
    const accepted = await db.transaction(async (tx) => {
      // Find-or-create the guest by phone (same approach as the desk).
      const phone = pending.guestPhone;
      const [existing] = await tx
        .select({ id: guests.id })
        .from(guests)
        .where(eq(guests.phone, phone))
        .limit(1);

      let guestId: string;
      if (existing) {
        guestId = existing.id;
      } else {
        // Bare-minimum guest record — front desk will complete KYC at
        // check-in (DB row carries kyc_verified_at = NULL).
        const [g] = await tx
          .insert(guests)
          .values({
            propertyId,
            fullName: pending.guestName,
            phone: pending.guestPhone,
            email: pending.guestEmail ?? null,
            idProofType: "aadhaar",
            idProofNumberEncrypted: "",  // empty placeholder; KYC at desk
            idProofLast4: "0000",
            nationality: "Indian",
          })
          .returning({ id: guests.id });
        guestId = g!.id;
      }

      const nights = Math.max(
        1,
        Math.round(
          (new Date(pending.checkOutDate).getTime() -
            new Date(pending.checkInDate).getTime()) /
            86400000,
        ),
      );

      // Allocate reservation number from the sequence.
      const result = await tx.execute<{ nextval: string | number }>(
        sql`SELECT nextval('sldt_reservation_seq') AS nextval`,
      );
      const seq = Number((result[0] as { nextval: string | number }).nextval);
      const resNumber = `SLDT-RES-${String(seq).padStart(4, "0")}`;

      const subtotal = +(Number(pending.quotedRate) * nights).toFixed(2);
      const grandTotal = Number(pending.quotedTotal);
      const gstAmount = +(grandTotal - subtotal).toFixed(2);

      const [r] = await tx
        .insert(reservations)
        .values({
          reservationNumber: resNumber,
          propertyId,
          guestId,
          checkInDate: pending.checkInDate,
          checkOutDate: pending.checkOutDate,
          stayType: "overnight",
          numAdults: pending.numAdults,
          numChildren: pending.numChildren,
          ratePerNight: pending.quotedRate,
          subtotal: String(subtotal),
          gstRate: String(grandTotal > subtotal ? +((gstAmount / subtotal) * 100).toFixed(2) : 0),
          gstAmount: String(gstAmount),
          grandTotal: String(grandTotal),
          gstMode: "exclusive",
          advancePaid: pending.paymentStatus === "paid" ? pending.quotedTotal : "0",
          balanceDue: String(
            pending.paymentStatus === "paid" ? 0 : grandTotal,
          ),
          status: "confirmed",
          bookingSource: "phone_whatsapp",
          ratePlanId: pending.ratePlanId,
          createdBy: req.user!.id,
        })
        .returning();

      await tx.insert(reservationRooms).values({
        reservationId: r!.id,
        roomId: input.roomId,
        ratePerNight: pending.quotedRate,
        // Per-room (0017): occupant defaults to the booker; status
        // mirrors a fresh confirmed reservation.
        guestId,
        status: "confirmed" as const,
      });

      await tx
        .update(rooms)
        .set({ status: "reserved", updatedAt: new Date() })
        .where(eq(rooms.id, input.roomId));

      const [updated] = await tx
        .update(pendingBookings)
        .set({
          status: "accepted",
          reservationId: r!.id,
          reviewedAt: new Date(),
          reviewedBy: req.user!.id,
        })
        .where(eq(pendingBookings.id, id))
        .returning();

      return { reservation: r!, pending: updated! };
    });

    await logActivity({
      action: "pending_booking_accepted",
      entityType: "pending_booking",
      entityId: id,
      description: `${pending.publicRef} → ${accepted.reservation.reservationNumber}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    return ok(res, accepted);
  },
);

// ---------- Public router (no auth) ----------
export const publicBookingRouter = Router();

// Property card: name, address, banner, tagline, currency. The widget
// renders this above its form.
publicBookingRouter.get("/:propertyCode", async (req, res) => {
  const code = req.params.propertyCode!;
  const [prop] = await db
    .select()
    .from(properties)
    .where(eq(properties.code, code))
    .limit(1);
  if (!prop || !prop.isActive) return fail(res, 404, "NOT_FOUND", "Property not found");

  const [settings] = await db
    .select()
    .from(bookingEngineSettings)
    .where(eq(bookingEngineSettings.propertyId, prop.id))
    .limit(1);
  if (!settings || !settings.isEnabled) {
    return fail(res, 404, "DISABLED", "Public booking is not enabled for this property");
  }

  // Room types available — the widget shows these as selectable.
  const roomTypes = await db
    .selectDistinct({ roomType: rooms.roomType })
    .from(rooms)
    .where(eq(rooms.propertyId, prop.id));

  return ok(res, {
    name: prop.name,
    code: prop.code,
    address: prop.address,
    city: prop.city,
    state: prop.state,
    phone: prop.phone,
    email: prop.email,
    currency: prop.currency,
    timezone: prop.timezone,
    checkInTime: prop.defaultCheckInTime,
    checkOutTime: prop.defaultCheckOutTime,
    bannerImageUrl: settings.bannerImageUrl,
    tagline: settings.tagline,
    cancellationPolicy: settings.cancellationPolicy,
    minAdvanceHours: settings.minAdvanceHours,
    maxNightsPerBooking: settings.maxNightsPerBooking,
    requireKycAtBooking: settings.requireKycAtBooking,
    roomTypes: roomTypes.map((r) => r.roomType),
  });
});

publicBookingRouter.get(
  "/quote",
  validate(publicQuoteQuerySchema, "query"),
  async (req, res) => {
    const q = req.query as unknown as z.infer<typeof publicQuoteQuerySchema>;
    const [prop] = await db
      .select()
      .from(properties)
      .where(eq(properties.code, q.propertyCode))
      .limit(1);
    if (!prop) return fail(res, 404, "NOT_FOUND", "Property not found");
    const [settings] = await db
      .select()
      .from(bookingEngineSettings)
      .where(eq(bookingEngineSettings.propertyId, prop.id))
      .limit(1);
    if (!settings || !settings.isEnabled) {
      return fail(res, 404, "DISABLED", "Public booking is not enabled");
    }
    if (q.checkOutDate <= q.checkInDate) {
      return fail(res, 400, "INVALID_DATES", "check_out must be after check_in");
    }
    const nights = Math.round(
      (new Date(q.checkOutDate).getTime() - new Date(q.checkInDate).getTime()) /
        86400000,
    );
    if (nights > settings.maxNightsPerBooking) {
      return fail(
        res,
        400,
        "TOO_LONG",
        `Maximum ${settings.maxNightsPerBooking} nights per booking`,
      );
    }
    // Find one room of the requested type that's free for the window.
    // We pick the cheapest qualifying room for the quote.
    const candidates = await db
      .select({ id: rooms.id, baseRate: rooms.baseRate })
      .from(rooms)
      .where(and(eq(rooms.propertyId, prop.id), eq(rooms.roomType, q.roomType)))
      .orderBy(asc(rooms.baseRate));
    if (!candidates.length) {
      return fail(res, 404, "NO_ROOMS", "No rooms of that type at this property");
    }
    // Filter out rooms already booked over the window.
    const conflicts = await db
      .select({ roomId: reservationRooms.roomId })
      .from(reservationRooms)
      .innerJoin(reservations, eq(reservations.id, reservationRooms.reservationId))
      .where(
        and(
          inArray(reservations.status, [...RESERVATION_BLOCKING_STATUSES]),
          sql`daterange(${reservations.checkInDate}, ${reservations.checkOutDate}, '[)') && daterange(${q.checkInDate}::date, ${q.checkOutDate}::date, '[)')`,
        ),
      );
    const blocked = new Set(conflicts.map((c) => c.roomId));
    const free = candidates.find((c) => !blocked.has(c.id));
    if (!free) return fail(res, 409, "FULL", "No rooms available for those dates");

    const avg = await resolveAverageRate({
      propertyId: prop.id,
      ratePlanId: settings.publicRatePlanId ?? null,
      roomId: free.id,
      roomType: q.roomType,
      checkInDate: q.checkInDate,
      checkOutDate: q.checkOutDate,
    });
    const subtotal = +(avg * nights).toFixed(2);
    // GST estimate using slabs from settings (Phase 1's behaviour).
    const gstRate = avg < 1000 ? 0 : avg < 7500 ? 5 : 18;
    const gstAmount = +((subtotal * gstRate) / 100).toFixed(2);
    const grandTotal = +(subtotal + gstAmount).toFixed(2);
    return ok(res, {
      currency: prop.currency,
      nights,
      ratePerNight: avg,
      subtotal,
      gstRate,
      gstAmount,
      grandTotal,
      ratePlanId: settings.publicRatePlanId,
    });
  },
);

publicBookingRouter.post(
  "/submit",
  validate(publicBookingSubmitSchema),
  async (req, res) => {
    const input = req.body as z.infer<typeof publicBookingSubmitSchema>;
    const [prop] = await db
      .select()
      .from(properties)
      .where(eq(properties.code, input.propertyCode))
      .limit(1);
    if (!prop) return fail(res, 404, "NOT_FOUND", "Property not found");
    const [settings] = await db
      .select()
      .from(bookingEngineSettings)
      .where(eq(bookingEngineSettings.propertyId, prop.id))
      .limit(1);
    if (!settings || !settings.isEnabled) {
      return fail(res, 404, "DISABLED", "Public booking is not enabled");
    }

    // Quote first so the stored amount matches what we just resolved.
    // Find any qualifying room (cheapest) so we can compute an average.
    const [anyRoom] = await db
      .select({ id: rooms.id })
      .from(rooms)
      .where(and(eq(rooms.propertyId, prop.id), eq(rooms.roomType, input.roomType)))
      .orderBy(asc(rooms.baseRate))
      .limit(1);
    if (!anyRoom) return fail(res, 404, "NO_ROOMS", "No rooms of that type");

    const nights = Math.max(
      1,
      Math.round(
        (new Date(input.checkOutDate).getTime() -
          new Date(input.checkInDate).getTime()) /
          86400000,
      ),
    );
    const avg = await resolveAverageRate({
      propertyId: prop.id,
      ratePlanId: settings.publicRatePlanId ?? null,
      roomId: anyRoom.id,
      roomType: input.roomType,
      checkInDate: input.checkInDate,
      checkOutDate: input.checkOutDate,
    });
    const subtotal = +(avg * nights).toFixed(2);
    const gstRate = avg < 1000 ? 0 : avg < 7500 ? 5 : 18;
    const gstAmount = +((subtotal * gstRate) / 100).toFixed(2);
    const grandTotal = +(subtotal + gstAmount).toFixed(2);

    const publicRef = `BK-${randomBytes(4).toString("hex").toUpperCase()}`;
    const [row] = await db
      .insert(pendingBookings)
      .values({
        propertyId: prop.id,
        publicRef,
        checkInDate: input.checkInDate,
        checkOutDate: input.checkOutDate,
        numAdults: input.numAdults,
        numChildren: input.numChildren,
        roomType: input.roomType,
        ratePlanId: settings.publicRatePlanId,
        guestName: input.guestName,
        guestPhone: input.guestPhone,
        guestEmail: input.guestEmail ?? null,
        quotedRate: String(avg),
        quotedTotal: String(grandTotal),
        submittedIp: req.ip,
      })
      .returning();
    return ok(
      res,
      {
        publicRef: row!.publicRef,
        status: row!.status,
        grandTotal,
        nights,
        cancellationPolicy: settings.cancellationPolicy,
        consentRecorded: {
          cancellationPolicy: input.acceptsCancellationPolicy,
          marketing: input.acceptsMarketing,
          at: new Date().toISOString(),
        },
      },
      201,
    );
  },
);

// Default export for legacy callers that want the admin router. The
// public router is imported by name in index.ts.
export default adminBookingEngineRouter;
