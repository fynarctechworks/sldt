// Folios API (Phase 2 — split-bill model).
//
// Folios live INSIDE a reservation, so the routes are nested:
//   GET    /reservations/:resId/folios                       — list
//   POST   /reservations/:resId/folios                       — create
//   GET    /folios/:id                                        — detail
//   PATCH  /folios/:id                                        — meta edit
//   POST   /folios/:id/settle                                 — mark settled
//   POST   /folios/:id/charges                                — add charge
//   PATCH  /folios/:id/charges/:chargeId/move                 — move to other folio
//   POST   /folios/:id/charges/:chargeId/void                 — void a charge
//
// Mounted at two prefixes (see index.ts):
//   /reservations/:resId/folios       → list + create
//   /folios                            → detail + ops

import {
  folioChargeCreateSchema,
  folioChargeMoveSchema,
  folioCreateSchema,
} from "@hoteldesk/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { folioCharges, folios } from "../db/schema/folios.js";
import { reservations } from "../db/schema/reservations.js";
import { logActivity } from "../lib/activity.js";
import { fail, ok } from "../lib/response.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

// --- Reservation-scoped subrouter ---
export const reservationFoliosRouter = Router({ mergeParams: true });

reservationFoliosRouter.get(
  "/",
  requireAuth,
  requirePermission("view_reservations"),
  async (req, res) => {
    const resId = req.params.resId!;
    const rows = await db
      .select()
      .from(folios)
      .where(eq(folios.reservationId, resId))
      .orderBy(asc(folios.folioNumber));
    return ok(res, rows);
  },
);

reservationFoliosRouter.post(
  "/",
  requireAuth,
  requirePermission("split_folios"),
  validate(folioCreateSchema),
  async (req, res) => {
    const resId = req.params.resId!;
    const input = req.body as z.infer<typeof folioCreateSchema>;

    const [resv] = await db
      .select({ id: reservations.id, propertyId: reservations.propertyId })
      .from(reservations)
      .where(eq(reservations.id, resId))
      .limit(1);
    if (!resv) return fail(res, 404, "RES_NOT_FOUND", "Reservation not found");

    const created = await db.transaction(async (tx) => {
      // Allocate next folio_number for this reservation.
      const [maxRow] = await tx
        .select({ m: sql<number>`COALESCE(MAX(${folios.folioNumber}), 0)::int` })
        .from(folios)
        .where(eq(folios.reservationId, resId));
      const next = (maxRow?.m ?? 0) + 1;

      const [row] = await tx
        .insert(folios)
        .values({
          propertyId: resv.propertyId,
          reservationId: resId,
          folioNumber: next,
          label: input.label,
          payerType: input.payerType,
          payerGuestId: input.payerGuestId ?? null,
          payerCompanyId: input.payerCompanyId ?? null,
          payerName: input.payerName ?? null,
          // First folio created becomes primary by default.
          isPrimary: next === 1,
          notes: input.notes ?? null,
        })
        .returning();
      return row!;
    });

    await logActivity({
      action: "folio_created",
      entityType: "folio",
      entityId: created.id,
      description: `Folio ${created.folioNumber} (${created.label}) created on reservation`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    return ok(res, created, 201);
  },
);

// --- Folio-scoped router ---
export const foliosRouter = Router();

foliosRouter.get(
  "/:id",
  requireAuth,
  requirePermission("view_reservations"),
  async (req, res) => {
    const id = req.params.id!;
    const [folio] = await db.select().from(folios).where(eq(folios.id, id)).limit(1);
    if (!folio) return fail(res, 404, "NOT_FOUND", "Folio not found");
    const charges = await db
      .select()
      .from(folioCharges)
      .where(eq(folioCharges.folioId, id))
      .orderBy(asc(folioCharges.chargeDate));
    return ok(res, { ...folio, charges });
  },
);

const folioUpdateSchema = z.object({
  label: z.string().min(1).max(80).optional(),
  notes: z.string().max(500).nullable().optional(),
});

foliosRouter.patch(
  "/:id",
  requireAuth,
  requirePermission("split_folios"),
  validate(folioUpdateSchema),
  async (req, res) => {
    const id = req.params.id!;
    const patch = req.body as z.infer<typeof folioUpdateSchema>;
    const [updated] = await db
      .update(folios)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(folios.id, id))
      .returning();
    if (!updated) return fail(res, 404, "NOT_FOUND", "Folio not found");
    return ok(res, updated);
  },
);

foliosRouter.post(
  "/:id/settle",
  requireAuth,
  requirePermission("split_folios"),
  async (req, res) => {
    const id = req.params.id!;
    const [folio] = await db.select().from(folios).where(eq(folios.id, id)).limit(1);
    if (!folio) return fail(res, 404, "NOT_FOUND", "Folio not found");
    if (Number(folio.balanceDue) > 0.009) {
      return fail(
        res,
        409,
        "BALANCE_DUE",
        `Folio still has ₹${folio.balanceDue} due. Record payment first.`,
      );
    }
    const [updated] = await db
      .update(folios)
      .set({ status: "settled", updatedAt: new Date() })
      .where(eq(folios.id, id))
      .returning();
    await logActivity({
      action: "folio_settled",
      entityType: "folio",
      entityId: id,
      description: `Folio ${folio.folioNumber} settled`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    return ok(res, updated);
  },
);

foliosRouter.post(
  "/:id/charges",
  requireAuth,
  requirePermission("split_folios"),
  validate(folioChargeCreateSchema),
  async (req, res) => {
    const id = req.params.id!;
    const input = req.body as z.infer<typeof folioChargeCreateSchema>;
    const [folio] = await db.select().from(folios).where(eq(folios.id, id)).limit(1);
    if (!folio) return fail(res, 404, "NOT_FOUND", "Folio not found");
    if (folio.status !== "open") {
      return fail(res, 409, "FOLIO_CLOSED", "Cannot add charges to a settled or voided folio");
    }
    const amount = +(input.rate * input.quantity).toFixed(2);
    // For discount line items, we negate the amount so totals subtract.
    // The DB CHECK constraint enforces source='discount' AND amount<=0.
    const signedAmount = input.source === "discount" ? -Math.abs(amount) : amount;
    const gstAmount = +(Math.abs(signedAmount) * (input.gstRate / 100)).toFixed(2);

    const [row] = await db
      .insert(folioCharges)
      .values({
        folioId: id,
        source: input.source,
        description: input.description,
        quantity: String(input.quantity),
        rate: String(input.rate),
        amount: String(signedAmount),
        gstRate: String(input.gstRate),
        gstAmount: String(input.source === "discount" ? 0 : gstAmount),
        chargeDate: input.chargeDate ?? new Date().toISOString().slice(0, 10),
        createdBy: req.user!.id,
      })
      .returning();
    return ok(res, row, 201);
  },
);

foliosRouter.patch(
  "/:id/charges/:chargeId/move",
  requireAuth,
  requirePermission("split_folios"),
  validate(folioChargeMoveSchema),
  async (req, res) => {
    const { id, chargeId } = req.params as { id: string; chargeId: string };
    const { toFolioId } = req.body as z.infer<typeof folioChargeMoveSchema>;

    // Source + destination folio must share the same reservation.
    const folioRows = await db
      .select({
        id: folios.id,
        reservationId: folios.reservationId,
        status: folios.status,
      })
      .from(folios)
      .where(sql`${folios.id} IN (${id}::uuid, ${toFolioId}::uuid)`);
    const src = folioRows.find((f) => f.id === id);
    const dst = folioRows.find((f) => f.id === toFolioId);
    if (!src || !dst) return fail(res, 404, "NOT_FOUND", "Folio not found");
    if (src.reservationId !== dst.reservationId) {
      return fail(res, 409, "CROSS_RESERVATION", "Cannot move charges between reservations");
    }
    if (dst.status !== "open") {
      return fail(res, 409, "DEST_CLOSED", "Destination folio is settled or voided");
    }

    const [moved] = await db
      .update(folioCharges)
      .set({ folioId: toFolioId })
      .where(and(eq(folioCharges.id, chargeId), eq(folioCharges.folioId, id)))
      .returning();
    if (!moved) return fail(res, 404, "CHARGE_NOT_FOUND", "Charge not found on source folio");

    await logActivity({
      action: "folio_charge_moved",
      entityType: "folio_charge",
      entityId: chargeId,
      description: `Charge moved between folios`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
      metadata: { from: id, to: toFolioId },
    });
    return ok(res, moved);
  },
);

const folioChargeVoidSchema = z.object({
  reason: z.string().min(2).max(500),
});

foliosRouter.post(
  "/:id/charges/:chargeId/void",
  requireAuth,
  requirePermission("split_folios"),
  validate(folioChargeVoidSchema),
  async (req, res) => {
    const { id, chargeId } = req.params as { id: string; chargeId: string };
    const { reason } = req.body as z.infer<typeof folioChargeVoidSchema>;
    const [voided] = await db
      .update(folioCharges)
      .set({
        voided: true,
        voidedReason: reason,
        voidedAt: new Date(),
        voidedBy: req.user!.id,
      })
      .where(and(eq(folioCharges.id, chargeId), eq(folioCharges.folioId, id)))
      .returning();
    if (!voided) return fail(res, 404, "NOT_FOUND", "Charge not found");
    return ok(res, voided);
  },
);

export default foliosRouter;
