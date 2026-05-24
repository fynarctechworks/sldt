// DPDP Act 2023 — data-subject request endpoints.
//
// Endpoints:
//   POST /dpdp/export          — produce + log a per-guest export
//   POST /dpdp/delete          — redact a guest's PII in-place + log
//   GET  /dpdp/exports         — admin: list past export requests
//   GET  /dpdp/deletions       — admin: list past deletion requests
//   GET  /dpdp/guest/:id/log   — admin: consent change history for one guest
//
// Process flow (matches DPDP Sec 11/12 obligations):
//   1. Subject identifies themselves at the desk or via a verified
//      channel (OTP). Staff confirms identity.
//   2. Staff hits "Export" or "Delete" on the guest's page.
//   3. Server aggregates: guest row, all reservations + invoices +
//      payments + KYC photos + activity log entries owned by the guest.
//   4. For Export → returns JSON, stores it in dpdp_exports.
//   5. For Delete → redacts PII (name → "REDACTED-<uuid8>", phone →
//      "REDACTED", email → null, encrypted IDs → empty), preserves
//      financial rows for tax history, writes dpdp_deletions log.

import {
  dpdpDeleteRequestSchema,
  dpdpExportRequestSchema,
} from "@hoteldesk/shared";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Router } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "../db/client.js";
import { activityLog } from "../db/schema/activity.js";
import {
  dpdpDeletions,
  dpdpExports,
  marketingConsentLog,
} from "../db/schema/compliance.js";
import { guests } from "../db/schema/guests.js";
import { invoices, payments } from "../db/schema/invoices.js";
import { reservations } from "../db/schema/reservations.js";
import { logActivity } from "../lib/activity.js";
import { resolveCurrentPropertyId } from "../lib/currentProperty.js";
import { fail, list, ok } from "../lib/response.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const router = Router();

router.post(
  "/export",
  requireAuth,
  requirePermission("process_dpdp"),
  validate(dpdpExportRequestSchema),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const input = req.body as z.infer<typeof dpdpExportRequestSchema>;

    const [guest] = await db
      .select()
      .from(guests)
      .where(and(eq(guests.id, input.guestId), eq(guests.propertyId, propertyId)))
      .limit(1);
    if (!guest) return fail(res, 404, "GUEST_NOT_FOUND", "Guest not found");

    // Assemble the payload. The encrypted ID number is excluded — we
    // export only the last4 and the type for compliance. If the subject
    // demands the encrypted ID, staff can decrypt offline.
    const [resRows, invRows, payRows, consentRows] = await Promise.all([
      db.select().from(reservations).where(eq(reservations.guestId, input.guestId)),
      db.select().from(invoices).where(eq(invoices.guestId, input.guestId)),
      db
        .select({ p: payments })
        .from(payments)
        .innerJoin(reservations, eq(reservations.id, payments.reservationId))
        .where(eq(reservations.guestId, input.guestId)),
      db
        .select()
        .from(marketingConsentLog)
        .where(eq(marketingConsentLog.guestId, input.guestId))
        .orderBy(desc(marketingConsentLog.changedAt)),
    ]);

    // Strip sensitive fields from the guest row.
    const { idProofNumberEncrypted: _e, ...guestSafe } = guest;
    void _e;

    const payload = {
      exportedAt: new Date().toISOString(),
      subject: {
        ...guestSafe,
        idType: guest.idProofType,
        idLast4: guest.idProofLast4,
      },
      reservations: resRows,
      invoices: invRows,
      payments: payRows.map((r) => r.p),
      marketingConsentLog: consentRows,
    };

    const [exportRow] = await db
      .insert(dpdpExports)
      .values({
        propertyId,
        guestId: input.guestId,
        subjectName: guest.fullName,
        subjectPhone: guest.phone,
        subjectEmail: guest.email,
        verificationMethod: input.verificationMethod,
        exportPayload: payload,
        requestedBy: req.user!.id,
        fulfilledBy: req.user!.id,
      })
      .returning();

    await logActivity({
      action: "dpdp_export",
      entityType: "guest",
      entityId: input.guestId,
      description: `Data export fulfilled for ${guest.fullName} (verified via ${input.verificationMethod})`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });

    return ok(res, { id: exportRow!.id, payload });
  },
);

router.post(
  "/delete",
  requireAuth,
  requirePermission("process_dpdp"),
  validate(dpdpDeleteRequestSchema),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const input = req.body as z.infer<typeof dpdpDeleteRequestSchema>;
    const [guest] = await db
      .select()
      .from(guests)
      .where(and(eq(guests.id, input.guestId), eq(guests.propertyId, propertyId)))
      .limit(1);
    if (!guest) return fail(res, 404, "GUEST_NOT_FOUND", "Guest not found");

    // Snapshot the original PII for the audit trail.
    const snapshot = {
      fullName: guest.fullName,
      phone: guest.phone,
      email: guest.email,
      address: guest.address,
      city: guest.city,
      state: guest.state,
      dateOfBirth: guest.dateOfBirth,
      idProofType: guest.idProofType,
      idProofLast4: guest.idProofLast4,
      idProofPhotoFront: guest.idProofPhotoFront,
      idProofPhotoBack: guest.idProofPhotoBack,
      guestPhoto: guest.guestPhoto,
    };
    const redactionMarker = `REDACTED-${randomBytes(4).toString("hex")}`;

    await db.transaction(async (tx) => {
      await tx
        .update(guests)
        .set({
          fullName: redactionMarker,
          phone: redactionMarker,
          email: null,
          address: null,
          city: null,
          state: null,
          dateOfBirth: null,
          idProofNumberEncrypted: "",
          idProofLast4: "0000",
          idProofPhotoFront: null,
          idProofPhotoBack: null,
          guestPhoto: null,
          notes: null,
          preferences: sql`'{}'::jsonb`,
          marketingConsentAt: null,
          marketingConsentChannel: null,
          updatedAt: new Date(),
        })
        .where(eq(guests.id, input.guestId));

      await tx.insert(dpdpDeletions).values({
        propertyId,
        guestId: input.guestId,
        subjectSnapshot: snapshot,
        redactedFields: [
          "full_name",
          "phone",
          "email",
          "address",
          "city",
          "state",
          "date_of_birth",
          "id_proof_number_encrypted",
          "id_proof_last4",
          "id_proof_photo_front",
          "id_proof_photo_back",
          "guest_photo",
          "notes",
          "preferences",
          "marketing_consent_at",
        ],
        reason: input.reason,
        verificationMethod: input.verificationMethod,
        requestedBy: req.user!.id,
        fulfilledBy: req.user!.id,
      });

      // Also revoke marketing consent so subsequent campaigns skip.
      await tx.insert(marketingConsentLog).values({
        propertyId,
        guestId: input.guestId,
        granted: false,
        source: "dpdp_request",
        changedBy: req.user!.id,
      });
    });

    await logActivity({
      action: "dpdp_delete",
      entityType: "guest",
      entityId: input.guestId,
      description: `Data deletion fulfilled (verified via ${input.verificationMethod}): ${input.reason}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    return ok(res, { redacted: true });
  },
);

router.get(
  "/exports",
  requireAuth,
  requirePermission("view_dpdp"),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const rows = await db
      .select()
      .from(dpdpExports)
      .where(eq(dpdpExports.propertyId, propertyId))
      .orderBy(desc(dpdpExports.requestedAt))
      .limit(100);
    return list(res, rows, { total: rows.length, page: 1, per_page: rows.length });
  },
);

router.get(
  "/deletions",
  requireAuth,
  requirePermission("view_dpdp"),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const rows = await db
      .select()
      .from(dpdpDeletions)
      .where(eq(dpdpDeletions.propertyId, propertyId))
      .orderBy(desc(dpdpDeletions.fulfilledAt))
      .limit(100);
    return list(res, rows, { total: rows.length, page: 1, per_page: rows.length });
  },
);

router.get(
  "/guest/:id/log",
  requireAuth,
  requirePermission("view_dpdp"),
  async (req, res) => {
    const id = req.params.id!;
    const propertyId = await resolveCurrentPropertyId(req);
    const rows = await db
      .select()
      .from(marketingConsentLog)
      .where(
        and(
          eq(marketingConsentLog.guestId, id),
          eq(marketingConsentLog.propertyId, propertyId),
        ),
      )
      .orderBy(desc(marketingConsentLog.changedAt));
    return ok(res, rows);
  },
);

export default router;
