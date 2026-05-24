// Razorpay integration — feature-flagged.
//
// The integration is only enabled when BOTH env vars are present:
//   RAZORPAY_KEY_ID
//   RAZORPAY_KEY_SECRET
//
// Without those, every function in this module returns
// { ok: false, reason: "razorpay_not_configured" } so callers can
// gracefully degrade. When the keys ARE present, the module hits the
// Razorpay REST API directly (no SDK — same approach as the existing
// Twilio integration in messaging.ts).
//
// The public booking widget calls /razorpay/create-order, the browser
// loads Razorpay Checkout.js, and the verify webhook + GET /verify
// endpoint confirm the payment matches the order.

import { createHmac } from "node:crypto";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

// We DON'T read env at module-init because env validation may not have
// run yet in some test paths; we read on-demand.
function razorpayCreds(): { keyId: string; secret: string } | null {
  // env is typed via Zod; cast through unknown to pick up optional keys.
  const e = env as unknown as Record<string, string | undefined>;
  const keyId = e.RAZORPAY_KEY_ID;
  const secret = e.RAZORPAY_KEY_SECRET;
  if (!keyId || !secret) return null;
  return { keyId, secret };
}

export function isRazorpayConfigured(): boolean {
  return razorpayCreds() !== null;
}

type Result<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string; details?: unknown };

interface RazorpayOrder {
  id: string;
  amount: number;       // in paise
  currency: string;
  status: string;
  receipt: string;
}

// Create a Razorpay order for a pending booking. Amount must be in
// paise (₹1 = 100 paise).
export async function createOrder(args: {
  amount: number;       // INR (rupees)
  currency?: string;
  receipt: string;      // our pending_booking.publicRef
  notes?: Record<string, string>;
}): Promise<Result<RazorpayOrder>> {
  const creds = razorpayCreds();
  if (!creds) return { ok: false, reason: "razorpay_not_configured" };

  const payload = {
    amount: Math.round(args.amount * 100),
    currency: args.currency ?? "INR",
    receipt: args.receipt,
    notes: args.notes ?? {},
  };
  try {
    const auth = Buffer.from(`${creds.keyId}:${creds.secret}`).toString("base64");
    const resp = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const json = (await resp.json()) as RazorpayOrder | { error: { description?: string } };
    if (!resp.ok || "error" in json) {
      logger.warn({ status: resp.status, json }, "razorpay order create failed");
      return {
        ok: false,
        reason: "razorpay_create_order_failed",
        details: json,
      };
    }
    return { ok: true, data: json as RazorpayOrder };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, "razorpay create order threw");
    return { ok: false, reason: "razorpay_network_error" };
  }
}

// Verify the signature returned by Razorpay Checkout. This proves the
// payment was authorized by the Razorpay servers (the signature is
// HMAC-SHA256 of "<order_id>|<payment_id>" using the secret).
export function verifySignature(args: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const creds = razorpayCreds();
  if (!creds) return false;
  const expected = createHmac("sha256", creds.secret)
    .update(`${args.orderId}|${args.paymentId}`)
    .digest("hex");
  return expected === args.signature;
}

// Issue a refund (full or partial) on a captured payment.
export async function refund(args: {
  paymentId: string;
  amount?: number;       // INR rupees; omit for full refund
  notes?: Record<string, string>;
}): Promise<Result<{ id: string; status: string }>> {
  const creds = razorpayCreds();
  if (!creds) return { ok: false, reason: "razorpay_not_configured" };
  const auth = Buffer.from(`${creds.keyId}:${creds.secret}`).toString("base64");
  const body: Record<string, unknown> = {};
  if (args.amount) body.amount = Math.round(args.amount * 100);
  if (args.notes) body.notes = args.notes;
  try {
    const resp = await fetch(
      `https://api.razorpay.com/v1/payments/${args.paymentId}/refund`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    const json = (await resp.json()) as { id: string; status: string } | { error: unknown };
    if (!resp.ok || "error" in json) {
      return { ok: false, reason: "razorpay_refund_failed", details: json };
    }
    return { ok: true, data: json as { id: string; status: string } };
  } catch (err) {
    return { ok: false, reason: "razorpay_network_error" };
  }
}
