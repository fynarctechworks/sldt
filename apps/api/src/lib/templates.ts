import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { messageTemplates, type TemplateKey } from "../db/schema/messageTemplates.js";
import { logger } from "./logger.js";

export interface TemplateDefault {
  subject?: string;
  body: string;
}

export const TEMPLATE_DEFAULTS: Record<TemplateKey, TemplateDefault> = {
  booking_created_guest_sms: {
    body:
      "{hotel}: Booking {reservation_number} confirmed for {check_in_date}. We look forward to your stay.",
  },
  booking_created_guest_email: {
    subject: "Booking confirmed: {reservation_number}",
    body:
      "Dear {guest_name},\n\nYour booking at {hotel} is confirmed.\n\nReference: {reservation_number}\nCheck-in: {check_in_date}\nCheck-out: {check_out_date}\nTotal: ₹{total}\n\nWe look forward to hosting you.\n\n— {hotel}",
  },
  booking_created_owner_sms: {
    body:
      "New booking {reservation_number}: {guest_name} ({guest_phone}), {check_in_date} to {check_out_date}, ₹{total}",
  },
  checkin_guest_sms: {
    body:
      "{hotel}: Welcome! Check-in confirmed for {reservation_number}. Enjoy your stay.",
  },
  checkin_guest_email: {
    subject: "Welcome to {hotel} — {reservation_number}",
    body:
      "Dear {guest_name},\n\nWelcome to {hotel}.\nYour check-in for {reservation_number} is confirmed.\nCheck-out: {check_out_date}.\n\nIf you need anything during your stay, please reach out at the front desk.\n\n— {hotel}",
  },
  checkin_owner_sms: {
    body: "Checked in: {guest_name} ({guest_phone}), {reservation_number}",
  },
  checkout_guest_sms: {
    body:
      "{hotel}: Thank you for staying with us. Invoice {invoice_number} has been generated.",
  },
  checkout_guest_email: {
    subject: "Invoice {invoice_number} from {hotel}",
    body:
      "Dear {guest_name},\n\nThank you for staying at {hotel}.\nInvoice {invoice_number} has been issued for {reservation_number}.\nThe invoice is attached as a PDF.\n\nWe hope to see you again.\n\n— {hotel}",
  },
  checkout_owner_sms: {
    body: "Checked out: {guest_name}, {reservation_number}. Invoice {invoice_number}.",
  },
  otp_guest_sms: {
    body:
      "{hotel}: Your check-in OTP is {otp_code}. Valid for {otp_minutes} minutes. Do not share.",
  },
};

export const TEMPLATE_VARS: Record<TemplateKey, readonly string[]> = {
  booking_created_guest_sms: ["hotel", "guest_name", "reservation_number", "check_in_date", "check_out_date", "total"],
  booking_created_guest_email: ["hotel", "guest_name", "guest_phone", "reservation_number", "check_in_date", "check_out_date", "nights", "total", "advance_paid", "balance"],
  booking_created_owner_sms: ["hotel", "guest_name", "guest_phone", "reservation_number", "check_in_date", "check_out_date", "total"],
  checkin_guest_sms: ["hotel", "guest_name", "reservation_number", "check_out_date"],
  checkin_guest_email: ["hotel", "guest_name", "reservation_number", "check_out_date", "room_numbers"],
  checkin_owner_sms: ["hotel", "guest_name", "guest_phone", "reservation_number", "room_numbers"],
  checkout_guest_sms: ["hotel", "guest_name", "reservation_number", "invoice_number", "total"],
  checkout_guest_email: ["hotel", "guest_name", "reservation_number", "invoice_number", "total"],
  checkout_owner_sms: ["hotel", "guest_name", "reservation_number", "invoice_number", "total"],
  otp_guest_sms: ["hotel", "otp_code", "otp_minutes"],
};

export const TEMPLATE_LABELS: Record<TemplateKey, { group: string; label: string; channel: "sms" | "email"; recipient: "guest" | "owner" }> = {
  booking_created_guest_sms: { group: "Booking confirmed", label: "SMS to guest", channel: "sms", recipient: "guest" },
  booking_created_guest_email: { group: "Booking confirmed", label: "Email to guest", channel: "email", recipient: "guest" },
  booking_created_owner_sms: { group: "Booking confirmed", label: "SMS to owner", channel: "sms", recipient: "owner" },
  checkin_guest_sms: { group: "Check-in", label: "SMS to guest", channel: "sms", recipient: "guest" },
  checkin_guest_email: { group: "Check-in", label: "Email to guest", channel: "email", recipient: "guest" },
  checkin_owner_sms: { group: "Check-in", label: "SMS to owner", channel: "sms", recipient: "owner" },
  checkout_guest_sms: { group: "Check-out", label: "SMS to guest", channel: "sms", recipient: "guest" },
  checkout_guest_email: { group: "Check-out", label: "Email to guest", channel: "email", recipient: "guest" },
  checkout_owner_sms: { group: "Check-out", label: "SMS to owner", channel: "sms", recipient: "owner" },
  otp_guest_sms: { group: "OTP verification", label: "SMS to guest", channel: "sms", recipient: "guest" },
};

const cache = new Map<TemplateKey, { subject?: string | null; body: string; enabled: boolean }>();
let cacheLoadedAt = 0;
const TTL = 60_000;

async function loadCache() {
  if (cache.size > 0 && Date.now() - cacheLoadedAt < TTL) return;
  cache.clear();
  const rows = await db.select().from(messageTemplates);
  for (const row of rows) {
    cache.set(row.key as TemplateKey, {
      subject: row.subject,
      body: row.body,
      enabled: row.enabled,
    });
  }
  cacheLoadedAt = Date.now();
}

export function invalidateTemplateCache() {
  cache.clear();
  cacheLoadedAt = 0;
}

function fillVars(text: string, vars: Record<string, string | number | null | undefined>): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = vars[key];
    if (v === null || v === undefined) return "";
    return String(v);
  });
}

export interface RenderResult {
  enabled: boolean;
  subject?: string;
  body: string;
}

export async function renderTemplate(
  key: TemplateKey,
  vars: Record<string, string | number | null | undefined>,
): Promise<RenderResult> {
  try {
    await loadCache();
  } catch (err) {
    logger.warn({ err }, "template cache load failed; using defaults");
  }
  const row = cache.get(key);
  const def = TEMPLATE_DEFAULTS[key];
  const subjectTpl = row?.subject ?? def.subject;
  const bodyTpl = row?.body ?? def.body;
  const enabled = row?.enabled ?? true;
  return {
    enabled,
    subject: subjectTpl ? fillVars(subjectTpl, vars) : undefined,
    body: fillVars(bodyTpl, vars),
  };
}

export async function getAllTemplatesForUI(): Promise<
  {
    key: TemplateKey;
    group: string;
    label: string;
    channel: "sms" | "email";
    recipient: "guest" | "owner";
    subject: string | null;
    body: string;
    enabled: boolean;
    defaults: TemplateDefault;
    availableVars: readonly string[];
  }[]
> {
  await loadCache();
  return (Object.keys(TEMPLATE_DEFAULTS) as TemplateKey[]).map((key) => {
    const row = cache.get(key);
    const def = TEMPLATE_DEFAULTS[key];
    const meta = TEMPLATE_LABELS[key];
    return {
      key,
      ...meta,
      subject: row?.subject ?? def.subject ?? null,
      body: row?.body ?? def.body,
      enabled: row?.enabled ?? true,
      defaults: def,
      availableVars: TEMPLATE_VARS[key],
    };
  });
}

export async function upsertTemplate(
  key: TemplateKey,
  patch: { subject?: string | null; body?: string; enabled?: boolean },
): Promise<void> {
  // Try update first
  const existing = await db.select().from(messageTemplates).where(eq(messageTemplates.key, key)).limit(1);
  if (existing.length > 0) {
    await db
      .update(messageTemplates)
      .set({
        ...(patch.subject !== undefined ? { subject: patch.subject } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        updatedAt: new Date(),
      })
      .where(eq(messageTemplates.key, key));
  } else {
    const def = TEMPLATE_DEFAULTS[key];
    await db.insert(messageTemplates).values({
      key,
      subject: patch.subject ?? def.subject ?? null,
      body: patch.body ?? def.body,
      enabled: patch.enabled ?? true,
    });
  }
  invalidateTemplateCache();
}
