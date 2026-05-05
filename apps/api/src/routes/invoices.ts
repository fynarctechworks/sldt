import { editInvoiceSchema, voidInvoiceSchema } from "@hoteldesk/shared";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { Router } from "express";
import { db } from "../db/client.js";
import { invoiceLineItems, invoices, payments } from "../db/schema/invoices.js";
import { reservations } from "../db/schema/reservations.js";
import { logActivity } from "../lib/activity.js";
import { nextInvoiceSequence } from "../lib/availability.js";
import { invoiceNumber } from "../lib/numbers.js";
import { renderInvoicePdf } from "../lib/pdf.js";
import { invalidateDashboard } from "../lib/redis.js";
import { getSettings } from "../lib/settings.js";
import { fail, list, ok } from "../lib/response.js";
import { requireAdmin, requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const router = Router();
const STAFF = ["admin", "frontdesk"] as const;

router.get("/", requireAuth, requireRole(...STAFF), async (req, res) => {
  const { status, date_from, date_to } = req.query as Record<string, string | undefined>;
  const page = Math.max(1, Number(req.query.page ?? 1));
  const per_page = Math.min(100, Math.max(1, Number(req.query.per_page ?? 25)));

  const conditions = [];
  if (status) conditions.push(eq(invoices.status, status as never));
  if (date_from) conditions.push(gte(invoices.createdAt, new Date(date_from)));
  if (date_to) conditions.push(lte(invoices.createdAt, new Date(date_to)));

  const [rows, total] = await Promise.all([
    db
      .select()
      .from(invoices)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(invoices.createdAt))
      .limit(per_page)
      .offset((page - 1) * per_page),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoices)
      .where(conditions.length ? and(...conditions) : undefined),
  ]);

  return list(res, rows, { total: total[0]?.count ?? 0, page, per_page });
});

router.get("/:id", requireAuth, requireRole(...STAFF), async (req, res) => {
  const id = req.params.id!;
  const inv = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!inv.length) return fail(res, 404, "NOT_FOUND", "Invoice not found");
  const [items, pays] = await Promise.all([
    db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, id)),
    db.select().from(payments).where(eq(payments.invoiceId, id)).orderBy(desc(payments.paymentDate)),
  ]);
  return ok(res, { ...inv[0], lineItems: items, payments: pays });
});

router.get("/:id/pdf", requireAuth, requireRole(...STAFF), async (req, res) => {
  const id = req.params.id!;
  const inv = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!inv.length) return fail(res, 404, "NOT_FOUND", "Invoice not found");
  const [items, pays] = await Promise.all([
    db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, id)),
    db.select().from(payments).where(eq(payments.invoiceId, id)),
  ]);
  const settings = await getSettings();
  const pdf = await renderInvoicePdf({ invoice: inv[0]!, lineItems: items, payments: pays, settings });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${inv[0]!.invoiceNumber}.pdf"`);
  return res.send(pdf);
});

router.patch(
  "/:id",
  requireAuth,
  requireAdmin,
  validate(editInvoiceSchema),
  async (req, res) => {
    const id = req.params.id!;
    const input = req.body as { issueDate?: string; notes?: string | null };

    const inv = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    if (!inv.length) return fail(res, 404, "NOT_FOUND", "Invoice not found");
    if (inv[0]!.status === "paid") {
      return fail(res, 400, "PAID", "Cannot edit a paid invoice. Use Reissue instead");
    }
    if (inv[0]!.status === "voided") {
      return fail(res, 400, "VOIDED", "Invoice is voided");
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.issueDate !== undefined) patch.issueDate = input.issueDate;
    if (input.notes !== undefined) patch.notes = input.notes;

    const [updated] = await db.update(invoices).set(patch).where(eq(invoices.id, id)).returning();
    await logActivity({
      action: "invoice_edited",
      entityType: "invoice",
      entityId: id,
      description: `${updated!.invoiceNumber} edited`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
      metadata: input,
    });
    return ok(res, updated);
  },
);

router.post(
  "/:id/reissue",
  requireAuth,
  requireAdmin,
  validate(voidInvoiceSchema),
  async (req, res) => {
    const id = req.params.id!;
    const { reason } = req.body as { reason: string };

    const old = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    if (!old.length) return fail(res, 404, "NOT_FOUND", "Invoice not found");
    const original = old[0]!;
    if (original.status === "voided") return fail(res, 400, "ALREADY_VOIDED", "Already voided");

    const oldItems = await db
      .select()
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, id));

    const prefix = original.invoiceNumber.split("-")[0]!;
    const monthPart = original.invoiceNumber.split("-")[1] ?? "";
    const nextSeq = await nextInvoiceSequence(`${prefix}-${monthPart}-%`);
    const newNumber = invoiceNumber(prefix, nextSeq);

    const created = await db.transaction(async (tx) => {
      await tx
        .update(invoices)
        .set({
          status: "voided",
          voidedReason: `Reissued: ${reason}`,
          voidedBy: req.user!.id,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, id));

      const [newInv] = await tx
        .insert(invoices)
        .values({
          invoiceNumber: newNumber,
          reservationId: original.reservationId,
          guestId: original.guestId,
          hotelName: original.hotelName,
          hotelAddress: original.hotelAddress,
          hotelGstin: original.hotelGstin,
          guestName: original.guestName,
          guestAddress: original.guestAddress,
          guestGstin: original.guestGstin,
          subtotal: original.subtotal,
          cgstRate: original.cgstRate,
          cgstAmount: original.cgstAmount,
          sgstRate: original.sgstRate,
          sgstAmount: original.sgstAmount,
          grandTotal: original.grandTotal,
          totalPaid: "0",
          balanceDue: original.grandTotal,
          status: "issued",
          notes: `Reissued from ${original.invoiceNumber}. ${reason}`,
          reissuedFrom: id,
          issuedBy: req.user!.id,
        })
        .returning();

      if (oldItems.length) {
        await tx.insert(invoiceLineItems).values(
          oldItems.map((it) => ({
            invoiceId: newInv!.id,
            description: it.description,
            sacCode: it.sacCode,
            quantity: it.quantity,
            rate: it.rate,
            amount: it.amount,
            gstRate: it.gstRate,
            gstAmount: it.gstAmount,
            itemType: it.itemType,
          })),
        );
      }

      await tx
        .update(reservations)
        .set({ balanceDue: original.grandTotal, updatedAt: new Date() })
        .where(eq(reservations.id, original.reservationId));

      return newInv!;
    });

    await logActivity({
      action: "invoice_reissued",
      entityType: "invoice",
      entityId: created.id,
      description: `${original.invoiceNumber} → ${created.invoiceNumber}: ${reason}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
      metadata: { originalId: id, reason },
    });
    await invalidateDashboard();
    return ok(res, created, 201);
  },
);

router.post(
  "/:id/void",
  requireAuth,
  requireAdmin,
  validate(voidInvoiceSchema),
  async (req, res) => {
    const id = req.params.id!;
    const { reason } = req.body as { reason: string };
    const [updated] = await db
      .update(invoices)
      .set({
        status: "voided",
        voidedReason: reason,
        voidedBy: req.user!.id,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, id))
      .returning();
    if (!updated) return fail(res, 404, "NOT_FOUND", "Invoice not found");

    await logActivity({
      action: "invoice_voided",
      entityType: "invoice",
      entityId: id,
      description: `${updated.invoiceNumber} voided: ${reason}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    await invalidateDashboard();
    return ok(res, updated);
  },
);

export default router;
