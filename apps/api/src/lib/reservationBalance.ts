// Single source of truth for a reservation's balanceDue + advancePaid.
//
// Why this exists:
// Historically every payment-event code path computed and wrote
// reservations.balanceDue inline. With multi-invoice bookings (per-room,
// combined + per-room, late-issued invoices) those inline writes started
// to drift — e.g. setting reservation balance = one invoice's balance
// silently zeroed out the other invoice's debt. The fix is to never
// write the balance inline; always recompute from the authoritative
// payment + charge facts and write that one number.
//
// The maths:
//   balanceDue   = max(0, grandTotal - sumOfReceivedPayments - walletCreditApplied)
//   advancePaid  = sumOfReceivedPayments (kept for legacy fields; UI
//                  treats grandTotal − balanceDue as "paid")
//
// Pending and voided payments do NOT count. Wallet credit is treated as
// money applied to the bill (matches how it's recorded at booking).
//
// Callers MUST pass a transaction (or the db client when not inside one)
// so the recompute runs against the same snapshot as the payment write
// it follows.

import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { invoices, payments } from "../db/schema/invoices.js";
import { reservations } from "../db/schema/reservations.js";

type Tx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface RecomputedBalance {
  grandTotal: number;
  sumReceivedPayments: number;
  walletCreditApplied: number;
  balanceDue: number;
}

// Recompute and persist reservations.balanceDue + advancePaid from facts.
// Returns the new numbers so callers can use them in the same response
// (e.g. to surface "paid in full" to the UI immediately).
export async function recomputeReservationBalance(
  tx: Tx,
  reservationId: string,
): Promise<RecomputedBalance> {
  const [r] = await tx
    .select({
      grandTotal: reservations.grandTotal,
      walletCreditApplied: reservations.walletCreditApplied,
    })
    .from(reservations)
    .where(eq(reservations.id, reservationId))
    .limit(1);
  if (!r) {
    throw new Error(`recomputeReservationBalance: reservation ${reservationId} not found`);
  }

  // Sum every non-voided, "received" payment on this reservation. Pending
  // payments (promises to pay) and voided rows are excluded.
  const [paid] = await tx
    .select({
      total: sql<string>`COALESCE(SUM(${payments.amount}), 0)::text`,
    })
    .from(payments)
    .where(
      and(
        eq(payments.reservationId, reservationId),
        eq(payments.voided, false),
        eq(payments.status, "received"),
      ),
    );

  const grandTotal = Number(r.grandTotal);
  const walletCreditApplied = Number(r.walletCreditApplied ?? 0);
  const sumReceivedPayments = Number(paid?.total ?? 0);
  const balanceDue = +Math.max(
    0,
    grandTotal - sumReceivedPayments - walletCreditApplied,
  ).toFixed(2);

  await tx
    .update(reservations)
    .set({
      // advancePaid carries the historical name but, post-rework, it is
      // simply "money received for this booking so far". Legacy reads
      // that subtract it from grandTotal still get the right answer.
      advancePaid: sumReceivedPayments.toFixed(2),
      balanceDue: balanceDue.toFixed(2),
      updatedAt: new Date(),
    })
    .where(eq(reservations.id, reservationId));

  return {
    grandTotal,
    sumReceivedPayments,
    walletCreditApplied,
    balanceDue,
  };
}

// Recompute every invoice on a reservation from the payments attached to
// it. Used after an orphan payment is re-linked, or after a void, to
// keep invoices.totalPaid / balanceDue / status honest.
export async function recomputeInvoiceTotals(
  tx: Tx,
  reservationId: string,
): Promise<void> {
  const invs = await tx
    .select({
      id: invoices.id,
      grandTotal: invoices.grandTotal,
      walletCreditApplied: invoices.walletCreditApplied,
      status: invoices.status,
    })
    .from(invoices)
    .where(eq(invoices.reservationId, reservationId));

  for (const inv of invs) {
    if (inv.status === "voided") continue;
    const [paid] = await tx
      .select({
        total: sql<string>`COALESCE(SUM(${payments.amount}), 0)::text`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.invoiceId, inv.id),
          eq(payments.voided, false),
          eq(payments.status, "received"),
        ),
      );
    const grand = Number(inv.grandTotal);
    const wallet = Number(inv.walletCreditApplied ?? 0);
    const collected = Number(paid?.total ?? 0) + wallet;
    const balance = +Math.max(0, grand - collected).toFixed(2);
    const status =
      balance <= 0.009 ? "paid" : collected > 0 ? "partial" : "issued";
    await tx
      .update(invoices)
      .set({
        totalPaid: collected.toFixed(2),
        balanceDue: balance.toFixed(2),
        status,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, inv.id));
  }
}

// Convenience wrapper: re-link any orphan (invoiceId IS NULL) payments
// on a reservation to a specific invoice, then recompute both invoice
// totals and reservation balance. Used at invoice-issue time so an
// advance collected before the invoice existed (the "Collected at
// check-out of SLDT-RES-XXXX" flow) lands on the right ledger.
export async function attachOrphanPaymentsAndRecompute(
  tx: Tx,
  reservationId: string,
  attachToInvoiceId: string,
): Promise<void> {
  await tx
    .update(payments)
    .set({ invoiceId: attachToInvoiceId })
    .where(
      and(
        eq(payments.reservationId, reservationId),
        sql`${payments.invoiceId} IS NULL`,
      ),
    );
  await recomputeInvoiceTotals(tx, reservationId);
  await recomputeReservationBalance(tx, reservationId);
}
