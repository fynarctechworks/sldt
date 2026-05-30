import {
  followUpCreateSchema,
  followUpUpdateSchema,
  guestCreateSchema,
  guestDuplicateQuerySchema,
  guestListQuerySchema,
  guestNoteCreateSchema,
  guestTagsSchema,
  guestUpdateSchema,
} from "@hoteldesk/shared";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { db } from "../db/client.js";
import { guestFollowUps, guestNotes, guests } from "../db/schema/guests.js";
import { reservations, reservationRooms } from "../db/schema/reservations.js";
import { rooms } from "../db/schema/rooms.js";
import { invoices, payments } from "../db/schema/invoices.js";
import { logActivity } from "../lib/activity.js";
import { encrypt, last4 } from "../lib/crypto.js";
import { resolveCurrentPropertyId } from "../lib/currentProperty.js";
import { fail, list, ok } from "../lib/response.js";
import { deleteKycFile, signedKycUrl, uploadKycPhoto, validateKycFile } from "../lib/storage.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

// Multer config for KYC uploads. We reject anything that isn't an image at
// the multipart layer so junk (executables, archives, SVG, PDF) never even
// hits the disk buffer. Real validation happens server-side in
// storage.ts via Sharp re-encoding — this is just the cheap first filter.
const ALLOWED_UPLOAD_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 3, fields: 5 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_UPLOAD_MIMES.has(file.mimetype)) {
      cb(new Error("Only JPEG, PNG, or WEBP images are accepted"));
      return;
    }
    cb(null, true);
  },
});

const router = Router();

// Mask the ID proof for non-admin views. Only the last 4 digits leak out
// so staff can still verify a guest at the desk without seeing the full
// number. Admins get the unmasked row.
const maskId = (l4: string) => `••••${l4}`;

function maskGuest<T extends { idProofNumberEncrypted: string; idProofLast4: string }>(
  guest: T,
  role: string,
) {
  if (role === "admin") return guest;
  const { idProofNumberEncrypted: _e, ...rest } = guest;
  void _e; // intentionally dropped from the response
  return { ...rest, idProofMasked: maskId(guest.idProofLast4) };
}

router.get(
  "/",
  requireAuth,
  requirePermission("view_guests"),
  validate(guestListQuerySchema, "query"),
  async (req, res) => {
    const { search, tag, has_followup, page, per_page } = req.query as unknown as {
      search?: string;
      tag?: string;
      has_followup?: "true" | "false";
      page: number;
      per_page: number;
    };
    const offset = (page - 1) * per_page;

    const conditions = [];
    if (search) {
      conditions.push(
        or(
          ilike(guests.fullName, `%${search}%`),
          ilike(guests.phone, `%${search}%`),
          ilike(guests.idProofLast4, `%${search}%`),
          ilike(guests.email, `%${search}%`),
          ilike(guests.companyName, `%${search}%`),
        )!,
      );
    }
    if (tag) {
      conditions.push(sql`${tag} = ANY(${guests.tags})`);
    }
    if (has_followup === "true") {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM ${guestFollowUps} f WHERE f.guest_id = ${guests.id} AND f.status = 'pending')`,
      );
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, totalRows] = await Promise.all([
      db
        .select()
        .from(guests)
        .where(where)
        .orderBy(desc(guests.createdAt))
        .limit(per_page)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(guests).where(where),
    ]);

    // Resolve signed photo URLs in parallel so the guest search dropdown
    // can render thumbnails. Rows without a guestPhoto get null. URLs are
    // short-lived (5 min) — fine for the list view.
    const photoUrls = await Promise.all(
      rows.map((r) => (r.guestPhoto ? signedKycUrl(r.guestPhoto) : Promise.resolve(null))),
    );

    const masked = rows.map((r, i) => ({
      ...maskGuest(r, req.user!.role),
      photoUrl: photoUrls[i] ?? null,
    }));
    return list(res, masked, { total: totalRows[0]?.count ?? 0, page, per_page });
  },
);

router.get(
  "/check-duplicate",
  requireAuth,
  requirePermission("view_guests"),
  validate(guestDuplicateQuerySchema, "query"),
  async (req, res) => {
    const { phone, id_number } = req.query as { phone?: string; id_number?: string };
    if (!phone && !id_number) return ok(res, { duplicate: false });

    const conditions = [];
    if (phone) conditions.push(eq(guests.phone, phone));
    if (id_number) conditions.push(eq(guests.idProofLast4, id_number.slice(-4)));

    const matches = await db
      .select({ id: guests.id, fullName: guests.fullName, phone: guests.phone })
      .from(guests)
      .where(or(...conditions))
      .limit(5);

    return ok(res, { duplicate: matches.length > 0, matches });
  },
);

// Outstanding balance owed by this guest across all their previous bookings.
// Combines:
//   (a) unpaid/partial invoices (issued, not voided, balance_due > 0)
//   (b) confirmed/checked-in reservations with a non-zero balance that
//       haven't had an invoice issued yet (e.g. advance paid but stay
//       still in progress)
// Returns a small summary so the New Reservation form can show a banner
// without making a second round-trip. `mostRecent` is for the "previous
// booking" deep-link.
router.get(
  "/:id/outstanding",
  requireAuth,
  requirePermission("view_guests"),
  async (req, res) => {
    const id = req.params.id!;
    const exists = await db.select({ id: guests.id }).from(guests).where(eq(guests.id, id)).limit(1);
    if (!exists.length) return fail(res, 404, "NOT_FOUND", "Guest not found");

    // Complimentary reservations don't appear as "owed" anywhere — they
    // were comped, so there is no debt to chase. Filter in all three
    // sub-queries that feed the outstanding banner.
    const [invoiceRows, preInvoiceRows, pendingPayments] = await Promise.all([
      db
        .select({
          invoiceId: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          reservationId: invoices.reservationId,
          reservationNumber: reservations.reservationNumber,
          balanceDue: invoices.balanceDue,
          issuedAt: invoices.createdAt,
        })
        .from(invoices)
        .innerJoin(reservations, eq(reservations.id, invoices.reservationId))
        .where(
          and(
            eq(invoices.guestId, id),
            sql`${invoices.status} NOT IN ('voided','paid')`,
            sql`${invoices.balanceDue}::numeric > 0.009`,
            sql`${reservations.bookingSource} <> 'complimentary'`,
          ),
        )
        .orderBy(desc(invoices.createdAt)),
      // Reservations the guest is on that have a non-zero balance but no
      // invoice yet. We exclude cancelled/no_show so we don't nag about
      // bookings that were never going to be paid for.
      db
        .select({
          reservationId: reservations.id,
          reservationNumber: reservations.reservationNumber,
          balanceDue: reservations.balanceDue,
          createdAt: reservations.createdAt,
          status: reservations.status,
        })
        .from(reservations)
        .leftJoin(invoices, eq(invoices.reservationId, reservations.id))
        .where(
          and(
            eq(reservations.guestId, id),
            inArray(reservations.status, ["confirmed", "checked_in"]),
            sql`${invoices.id} IS NULL`,
            sql`${reservations.balanceDue}::numeric > 0.009`,
            sql`${reservations.bookingSource} <> 'complimentary'`,
          ),
        )
        .orderBy(desc(reservations.createdAt)),
      // Pending payment promises ("guest will pay in cash later"). These
      // attach to a reservation but might double-count what the invoice
      // already says, so we surface them as a separate count for context
      // but DON'T add their amount to the total.
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(payments)
        .innerJoin(reservations, eq(reservations.id, payments.reservationId))
        .where(
          and(
            eq(reservations.guestId, id),
            eq(payments.status, "pending"),
            eq(payments.voided, false),
            sql`${reservations.bookingSource} <> 'complimentary'`,
          ),
        ),
    ]);

    const totalFromInvoices = invoiceRows.reduce((s, r) => s + Number(r.balanceDue), 0);
    const totalFromPreInvoice = preInvoiceRows.reduce((s, r) => s + Number(r.balanceDue), 0);
    const total = +(totalFromInvoices + totalFromPreInvoice).toFixed(2);

    // Most-recent unpaid item — used by the UI for the "Open previous
    // reservation" deep-link in the banner.
    let mostRecent:
      | {
          reservationId: string;
          reservationNumber: string;
          invoiceNumber: string | null;
          balanceDue: number;
          date: string;
        }
      | null = null;
    if (invoiceRows.length) {
      const r = invoiceRows[0]!;
      mostRecent = {
        reservationId: r.reservationId,
        reservationNumber: r.reservationNumber,
        invoiceNumber: r.invoiceNumber,
        balanceDue: Number(r.balanceDue),
        date: r.issuedAt.toISOString(),
      };
    } else if (preInvoiceRows.length) {
      const r = preInvoiceRows[0]!;
      mostRecent = {
        reservationId: r.reservationId,
        reservationNumber: r.reservationNumber,
        invoiceNumber: null,
        balanceDue: Number(r.balanceDue),
        date: r.createdAt.toISOString(),
      };
    }

    return ok(res, {
      total,
      count: invoiceRows.length + preInvoiceRows.length,
      pendingPromiseCount: pendingPayments[0]?.count ?? 0,
      mostRecent,
      // Per-invoice breakdown used by checkout flow to collect previous
      // unpaid balances in FIFO order (oldest issued first).
      invoices: invoiceRows
        .map((r) => ({
          invoiceId: r.invoiceId,
          invoiceNumber: r.invoiceNumber,
          reservationId: r.reservationId,
          reservationNumber: r.reservationNumber,
          balanceDue: Number(r.balanceDue),
          issuedAt: r.issuedAt.toISOString(),
        }))
        .sort((a, b) => a.issuedAt.localeCompare(b.issuedAt)),
      // Reservations that have a balance but haven't been invoiced yet
      // (still checked_in or confirmed). The checkout modal lets staff
      // collect these via POST /reservations/:id/payments (records an
      // advance).
      preInvoiceReservations: preInvoiceRows
        .map((r) => ({
          reservationId: r.reservationId,
          reservationNumber: r.reservationNumber,
          balanceDue: Number(r.balanceDue),
          createdAt: r.createdAt.toISOString(),
        }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    });
  },
);

// Full stay history for the guest profile's "Stays" tab. Returns every
// reservation the guest is on (booker or per-room occupant), newest first,
// with each booking's rooms attached. Drives the inline list of rooms +
// dates + status shown on the guest page.
router.get(
  "/:id/reservations",
  requireAuth,
  requirePermission("view_guests"),
  async (req, res) => {
    const id = req.params.id!;
    const exists = await db
      .select({ id: guests.id })
      .from(guests)
      .where(eq(guests.id, id))
      .limit(1);
    if (!exists.length) return fail(res, 404, "NOT_FOUND", "Guest not found");

    // Reservations where this guest is either the booker OR a per-room
    // occupant. Using a UNION on reservation ids keeps the result set
    // deduplicated even when both are true.
    const bookerIds = await db
      .select({ id: reservations.id })
      .from(reservations)
      .where(eq(reservations.guestId, id));
    const occupantIds = await db
      .select({ id: reservationRooms.reservationId })
      .from(reservationRooms)
      .where(eq(reservationRooms.guestId, id));
    const allIds = Array.from(
      new Set([...bookerIds.map((r) => r.id), ...occupantIds.map((r) => r.id)]),
    );
    if (allIds.length === 0) return ok(res, []);

    const resvRows = await db
      .select({
        id: reservations.id,
        reservationNumber: reservations.reservationNumber,
        status: reservations.status,
        bookingSource: reservations.bookingSource,
        stayType: reservations.stayType,
        checkInDate: reservations.checkInDate,
        checkOutDate: reservations.checkOutDate,
        numNights: reservations.numNights,
        grandTotal: reservations.grandTotal,
        balanceDue: reservations.balanceDue,
        guestId: reservations.guestId,
        createdAt: reservations.createdAt,
      })
      .from(reservations)
      .where(inArray(reservations.id, allIds))
      .orderBy(desc(reservations.checkInDate), desc(reservations.createdAt));

    const roomRows = await db
      .select({
        id: reservationRooms.id,
        reservationId: reservationRooms.reservationId,
        roomNumber: rooms.roomNumber,
        roomType: rooms.roomType,
        soldAsType: reservationRooms.soldAsType,
        ratePerNight: reservationRooms.ratePerNight,
        guestId: reservationRooms.guestId,
        status: reservationRooms.status,
      })
      .from(reservationRooms)
      .innerJoin(rooms, eq(rooms.id, reservationRooms.roomId))
      .where(inArray(reservationRooms.reservationId, allIds));

    const roomsByRes = new Map<string, typeof roomRows>();
    for (const r of roomRows) {
      const arr = roomsByRes.get(r.reservationId) ?? [];
      arr.push(r);
      roomsByRes.set(r.reservationId, arr);
    }

    return ok(
      res,
      resvRows.map((r) => ({
        ...r,
        // Role this guest played on the booking — useful for the UI to
        // label "You were the booker" vs "Stayed in Room 202".
        role: r.guestId === id ? "booker" : "occupant",
        rooms: (roomsByRes.get(r.id) ?? []).map((rm) => ({
          id: rm.id,
          roomNumber: rm.roomNumber,
          roomType: rm.roomType,
          soldAsType: rm.soldAsType,
          ratePerNight: rm.ratePerNight,
          status: rm.status,
          isThisGuest: rm.guestId === id,
        })),
      })),
    );
  },
);

router.get(
  "/:id",
  requireAuth,
  requirePermission("view_guests"),
  async (req, res) => {
    const id = req.params.id!;
    const found = await db.select().from(guests).where(eq(guests.id, id)).limit(1);
    if (!found.length) return fail(res, 404, "NOT_FOUND", "Guest not found");

    const [resStats, paidStats] = await Promise.all([
      db
        .select({
          // total = anything ever booked (incl. cancelled). The UI groups it
          // semantically using the other sub-counts.
          total: sql<number>`count(*)::int`,
          completed: sql<number>`count(*) filter (where ${reservations.status} = 'checked_out')::int`,
          // upcoming = future-dated confirmed bookings the guest hasn't arrived
          // for yet. Currently-checked-in stays are tracked separately as
          // inHouse so the UI doesn't conflate "future" with "now".
          upcoming: sql<number>`count(*) filter (where ${reservations.status} = 'confirmed')::int`,
          inHouse: sql<number>`count(*) filter (where ${reservations.status} = 'checked_in')::int`,
          cancelled: sql<number>`count(*) filter (where ${reservations.status} = 'cancelled')::int`,
          // firstStay = earliest *completed* check-in. Null until the guest
          // has stayed at least once so "Since May 2026" doesn't appear next
          // to "Last stay: Never" for a brand-new guest with only future
          // bookings.
          firstStay: sql<string | null>`min(${reservations.checkInDate}) filter (where ${reservations.status} = 'checked_out')`,
          lastStay: sql<string | null>`max(${reservations.checkOutDate}) filter (where ${reservations.status} = 'checked_out')`,
          // First-ever booking date (any status). Used by the UI to show
          // "First booking: …" when the guest has no completed stays yet.
          firstBooking: sql<string | null>`min(${reservations.checkInDate})`,
        })
        .from(reservations)
        .where(eq(reservations.guestId, id)),
      // Total paid + balance due across the whole guest history.
      //
      // Total paid: sum of every non-voided, "received" payment on any of
      // this guest's reservations. This catches advances taken at booking
      // (before any invoice exists) AND post-invoice payments.
      //
      // Balance due: for each non-cancelled reservation, take the invoice's
      // balance if an invoice has been issued (and is not voided); otherwise
      // take the reservation's running balance_due. This avoids double-
      // counting when an invoice exists and prevents under-counting when the
      // guest has paid an advance but hasn't checked out yet (no invoice
      // yet).
      // Complimentary reservations are excluded from "Total paid" and
      // "Balance due" on the guest profile. They count as stays (handled
      // by resStats above) but their money is tracked in the
      // Complimentary report, not the guest's lifetime spend.
      db.execute<{ total_paid: string; balance_due: string }>(sql`
        WITH guest_reservations AS (
          SELECT r.id, r.status, r.balance_due, r.booking_source
          FROM ${reservations} r
          WHERE r.guest_id = ${id}
            AND r.booking_source <> 'complimentary'
        ),
        paid AS (
          SELECT COALESCE(SUM(p.amount::numeric), 0) AS total
          FROM ${payments} p
          INNER JOIN guest_reservations gr ON gr.id = p.reservation_id
          WHERE p.voided = false AND p.status = 'received'
        ),
        balances AS (
          SELECT COALESCE(SUM(
            CASE
              WHEN gr.status = 'cancelled' THEN 0
              ELSE COALESCE(
                (SELECT i.balance_due::numeric
                 FROM ${invoices} i
                 WHERE i.reservation_id = gr.id AND i.status != 'voided'
                 ORDER BY i.created_at DESC
                 LIMIT 1),
                gr.balance_due::numeric
              )
            END
          ), 0) AS total
          FROM guest_reservations gr
        )
        SELECT
          (SELECT total FROM paid)::text AS total_paid,
          (SELECT total FROM balances)::text AS balance_due
      `),
    ]);

    const photoUrl = found[0]!.guestPhoto ? await signedKycUrl(found[0]!.guestPhoto) : null;
    const { getGuestBalance } = await import("../lib/ledger.js");
    const walletBalance = await getGuestBalance(id);

    return ok(res, {
      ...maskGuest(found[0]!, req.user!.role),
      photoUrl,
      walletBalance,
      stats: {
        totalStays: resStats[0]?.total ?? 0,
        completedStays: resStats[0]?.completed ?? 0,
        upcomingStays: resStats[0]?.upcoming ?? 0,
        inHouseStays: resStats[0]?.inHouse ?? 0,
        cancelledStays: resStats[0]?.cancelled ?? 0,
        firstStay: resStats[0]?.firstStay ?? null,
        lastStay: resStats[0]?.lastStay ?? null,
        firstBooking: resStats[0]?.firstBooking ?? null,
        totalSpent: Number(
          (paidStats as unknown as { total_paid: string }[])[0]?.total_paid ?? 0,
        ),
        balanceDue: Number(
          (paidStats as unknown as { balance_due: string }[])[0]?.balance_due ?? 0,
        ),
      },
    });
  },
);

router.post(
  "/",
  requireAuth,
  requirePermission("view_guests"),
  validate(guestCreateSchema),
  async (req, res) => {
    const input = req.body;
    const dup = await db
      .select({ id: guests.id })
      .from(guests)
      .where(eq(guests.phone, input.phone))
      .limit(1);
    if (dup.length) return fail(res, 409, "DUPLICATE_PHONE", "Phone already registered");

    const propertyId = await resolveCurrentPropertyId(req);
    const [created] = await db
      .insert(guests)
      .values({
        propertyId,
        fullName: input.fullName,
        phone: input.phone,
        email: input.email || null,
        gender: input.gender,
        idProofType: input.idProofType,
        idProofNumberEncrypted: encrypt(input.idProofNumber),
        idProofLast4: last4(input.idProofNumber),
        address: input.address || null,
        city: input.city || null,
        state: input.state || null,
        nationality: input.nationality || "Indian",
        dateOfBirth: input.dateOfBirth || null,
        companyName: input.companyName || null,
        gstin: input.gstin || null,
        notes: input.notes || null,
      })
      .returning();

    await logActivity({
      action: "guest_created",
      entityType: "guest",
      entityId: created!.id,
      description: `Guest ${created!.fullName} added`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    return ok(res, maskGuest(created!, req.user!.role), 201);
  },
);

router.put(
  "/:id",
  requireAuth,
  requirePermission("view_guests"),
  validate(guestUpdateSchema),
  async (req, res) => {
    const id = req.params.id!;
    const input = req.body;
    const update: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(input)) {
      if (v === undefined) continue;
      if (k === "idProofNumber" && typeof v === "string") {
        update.idProofNumberEncrypted = encrypt(v);
        update.idProofLast4 = last4(v);
      } else {
        update[k] = v;
      }
    }
    const [updated] = await db.update(guests).set(update).where(eq(guests.id, id)).returning();
    if (!updated) return fail(res, 404, "NOT_FOUND", "Guest not found");

    await logActivity({
      action: "guest_updated",
      entityType: "guest",
      entityId: id,
      description: `Guest ${updated.fullName} updated`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    return ok(res, maskGuest(updated, req.user!.role));
  },
);

router.post(
  "/:id/kyc",
  requireAuth,
  requirePermission("view_guests"),
  upload.fields([
    { name: "front", maxCount: 1 },
    { name: "back", maxCount: 1 },
    { name: "photo", maxCount: 1 },
  ]),
  async (req, res) => {
    const id = req.params.id!;
    const existing = await db.select().from(guests).where(eq(guests.id, id)).limit(1);
    if (!existing.length) return fail(res, 404, "NOT_FOUND", "Guest not found");

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const front = files?.front?.[0];
    const back = files?.back?.[0];
    const photo = files?.photo?.[0];
    if (!front && !existing[0]!.idProofPhotoFront) {
      return fail(res, 400, "FRONT_REQUIRED", "Front of ID proof is required");
    }
    if (!photo && !existing[0]!.guestPhoto) {
      return fail(res, 400, "PHOTO_REQUIRED", "Customer photo is required");
    }
    if (!front && !back && !photo) {
      return fail(res, 400, "NO_FILE", "No file provided");
    }

    if (front) {
      const frontErr = validateKycFile(front);
      if (frontErr) return fail(res, 400, "INVALID_FILE", frontErr);
    }
    if (back) {
      const backErr = validateKycFile(back);
      if (backErr) return fail(res, 400, "INVALID_FILE", backErr);
    }
    if (photo) {
      const photoErr = validateKycFile(photo);
      if (photoErr) return fail(res, 400, "INVALID_FILE", photoErr);
    }

    const frontPath = front ? await uploadKycPhoto(id, "front", front) : null;
    const backPath = back ? await uploadKycPhoto(id, "back", back) : null;
    const photoPath = photo ? await uploadKycPhoto(id, "photo", photo) : null;

    const [updated] = await db
      .update(guests)
      .set({
        idProofPhotoFront: frontPath ?? existing[0]!.idProofPhotoFront,
        idProofPhotoBack: backPath ?? existing[0]!.idProofPhotoBack,
        guestPhoto: photoPath ?? existing[0]!.guestPhoto,
        kycVerifiedAt: new Date(),
        kycVerifiedBy: req.user!.id,
        updatedAt: new Date(),
      })
      .where(eq(guests.id, id))
      .returning();

    await logActivity({
      action: "kyc_uploaded",
      entityType: "guest",
      entityId: id,
      description: `KYC documents uploaded for ${updated!.fullName}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });

    return ok(res, {
      kycVerifiedAt: updated!.kycVerifiedAt,
      idProofPhotoFront: updated!.idProofPhotoFront,
      idProofPhotoBack: updated!.idProofPhotoBack,
      guestPhoto: updated!.guestPhoto,
    });
  },
);

router.get(
  "/:id/kyc",
  requireAuth,
  requirePermission("view_guests"),
  async (req, res) => {
    const id = req.params.id!;
    const found = await db.select().from(guests).where(eq(guests.id, id)).limit(1);
    if (!found.length) return fail(res, 404, "NOT_FOUND", "Guest not found");
    const g = found[0]!;
    const [frontUrl, backUrl, photoUrl] = await Promise.all([
      g.idProofPhotoFront ? signedKycUrl(g.idProofPhotoFront) : null,
      g.idProofPhotoBack ? signedKycUrl(g.idProofPhotoBack) : null,
      g.guestPhoto ? signedKycUrl(g.guestPhoto) : null,
    ]);
    return ok(res, {
      verified: g.kycVerifiedAt !== null && !!g.guestPhoto,
      kycVerifiedAt: g.kycVerifiedAt,
      frontUrl,
      backUrl,
      photoUrl,
    });
  },
);

// Delete a single KYC file (photo, front, or back). Sets the column to
// NULL and removes the file from the storage bucket. Used when staff
// accidentally uploaded the wrong document and wants to clear it
// without immediately replacing it.
router.delete(
  "/:id/kyc/:field",
  requireAuth,
  requirePermission("view_guests"),
  async (req, res) => {
    const { id, field } = req.params as { id: string; field: string };
    const columnMap: Record<string, "guestPhoto" | "idProofPhotoFront" | "idProofPhotoBack"> = {
      photo: "guestPhoto",
      front: "idProofPhotoFront",
      back: "idProofPhotoBack",
    };
    const col = columnMap[field];
    if (!col) return fail(res, 400, "INVALID_FIELD", "field must be photo, front, or back");

    const [g] = await db.select().from(guests).where(eq(guests.id, id)).limit(1);
    if (!g) return fail(res, 404, "NOT_FOUND", "Guest not found");

    const storagePath = g[col];
    if (!storagePath) return ok(res, { deleted: false });

    await deleteKycFile(storagePath);
    await db
      .update(guests)
      .set({ [col]: null, updatedAt: new Date() })
      .where(eq(guests.id, id));

    await logActivity({
      action: "kyc_deleted",
      entityType: "guest",
      entityId: id,
      description: `Deleted KYC ${field} for ${g.fullName}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });

    return ok(res, { deleted: true });
  },
);

router.patch(
  "/:id/tags",
  requireAuth,
  requirePermission("view_guests"),
  validate(guestTagsSchema),
  async (req, res) => {
    const id = req.params.id!;
    const { tags } = req.body as { tags: string[] };
    const normalized = Array.from(new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean)));
    const [updated] = await db
      .update(guests)
      .set({ tags: normalized, updatedAt: new Date() })
      .where(eq(guests.id, id))
      .returning();
    if (!updated) return fail(res, 404, "NOT_FOUND", "Guest not found");

    await logActivity({
      action: "guest_tags_updated",
      entityType: "guest",
      entityId: id,
      description: `Tags: ${normalized.join(", ") || "(none)"}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    return ok(res, { tags: normalized });
  },
);

// Toggle the VIP flag. VIP is a soft commercial label — it highlights
// the guest row in reservations + sends an internal notification to
// front-desk when the guest creates a new booking. No financial impact.
const vipSchema = z.object({ isVip: z.boolean() });
router.patch(
  "/:id/vip",
  requireAuth,
  requirePermission("edit_guests"),
  validate(vipSchema),
  async (req, res) => {
    const id = req.params.id!;
    const { isVip } = req.body as z.infer<typeof vipSchema>;
    const [updated] = await db
      .update(guests)
      .set({ isVip, updatedAt: new Date() })
      .where(eq(guests.id, id))
      .returning();
    if (!updated) return fail(res, 404, "NOT_FOUND", "Guest not found");
    await logActivity({
      action: isVip ? "guest_vip_set" : "guest_vip_cleared",
      entityType: "guest",
      entityId: id,
      description: `${updated.fullName} ${isVip ? "marked VIP" : "VIP cleared"}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    return ok(res, { isVip: updated.isVip });
  },
);

// Blacklist a guest. Blocks all future reservation creates for them.
// Requires manage_settings (admin/manager) — this is a heavy action that
// will refuse business at the front desk. Reason is mandatory so the
// audit log captures the why.
const blacklistSchema = z.discriminatedUnion("isBlacklisted", [
  z.object({ isBlacklisted: z.literal(true), reason: z.string().min(3).max(500) }),
  z.object({ isBlacklisted: z.literal(false) }),
]);
router.patch(
  "/:id/blacklist",
  requireAuth,
  requirePermission("manage_settings"),
  validate(blacklistSchema),
  async (req, res) => {
    const id = req.params.id!;
    const input = req.body as z.infer<typeof blacklistSchema>;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.isBlacklisted) {
      patch.isBlacklisted = true;
      patch.blacklistReason = input.reason;
      patch.blacklistedAt = new Date();
      patch.blacklistedBy = req.user!.id;
    } else {
      patch.isBlacklisted = false;
      patch.blacklistReason = null;
      patch.blacklistedAt = null;
      patch.blacklistedBy = null;
    }
    const [updated] = await db
      .update(guests)
      .set(patch)
      .where(eq(guests.id, id))
      .returning();
    if (!updated) return fail(res, 404, "NOT_FOUND", "Guest not found");
    await logActivity({
      action: input.isBlacklisted ? "guest_blacklisted" : "guest_unblacklisted",
      entityType: "guest",
      entityId: id,
      description: input.isBlacklisted
        ? `${updated.fullName} blacklisted: ${input.reason}`
        : `${updated.fullName} removed from blacklist`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    return ok(res, {
      isBlacklisted: updated.isBlacklisted,
      blacklistReason: updated.blacklistReason,
    });
  },
);

// Free-form preferences. We accept any jsonb but soft-validate the
// known keys so the UI can render structured pickers. Unknown keys
// pass through unchanged.
const preferencesSchema = z.object({
  preferences: z
    .object({
      smoking: z.boolean().optional(),
      floor: z.enum(["low", "mid", "high"]).optional(),
      pillow: z.enum(["soft", "firm"]).optional(),
      wakeup_time: z
        .string()
        .regex(/^([01]?\d|2[0-3]):[0-5]\d$/)
        .optional(),
      dietary: z.array(z.string().min(1).max(40)).max(10).optional(),
    })
    .catchall(z.unknown()),
});
router.patch(
  "/:id/preferences",
  requireAuth,
  requirePermission("edit_guests"),
  validate(preferencesSchema),
  async (req, res) => {
    const id = req.params.id!;
    const { preferences } = req.body as z.infer<typeof preferencesSchema>;
    const [updated] = await db
      .update(guests)
      .set({ preferences, updatedAt: new Date() })
      .where(eq(guests.id, id))
      .returning();
    if (!updated) return fail(res, 404, "NOT_FOUND", "Guest not found");
    await logActivity({
      action: "guest_preferences_updated",
      entityType: "guest",
      entityId: id,
      description: `Preferences updated for ${updated.fullName}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
      metadata: { preferences },
    });
    return ok(res, { preferences: updated.preferences });
  },
);

// DPDP-aligned consent capture. Records WHEN consent was given and via
// which channel. Setting `granted: false` revokes consent (clears the
// timestamp) so marketing dispatch helpers stop sending.
const consentSchema = z.object({
  granted: z.boolean(),
  channel: z.enum(["whatsapp", "sms", "email", "in_person"]).optional(),
});
router.patch(
  "/:id/consent",
  requireAuth,
  requirePermission("edit_guests"),
  validate(consentSchema),
  async (req, res) => {
    const id = req.params.id!;
    const { granted, channel } = req.body as z.infer<typeof consentSchema>;
    const [updated] = await db
      .update(guests)
      .set({
        marketingConsentAt: granted ? new Date() : null,
        marketingConsentChannel: granted ? channel ?? "in_person" : null,
        updatedAt: new Date(),
      })
      .where(eq(guests.id, id))
      .returning();
    if (!updated) return fail(res, 404, "NOT_FOUND", "Guest not found");
    await logActivity({
      action: granted ? "guest_consent_granted" : "guest_consent_revoked",
      entityType: "guest",
      entityId: id,
      description: granted
        ? `Marketing consent granted via ${channel ?? "in_person"}`
        : "Marketing consent revoked",
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    return ok(res, {
      marketingConsentAt: updated.marketingConsentAt,
      marketingConsentChannel: updated.marketingConsentChannel,
    });
  },
);

router.get(
  "/:id/notes",
  requireAuth,
  requirePermission("view_guests"),
  async (req, res) => {
    const id = req.params.id!;
    const rows = await db
      .select()
      .from(guestNotes)
      .where(eq(guestNotes.guestId, id))
      .orderBy(desc(guestNotes.createdAt));
    return ok(res, rows);
  },
);

router.post(
  "/:id/notes",
  requireAuth,
  requirePermission("view_guests"),
  validate(guestNoteCreateSchema),
  async (req, res) => {
    const id = req.params.id!;
    const { body } = req.body as { body: string };
    const guestExists = await db.select({ id: guests.id }).from(guests).where(eq(guests.id, id)).limit(1);
    if (!guestExists.length) return fail(res, 404, "NOT_FOUND", "Guest not found");

    const [created] = await db
      .insert(guestNotes)
      .values({ guestId: id, body, authorId: req.user!.id })
      .returning();
    return ok(res, created, 201);
  },
);

router.get(
  "/:id/follow-ups",
  requireAuth,
  requirePermission("view_guests"),
  async (req, res) => {
    const id = req.params.id!;
    const rows = await db
      .select()
      .from(guestFollowUps)
      .where(eq(guestFollowUps.guestId, id))
      .orderBy(asc(guestFollowUps.dueDate));
    return ok(res, rows);
  },
);

router.post(
  "/:id/follow-ups",
  requireAuth,
  requirePermission("view_guests"),
  validate(followUpCreateSchema),
  async (req, res) => {
    const id = req.params.id!;
    const input = req.body as { task: string; dueDate: string; assignedTo?: string | null };
    const guestExists = await db.select({ id: guests.id }).from(guests).where(eq(guests.id, id)).limit(1);
    if (!guestExists.length) return fail(res, 404, "NOT_FOUND", "Guest not found");

    const [created] = await db
      .insert(guestFollowUps)
      .values({
        guestId: id,
        task: input.task,
        dueDate: input.dueDate,
        assignedTo: input.assignedTo ?? null,
        createdBy: req.user!.id,
      })
      .returning();

    await logActivity({
      action: "followup_created",
      entityType: "guest",
      entityId: id,
      description: `Follow-up: ${input.task} (due ${input.dueDate})`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    return ok(res, created, 201);
  },
);

router.patch(
  "/:id/follow-ups/:followUpId",
  requireAuth,
  requirePermission("view_guests"),
  validate(followUpUpdateSchema),
  async (req, res) => {
    const { followUpId } = req.params as { followUpId: string };
    const input = req.body as {
      status?: "pending" | "done" | "cancelled";
      task?: string;
      dueDate?: string;
      assignedTo?: string | null;
    };
    const patch: Record<string, unknown> = {};
    if (input.status !== undefined) {
      patch.status = input.status;
      patch.completedAt = input.status === "done" ? new Date() : null;
    }
    if (input.task !== undefined) patch.task = input.task;
    if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
    if (input.assignedTo !== undefined) patch.assignedTo = input.assignedTo;

    const [updated] = await db
      .update(guestFollowUps)
      .set(patch)
      .where(eq(guestFollowUps.id, followUpId))
      .returning();
    if (!updated) return fail(res, 404, "NOT_FOUND", "Follow-up not found");
    return ok(res, updated);
  },
);

router.get(
  "/follow-ups/due",
  requireAuth,
  requirePermission("view_guests"),
  async (req, res) => {
    const days = Math.min(30, Math.max(0, Number((req.query as { days?: string }).days ?? 7)));
    const rows = await db
      .select({
        id: guestFollowUps.id,
        guestId: guestFollowUps.guestId,
        guestName: guests.fullName,
        guestPhone: guests.phone,
        task: guestFollowUps.task,
        dueDate: guestFollowUps.dueDate,
        status: guestFollowUps.status,
        assignedTo: guestFollowUps.assignedTo,
      })
      .from(guestFollowUps)
      .innerJoin(guests, eq(guests.id, guestFollowUps.guestId))
      .where(
        and(
          eq(guestFollowUps.status, "pending"),
          sql`${guestFollowUps.dueDate} <= (CURRENT_DATE + ${days}::int)`,
        ),
      )
      .orderBy(asc(guestFollowUps.dueDate));
    return ok(res, rows);
  },
);

router.delete("/:id", requireAuth, requirePermission("delete_guests"), async (req, res) => {
  const id = req.params.id!;
  const [deleted] = await db.delete(guests).where(eq(guests.id, id)).returning();
  if (!deleted) return fail(res, 404, "NOT_FOUND", "Guest not found");

  await logActivity({
    action: "guest_deleted",
    entityType: "guest",
    entityId: id,
    description: `Guest ${deleted.fullName} deleted`,
    performedBy: req.user!.id,
    ipAddress: req.ip,
  });
  return ok(res, { deleted: true });
});

export default router;
