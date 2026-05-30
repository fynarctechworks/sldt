import { editInvoiceSchema } from "@hoteldesk/shared";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { Router } from "express";
import { db } from "../db/client.js";
import { invoiceLineItems, invoices, payments } from "../db/schema/invoices.js";
import { reservations } from "../db/schema/reservations.js";
import { logActivity } from "../lib/activity.js";
import { loadGuestExtra } from "../lib/guestExtra.js";
import { renderInvoicePdf } from "../lib/pdf.js";
import { invalidateDashboard } from "../lib/redis.js";
import { getSettings } from "../lib/settings.js";
import { fail, list, ok } from "../lib/response.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const router = Router();

router.get("/", requireAuth, requirePermission("view_invoices"), async (req, res) => {
  const { status, date_from, date_to, scope, q } = req.query as Record<
    string,
    string | undefined
  >;
  const page = Math.max(1, Number(req.query.page ?? 1));
  const per_page = Math.min(100, Math.max(1, Number(req.query.per_page ?? 25)));

  const conditions = [];
  if (status) conditions.push(eq(invoices.status, status as never));
  if (date_from) conditions.push(gte(invoices.createdAt, new Date(date_from)));
  if (date_to) conditions.push(lte(invoices.createdAt, new Date(date_to)));
  if (scope) conditions.push(eq(invoices.scope, scope as never));
  if (q && q.trim()) {
    // Match invoice number, billed-to guest name, or guest GSTIN. The
    // reservation number is fetched via a sub-query so the search hits
    // common front-desk shorthand like "RES-0042" too.
    const needle = `%${q.trim()}%`;
    conditions.push(
      sql`(
        ${invoices.invoiceNumber} ILIKE ${needle}
        OR ${invoices.guestName} ILIKE ${needle}
        OR COALESCE(${invoices.guestGstin}, '') ILIKE ${needle}
        OR EXISTS (
          SELECT 1 FROM ${reservations} r2
          WHERE r2.id = ${invoices.reservationId}
            AND r2.reservation_number ILIKE ${needle}
        )
      )`,
    );
  }

  const where = conditions.length ? and(...conditions) : undefined;
  const [rows, total] = await Promise.all([
    db
      .select({
        // Pull the reservation number alongside so the UI can show it
        // without a per-row round-trip.
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        reservationId: invoices.reservationId,
        reservationNumber: reservations.reservationNumber,
        guestId: invoices.guestId,
        guestName: invoices.guestName,
        guestGstin: invoices.guestGstin,
        subtotal: invoices.subtotal,
        grandTotal: invoices.grandTotal,
        totalPaid: invoices.totalPaid,
        balanceDue: invoices.balanceDue,
        status: invoices.status,
        scope: invoices.scope,
        scopeRoomIds: invoices.scopeRoomIds,
        createdAt: invoices.createdAt,
      })
      .from(invoices)
      .leftJoin(reservations, eq(reservations.id, invoices.reservationId))
      .where(where)
      .orderBy(desc(invoices.createdAt))
      .limit(per_page)
      .offset((page - 1) * per_page),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoices)
      .leftJoin(reservations, eq(reservations.id, invoices.reservationId))
      .where(where),
  ]);

  return list(res, rows, { total: total[0]?.count ?? 0, page, per_page });
});

router.get("/:id", requireAuth, requirePermission("view_invoices"), async (req, res) => {
  const id = req.params.id!;
  const inv = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!inv.length) return fail(res, 404, "NOT_FOUND", "Invoice not found");
  const [items, pays, [resRow]] = await Promise.all([
    db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, id)),
    db.select().from(payments).where(eq(payments.invoiceId, id)).orderBy(desc(payments.paymentDate)),
    db.select().from(reservations).where(eq(reservations.id, inv[0]!.reservationId)).limit(1),
  ]);
  return ok(res, {
    ...inv[0],
    lineItems: items,
    payments: pays,
    // Surface the reservation's stay dates so the invoice editor can
    // display + modify them without a separate fetch.
    checkInDate: resRow?.checkInDate ?? null,
    checkOutDate: resRow?.checkOutDate ?? null,
    numNights: resRow ? Number(resRow.numNights) : null,
  });
});

router.get("/:id/pdf", requireAuth, requirePermission("view_invoices"), async (req, res) => {
  const id = req.params.id!;
  const inv = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!inv.length) return fail(res, 404, "NOT_FOUND", "Invoice not found");
  const [items, pays, [resRow]] = await Promise.all([
    db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, id)),
    db.select().from(payments).where(eq(payments.invoiceId, id)),
    db.select().from(reservations).where(eq(reservations.id, inv[0]!.reservationId)).limit(1),
  ]);
  const settings = await getSettings();
  const companionCollections = await collectCompanionCollections(inv[0]!.reservationId, id);
  const guestExtra = await loadGuestExtra(inv[0]!.reservationId);
  const pdf = await renderInvoicePdf({
    invoice: inv[0]!,
    lineItems: items,
    payments: pays,
    settings,
    stay: resRow
      ? {
          checkInDate: resRow.checkInDate,
          checkOutDate: resRow.checkOutDate,
          numNights: Number(resRow.numNights),
          checkedInAt: resRow.checkedInAt
            ? resRow.checkedInAt.toISOString()
            : null,
        }
      : undefined,
    guestExtra,
    companionCollections,
  });
  const inline = req.query.disposition === "inline";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename="${inv[0]!.invoiceNumber}.pdf"`,
  );
  return res.send(pdf);
});

// Looks up other bookings that were settled at the same desk visit as
// this reservation's check-out. The "Collect previous balance" flow
// records payments with notes = "Collected at check-out of <thisResId>".
// Those payments may EITHER target an existing invoice (older paid-off
// stay) OR a pre-invoice reservation (active stay not checked out yet).
// We join via the payment's reservationId (always present) and LEFT JOIN
// invoices so pre-invoice rows aren't filtered out. The footer shows the
// invoice number when one exists, otherwise the reservation number.
async function collectCompanionCollections(
  reservationId: string,
  thisInvoiceId: string,
): Promise<
  { invoiceNumber: string | null; reservationNumber: string; amount: string }[]
> {
  // We accept two marker formats:
  //   - "Collected at check-out of SLDT-RES-XXXX" (new — human-readable)
  //   - "Collected at check-out of <uuid>"       (legacy — old payments)
  // Look up the reservation number so we can match the new format.
  const [thisRes] = await db
    .select({ reservationNumber: reservations.reservationNumber })
    .from(reservations)
    .where(eq(reservations.id, reservationId))
    .limit(1);
  const newMarker = thisRes
    ? `Collected at check-out of ${thisRes.reservationNumber}`
    : null;
  const legacyMarker = `Collected at check-out of ${reservationId}`;
  const rows = await db
    .select({
      paymentReservationId: payments.reservationId,
      amount: payments.amount,
      invoiceId: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      otherReservationNumber: reservations.reservationNumber,
    })
    .from(payments)
    .innerJoin(reservations, eq(reservations.id, payments.reservationId))
    .leftJoin(invoices, eq(invoices.reservationId, payments.reservationId))
    .where(
      and(
        eq(payments.voided, false),
        newMarker
          ? sql`${payments.notes} IN (${legacyMarker}, ${newMarker})`
          : eq(payments.notes, legacyMarker),
        // Belt-and-braces: skip rows accidentally pointing at this same invoice.
        sql`(${invoices.id} IS NULL OR ${invoices.id} <> ${thisInvoiceId})`,
      ),
    );
  // Sum per source-reservation in case multiple FIFO slices landed on the
  // same target. Keying by reservationId (not invoiceId) so pre-invoice
  // rows group correctly.
  const byReservation = new Map<
    string,
    {
      invoiceNumber: string | null;
      reservationNumber: string;
      total: number;
    }
  >();
  for (const r of rows) {
    if (!r.paymentReservationId) continue;
    const cur = byReservation.get(r.paymentReservationId);
    const amt = Number(r.amount);
    if (cur) cur.total += amt;
    else
      byReservation.set(r.paymentReservationId, {
        invoiceNumber: r.invoiceNumber ?? null,
        reservationNumber: r.otherReservationNumber,
        total: amt,
      });
  }
  return Array.from(byReservation.values()).map((v) => ({
    invoiceNumber: v.invoiceNumber,
    reservationNumber: v.reservationNumber,
    amount: v.total.toFixed(2),
  }));
}

// In-place edit of an issued invoice. Lets staff fix anything on the bill
// without spawning a new invoice number — like the receipt edit, but for
// the invoice. Voided invoices are still rejected (nothing to edit).
//
// The full before/after is captured in activity_log so a CA can reconstruct
// the original state from the audit trail.
router.patch(
  "/:id",
  requireAuth,
  requirePermission("reissue_invoices"),
  validate(editInvoiceSchema),
  async (req, res) => {
    const id = req.params.id!;
    const input = req.body as {
      issueDate?: string;
      notes?: string | null;
      guestName?: string;
      guestAddress?: string | null;
      guestGstin?: string | null;
      checkInDate?: string;
      checkOutDate?: string;
      lineItems?: Array<{
        description: string;
        sacCode: string;
        quantity: number;
        rate: number;
        gstRate: number;
        itemType: "room_charge" | "additional_charge";
      }>;
    };

    const inv = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    if (!inv.length) return fail(res, 404, "NOT_FOUND", "Invoice not found");
    if (inv[0]!.status === "voided") {
      return fail(res, 400, "VOIDED", "Invoice is voided");
    }
    // Paid invoices are immutable. Phase 1 promise: once balance_due
    // hits zero and the invoice flips to status='paid', the document
    // is locked. To correct a paid invoice, staff must Void → Reissue,
    // which produces a brand-new invoice number with a clean audit
    // trail and leaves the original payment record intact.
    //
    // The narrow exception is the `notes` field. Internal notes can
    // still be appended (e.g. "Customer queried on 12-May, resolved
    // 13-May") since they don't change the financial position. Every
    // other key is rejected.
    if (inv[0]!.status === "paid") {
      const onlyNotes =
        Object.keys(req.body ?? {}).length > 0 &&
        Object.keys(req.body ?? {}).every((k) => k === "notes");
      if (!onlyNotes) {
        return fail(
          res,
          409,
          "INVOICE_LOCKED",
          "Paid invoices are immutable. Void & reissue to correct it.",
        );
      }
    }

    const original = inv[0]!;
    const beforeSnapshot = {
      subtotal: original.subtotal,
      cgstAmount: original.cgstAmount,
      sgstAmount: original.sgstAmount,
      grandTotal: original.grandTotal,
      balanceDue: original.balanceDue,
      status: original.status,
      notes: original.notes,
      guestName: original.guestName,
      guestAddress: original.guestAddress,
      guestGstin: original.guestGstin,
      issueDate: original.issueDate,
    };

    const updated = await db.transaction(async (tx) => {
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.issueDate !== undefined) patch.issueDate = input.issueDate;
      if (input.notes !== undefined) patch.notes = input.notes;
      if (input.guestName !== undefined) patch.guestName = input.guestName;
      if (input.guestAddress !== undefined) patch.guestAddress = input.guestAddress;
      if (input.guestGstin !== undefined) patch.guestGstin = input.guestGstin;

      // Replace line items + recompute totals when provided.
      if (input.lineItems) {
        // Delete old line items first. Cascade isn't enough — we want to
        // be explicit about the replacement.
        await tx.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, id));

        let subtotal = 0;
        let totalCgst = 0;
        let totalSgst = 0;
        const newRows = input.lineItems.map((li) => {
          const amount = +(li.rate * li.quantity).toFixed(2);
          // CGST + SGST split equally from the line's GST rate. Same model
          // as initial invoice creation.
          const gstAmount = +(amount * (li.gstRate / 100)).toFixed(2);
          const halfGst = +(gstAmount / 2).toFixed(2);
          subtotal += amount;
          totalCgst += halfGst;
          totalSgst += halfGst;
          return {
            invoiceId: id,
            description: li.description,
            sacCode: li.sacCode,
            quantity: li.quantity,
            rate: String(li.rate),
            amount: String(amount),
            gstRate: String(li.gstRate),
            gstAmount: String(gstAmount),
            itemType: li.itemType,
          };
        });
        if (newRows.length) {
          await tx.insert(invoiceLineItems).values(newRows);
        }
        const grandTotal = +(subtotal + totalCgst + totalSgst).toFixed(2);
        // Use the original cgst/sgst RATE (most lines share one). If the
        // line items disagree we just store the effective totals; rate
        // columns become a "headline" reference.
        const headlineGstRate =
          input.lineItems.length > 0 ? input.lineItems[0]!.gstRate : Number(original.cgstRate) * 2;
        const halfHeadline = +(headlineGstRate / 2).toFixed(2);

        // Re-derive balance + status from the new total against existing
        // payments and wallet credit.
        const carriedPaid = Number(original.totalPaid);
        const carriedWalletCredit = Number(original.walletCreditApplied);
        const balanceDue = +(grandTotal - carriedPaid - carriedWalletCredit).toFixed(2);
        const status =
          balanceDue <= 0.009
            ? "paid"
            : carriedPaid + carriedWalletCredit > 0
              ? "partial"
              : "issued";

        patch.subtotal = String(subtotal.toFixed(2));
        patch.cgstRate = String(halfHeadline);
        patch.cgstAmount = String(totalCgst.toFixed(2));
        patch.sgstRate = String(halfHeadline);
        patch.sgstAmount = String(totalSgst.toFixed(2));
        patch.grandTotal = String(grandTotal);
        patch.balanceDue = String(balanceDue);
        patch.status = status;

        // Keep the reservation's balance_due in sync — it's used by the
        // dashboard + outstanding banner.
        await tx
          .update(reservations)
          .set({ balanceDue: String(balanceDue), updatedAt: new Date() })
          .where(eq(reservations.id, original.reservationId));
      }

      // Stay window edits live on the reservation, not the invoice. The
      // invoice PDF reads them from the reservation when rendering.
      // NOTE: `num_nights` is a Postgres GENERATED column derived from
      // check_in_date and check_out_date — we must NOT try to set it,
      // or Postgres errors with 428C9.
      if (input.checkInDate !== undefined || input.checkOutDate !== undefined) {
        const [resRow] = await tx
          .select()
          .from(reservations)
          .where(eq(reservations.id, original.reservationId))
          .limit(1);
        if (resRow) {
          const newIn = (input.checkInDate ?? resRow.checkInDate) as string;
          const newOut = (input.checkOutDate ?? resRow.checkOutDate) as string;
          if (newIn >= newOut) {
            throw new Error("Check-out date must be after check-in date");
          }
        }
        const resPatch: Record<string, unknown> = { updatedAt: new Date() };
        if (input.checkInDate !== undefined) resPatch.checkInDate = input.checkInDate;
        if (input.checkOutDate !== undefined) resPatch.checkOutDate = input.checkOutDate;
        await tx
          .update(reservations)
          .set(resPatch)
          .where(eq(reservations.id, original.reservationId));
      }

      const [row] = await tx.update(invoices).set(patch).where(eq(invoices.id, id)).returning();
      return row!;
    });

    const afterSnapshot = {
      subtotal: updated.subtotal,
      cgstAmount: updated.cgstAmount,
      sgstAmount: updated.sgstAmount,
      grandTotal: updated.grandTotal,
      balanceDue: updated.balanceDue,
      status: updated.status,
      notes: updated.notes,
      guestName: updated.guestName,
      guestAddress: updated.guestAddress,
      guestGstin: updated.guestGstin,
      issueDate: updated.issueDate,
    };

    await logActivity({
      action: "invoice_edited",
      entityType: "invoice",
      entityId: id,
      description: `${updated.invoiceNumber} edited (₹${beforeSnapshot.grandTotal} → ₹${afterSnapshot.grandTotal})`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
      metadata: {
        before: beforeSnapshot,
        after: afterSnapshot,
        lineItemsReplaced: !!input.lineItems,
      },
    });
    await invalidateDashboard();
    return ok(res, updated);
  },
);


export default router;
