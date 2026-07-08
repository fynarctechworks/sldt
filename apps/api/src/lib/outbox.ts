import { and, eq, lte, sql } from "drizzle-orm";

import { db } from "../db/client.js";
import { messageOutbox } from "../db/schema/messageOutbox.js";
import { logger } from "./logger.js";
import type { EmailMessage, SmsMessage } from "./messaging.js";

// Offline message outbox: enqueue + connectivity-gated drainer.
//
// In offline mode, messaging.sendSms/sendEmail call enqueue() and return
// immediately. A background loop (startOutboxDrainer) attempts delivery via the
// VPS send-proxy whenever the desk has connectivity, with exponential backoff
// on failure. Delivery credentials (Twilio/Resend) live on the VPS, never on
// the desk — the drainer only holds a per-device send token.

const MAX_ATTEMPTS = 12;
const BASE_BACKOFF_MS = 30 * 1000; // 30s, doubling up to ~a few hours

/** Enqueue a message for later delivery. Returns immediately. */
export async function enqueueMessage(
  channel: "sms" | "email",
  recipient: string,
  payload: SmsMessage | EmailMessage,
): Promise<void> {
  // Strip binary attachments from the stored payload — they'd bloat the row and
  // aren't serializable. Email attachments (PDFs) are re-fetched from local
  // storage by path at drain time when needed. For now we drop them; the
  // guest still gets the on-screen/printed copy offline.
  const safePayload: Record<string, unknown> = { ...payload };
  if ("attachments" in safePayload) delete safePayload.attachments;

  await db.insert(messageOutbox).values({
    channel,
    recipient,
    payload: JSON.stringify(safePayload),
  });
  logger.debug({ channel, recipient }, "message enqueued (offline)");
}

/** Count of undelivered messages — surfaced in the UI's offline banner. */
export async function pendingMessageCount(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messageOutbox)
    .where(eq(messageOutbox.status, "pending"));
  return row?.n ?? 0;
}

// The delivery transport. Wired to the VPS proxy in Phase 2; for Phase 1 this
// is injectable so tests and the eventual proxy client both plug in here.
export type OutboxDeliverer = (
  channel: "sms" | "email",
  recipient: string,
  payload: unknown,
) => Promise<{ ok: boolean; error?: string }>;

// Default: no proxy configured yet → report "no connectivity" so rows stay
// queued (never silently dropped). Task/Phase 2 replaces this with the VPS
// proxy client.
let deliverer: OutboxDeliverer = async () => ({ ok: false, error: "delivery proxy not configured" });

export function setOutboxDeliverer(fn: OutboxDeliverer): void {
  deliverer = fn;
}

/** Attempt to deliver all due pending messages once. Returns #delivered. */
export async function drainOnce(now = new Date()): Promise<number> {
  const due = await db
    .select()
    .from(messageOutbox)
    .where(and(eq(messageOutbox.status, "pending"), lte(messageOutbox.nextAttemptAt, now)))
    .limit(50);

  let delivered = 0;
  for (const row of due) {
    let payload: unknown;
    try {
      payload = JSON.parse(row.payload);
    } catch {
      await db
        .update(messageOutbox)
        .set({ status: "failed", lastError: "unparseable payload" })
        .where(eq(messageOutbox.id, row.id));
      continue;
    }

    const result = await deliverer(row.channel, row.recipient, payload);
    if (result.ok) {
      await db
        .update(messageOutbox)
        .set({ status: "sent", sentAt: new Date(), lastError: null })
        .where(eq(messageOutbox.id, row.id));
      delivered++;
    } else {
      const attempts = row.attempts + 1;
      const backoff = Math.min(BASE_BACKOFF_MS * 2 ** row.attempts, 4 * 60 * 60 * 1000);
      const status = attempts >= MAX_ATTEMPTS ? "failed" : "pending";
      await db
        .update(messageOutbox)
        .set({
          attempts,
          status,
          lastError: result.error ?? "delivery failed",
          nextAttemptAt: new Date(now.getTime() + backoff),
        })
        .where(eq(messageOutbox.id, row.id));
    }
  }
  return delivered;
}

let timer: NodeJS.Timeout | null = null;

/** Start the periodic drainer. No-op if already running. */
export function startOutboxDrainer(intervalMs = 60 * 1000): void {
  if (timer) return;
  timer = setInterval(() => {
    drainOnce().catch((err) =>
      logger.debug({ err: err instanceof Error ? err.message : err }, "outbox drain tick failed"),
    );
  }, intervalMs);
  // Don't keep the process alive just for the drainer.
  timer.unref?.();
  logger.info("message outbox drainer started");
}

export function stopOutboxDrainer(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
