import { editPaymentSchema, paymentSchema, voidPaymentSchema } from "@hoteldesk/shared";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { Router } from "express";
import { db } from "../db/client.js";
import { invoices, payments } from "../db/schema/invoices.js";
import { reservations } from "../db/schema/reservations.js";
import { guests } from "../db/schema/guests.js";
import { logActivity } from "../lib/activity.js";
import { renderReceiptPdf } from "../lib/pdf.js";
import { generateReceiptNumber } from "../lib/receipt.js";
import { invalidateDashboard } from "../lib/redis.js";
import { getSettings } from "../lib/settings.js";
import { fail, ok } from "../lib/response.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const router = Router();
const STAFF = ["admin", "frontdesk"] as const;

router.post(
  "/",
  requireAuth,
  requirePermission("record_payments"),
  validate(paymentSchema),
  async (req, res) => {
    const input = req.body as import("@hoteldesk/shared").PaymentInput;
    const inv = await db.select().from(invoices).where(eq(invoices.id, input.invoiceId)).limit(1);
    if (!inv.length) return fail(res, 404, "NOT_FOUND", "Invoice not found");
    if (inv[0]!.status === "voided") return fail(res, 409, "VOIDED", "Invoice is voided");

    const rcpNum = await generateReceiptNumber();
    const created = await db.transaction(async (tx) => {
      const [pay] = await tx
        .insert(payments)
        .values({
          receiptNumber: rcpNum,
          invoiceId: input.invoiceId,
          reservationId: inv[0]!.reservationId,
          amount: String(input.amount),
          paymentMethod: input.paymentMethod,
          receivedBy: req.user!.id,
          notes: input.notes ?? null,
        })
        .returning();

      const newTotalPaid = +(Number(inv[0]!.totalPaid) + input.amount).toFixed(2);
      const newBalance = +(Number(inv[0]!.grandTotal) - newTotalPaid).toFixed(2);
      const newStatus = newBalance <= 0.009 ? "paid" : "partial";

      await tx
        .update(invoices)
        .set({
          totalPaid: String(newTotalPaid),
          balanceDue: String(newBalance),
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, input.invoiceId));

      await tx
        .update(reservations)
        .set({ balanceDue: String(newBalance), updatedAt: new Date() })
        .where(eq(reservations.id, inv[0]!.reservationId));

      return pay!;
    });

    await logActivity({
      action: "payment_recorded",
      entityType: "invoice",
      entityId: input.invoiceId,
      description: `Payment ₹${input.amount} via ${input.paymentMethod} on ${inv[0]!.invoiceNumber}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    await invalidateDashboard();
    return ok(res, created, 201);
  },
);

router.get("/", requireAuth, requirePermission("view_collections"), async (req, res) => {
  const { date_from, date_to, method } = req.query as Record<string, string | undefined>;
  const conditions = [];
  if (date_from) conditions.push(gte(payments.paymentDate, new Date(date_from)));
  if (date_to) conditions.push(lte(payments.paymentDate, new Date(date_to)));
  if (method) conditions.push(eq(payments.paymentMethod, method as never));

  const rows = await db
    .select()
    .from(payments)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(payments.paymentDate))
    .limit(500);
  return ok(res, rows);
});

router.get("/:id/receipt", requireAuth, requirePermission("record_payments"), async (req, res) => {
  const id = req.params.id!;
  const pay = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
  if (!pay.length) return fail(res, 404, "NOT_FOUND", "Payment not found");

  const r = await db
    .select()
    .from(reservations)
    .where(eq(reservations.id, pay[0]!.reservationId))
    .limit(1);
  const g = r.length
    ? await db.select().from(guests).where(eq(guests.id, r[0]!.guestId)).limit(1)
    : [];
  const inv = pay[0]!.invoiceId
    ? await db.select().from(invoices).where(eq(invoices.id, pay[0]!.invoiceId)).limit(1)
    : [];
  const settings = await getSettings();

  const pdf = await renderReceiptPdf({
    payment: pay[0]!,
    reservation: r[0]!,
    guest: g[0]!,
    invoice: inv[0] ?? null,
    settings,
  });
  const inline = req.query.disposition === "inline";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename="${pay[0]!.receiptNumber ?? "receipt"}.pdf"`,
  );
  return res.send(pdf);
});

router.patch(
  "/:id",
  requireAuth,
  requirePermission("record_payments"),
  validate(editPaymentSchema),
  async (req, res) => {
    const id = req.params.id!;
    const input = req.body as {
      paymentDate?: string;
      paymentMethod?: string;
      notes?: string | null;
    };

    const existing = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
    if (!existing.length) return fail(res, 404, "NOT_FOUND", "Payment not found");
    if (existing[0]!.voided) return fail(res, 400, "VOIDED", "Payment is voided");

    const ageMs = Date.now() - new Date(existing[0]!.createdAt).getTime();
    if (ageMs > 24 * 60 * 60 * 1000) {
      return fail(res, 400, "EXPIRED", "Payment can only be edited within 24 hours of creation");
    }

    const patch: Record<string, unknown> = {};
    if (input.paymentDate !== undefined) patch.paymentDate = new Date(input.paymentDate);
    if (input.paymentMethod !== undefined) patch.paymentMethod = input.paymentMethod;
    if (input.notes !== undefined) patch.notes = input.notes;

    const [updated] = await db.update(payments).set(patch).where(eq(payments.id, id)).returning();
    await logActivity({
      action: "payment_edited",
      entityType: "payment",
      entityId: id,
      description: `Payment ${id.slice(0, 8)} edited`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
      metadata: input,
    });
    return ok(res, updated);
  },
);

router.post(
  "/:id/void",
  requireAuth,
  requirePermission("void_payments"),
  validate(voidPaymentSchema),
  async (req, res) => {
    const id = req.params.id!;
    const { reason } = req.body as { reason: string };

    const existing = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
    if (!existing.length) return fail(res, 404, "NOT_FOUND", "Payment not found");
    if (existing[0]!.voided) return fail(res, 400, "ALREADY_VOIDED", "Already voided");

    const inv = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, existing[0]!.invoiceId))
      .limit(1);

    await db.transaction(async (tx) => {
      await tx
        .update(payments)
        .set({
          voided: true,
          voidedReason: reason,
          voidedBy: req.user!.id,
          voidedAt: new Date(),
        })
        .where(eq(payments.id, id));

      if (inv.length) {
        const newTotalPaid = +(Number(inv[0]!.totalPaid) - Number(existing[0]!.amount)).toFixed(2);
        const newBalance = +(Number(inv[0]!.grandTotal) - newTotalPaid).toFixed(2);
        const newStatus = newBalance <= 0.009 ? "paid" : newTotalPaid > 0 ? "partial" : "issued";
        await tx
          .update(invoices)
          .set({
            totalPaid: String(Math.max(0, newTotalPaid)),
            balanceDue: String(newBalance),
            status: newStatus,
            updatedAt: new Date(),
          })
          .where(eq(invoices.id, inv[0]!.id));

        await tx
          .update(reservations)
          .set({ balanceDue: String(newBalance), updatedAt: new Date() })
          .where(eq(reservations.id, existing[0]!.reservationId));
      }
    });

    await logActivity({
      action: "payment_voided",
      entityType: "payment",
      entityId: id,
      description: `Payment ₹${existing[0]!.amount} voided: ${reason}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    await invalidateDashboard();
    return ok(res, { success: true });
  },
);

// Mark a pending (unpaid) payment as received with the actual method
router.post(
  "/:id/mark-received",
  requireAuth,
  requirePermission("record_payments"),
  async (req, res) => {
    const id = req.params.id!;
    const body = req.body as { paymentMethod?: string; notes?: string };
    const validMethods = ["cash", "upi", "card", "bank_transfer"] as const;
    if (!body.paymentMethod || !validMethods.includes(body.paymentMethod as never)) {
      return fail(res, 400, "INVALID_METHOD", "Choose cash / upi / card / bank_transfer");
    }

    const [existing] = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
    if (!existing) return fail(res, 404, "NOT_FOUND", "Payment not found");
    if (existing.status !== "pending") {
      return fail(res, 400, "NOT_PENDING", "Payment is not pending");
    }
    if (existing.voided) return fail(res, 400, "VOIDED", "Payment is voided");

    const amount = Number(existing.amount);

    await db.transaction(async (tx) => {
      await tx
        .update(payments)
        .set({
          status: "received",
          paymentMethod: body.paymentMethod as "cash" | "upi" | "card" | "bank_transfer",
          paymentDate: new Date(),
          receivedBy: req.user!.id,
          notes: body.notes ? body.notes : existing.notes,
        })
        .where(eq(payments.id, id));

      if (existing.invoiceId) {
        const [inv] = await tx.select().from(invoices).where(eq(invoices.id, existing.invoiceId)).limit(1);
        if (inv) {
          const newTotalPaid = +(Number(inv.totalPaid) + amount).toFixed(2);
          const newBalance = +(Number(inv.grandTotal) - newTotalPaid).toFixed(2);
          const newStatus = newBalance <= 0.009 ? "paid" : newTotalPaid > 0 ? "partial" : "issued";
          await tx
            .update(invoices)
            .set({
              totalPaid: String(newTotalPaid),
              balanceDue: String(Math.max(0, newBalance)),
              status: newStatus,
              updatedAt: new Date(),
            })
            .where(eq(invoices.id, inv.id));

          await tx
            .update(reservations)
            .set({ balanceDue: String(Math.max(0, newBalance)), updatedAt: new Date() })
            .where(eq(reservations.id, existing.reservationId));
        }
      }
    });

    await logActivity({
      action: "payment_marked_received",
      entityType: "payment",
      entityId: id,
      description: `Pending ₹${existing.amount} marked received via ${body.paymentMethod}`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    await invalidateDashboard();
    return ok(res, { success: true });
  },
);

export default router;
