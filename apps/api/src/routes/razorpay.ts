// Razorpay endpoints — feature-flagged.
//
// All routes return 503 "razorpay_not_configured" when the env keys
// aren't set, so the widget can downgrade gracefully (offer "Pay at
// property" instead).
//
// Endpoints (mounted under /razorpay):
//   GET  /razorpay/status                    — public; reports configured/not
//   POST /razorpay/create-order              — public; for a pending booking
//   POST /razorpay/verify                    — public; called after Checkout
//   POST /razorpay/refund/:paymentId         — admin

import { eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { pendingBookings } from "../db/schema/bookingEngine.js";
import {
  createOrder,
  isRazorpayConfigured,
  refund,
  verifySignature,
} from "../lib/razorpay.js";
import { fail, ok } from "../lib/response.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const router = Router();

router.get("/status", async (_req, res) => {
  return ok(res, { configured: isRazorpayConfigured() });
});

const createOrderSchema = z.object({ publicRef: z.string().min(4).max(40) });

router.post("/create-order", validate(createOrderSchema), async (req, res) => {
  if (!isRazorpayConfigured()) {
    return fail(
      res,
      503,
      "RAZORPAY_NOT_CONFIGURED",
      "Online payments are not configured for this property",
    );
  }
  const { publicRef } = req.body as z.infer<typeof createOrderSchema>;
  const [pending] = await db
    .select()
    .from(pendingBookings)
    .where(eq(pendingBookings.publicRef, publicRef))
    .limit(1);
  if (!pending) return fail(res, 404, "NOT_FOUND", "Pending booking not found");
  if (pending.paymentStatus === "paid") {
    return fail(res, 409, "ALREADY_PAID", "This booking is already paid");
  }
  const order = await createOrder({
    amount: Number(pending.quotedTotal),
    receipt: pending.publicRef,
    notes: { propertyId: pending.propertyId, pendingId: pending.id },
  });
  if (!order.ok) return fail(res, 502, order.reason.toUpperCase(), order.reason);

  await db
    .update(pendingBookings)
    .set({
      paymentProvider: "razorpay",
      paymentOrderId: order.data.id,
      paymentStatus: "pending",
    })
    .where(eq(pendingBookings.id, pending.id));

  return ok(res, {
    orderId: order.data.id,
    amount: order.data.amount,
    currency: order.data.currency,
    publicRef: pending.publicRef,
    // The publishable key the browser needs to load Checkout.
    keyId: (process.env.RAZORPAY_KEY_ID as string | undefined) ?? null,
  });
});

const verifySchema = z.object({
  publicRef: z.string().min(4).max(40),
  orderId: z.string().min(4).max(80),
  paymentId: z.string().min(4).max(80),
  signature: z.string().min(4).max(200),
});

router.post("/verify", validate(verifySchema), async (req, res) => {
  if (!isRazorpayConfigured()) {
    return fail(res, 503, "RAZORPAY_NOT_CONFIGURED", "Online payments are not configured");
  }
  const v = req.body as z.infer<typeof verifySchema>;
  const valid = verifySignature({
    orderId: v.orderId,
    paymentId: v.paymentId,
    signature: v.signature,
  });
  if (!valid) {
    return fail(res, 400, "SIGNATURE_INVALID", "Razorpay signature mismatch");
  }
  const [updated] = await db
    .update(pendingBookings)
    .set({
      paymentStatus: "paid",
      paymentPaymentId: v.paymentId,
    })
    .where(eq(pendingBookings.publicRef, v.publicRef))
    .returning();
  if (!updated) return fail(res, 404, "NOT_FOUND", "Pending booking not found");
  return ok(res, { paid: true, publicRef: updated.publicRef });
});

const refundSchema = z.object({
  amount: z.coerce.number().min(0).max(10_000_000).optional(),
});

router.post(
  "/refund/:paymentId",
  requireAuth,
  requirePermission("void_payments"),
  validate(refundSchema),
  async (req, res) => {
    if (!isRazorpayConfigured()) {
      return fail(res, 503, "RAZORPAY_NOT_CONFIGURED", "Online payments are not configured");
    }
    const { amount } = req.body as z.infer<typeof refundSchema>;
    const result = await refund({ paymentId: req.params.paymentId!, amount });
    if (!result.ok) {
      return fail(res, 502, result.reason.toUpperCase(), result.reason, result.details);
    }
    return ok(res, result.data);
  },
);

export default router;
