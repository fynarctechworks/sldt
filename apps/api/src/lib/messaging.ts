import { env } from "../config/env.js";
import { logger } from "./logger.js";

export interface SmsMessage {
  to: string;
  text: string;
  templateId?: string;
  variables?: Record<string, string>;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
}

export interface SendResult {
  ok: boolean;
  provider: string;
  id?: string;
  error?: string;
}

async function sendSmsStub(msg: SmsMessage): Promise<SendResult> {
  logger.info({ provider: "stub", to: msg.to, text: msg.text }, "[SMS STUB]");
  return { ok: true, provider: "stub", id: `stub-${Date.now()}` };
}

async function sendEmailStub(_msg: EmailMessage): Promise<SendResult> {
  // Email channel disabled — SMS-only deployment via Twilio.
  return { ok: true, provider: "disabled", id: "skipped" };
}

function normalizeIndianNumber(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  // already E.164-ish (10 digits with country code)
  if (raw.startsWith("+")) return raw;
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  return `+${digits}`;
}

async function sendSmsLive(msg: SmsMessage): Promise<SendResult> {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    logger.warn("Twilio not configured, falling back to stub");
    return sendSmsStub(msg);
  }
  if (!env.TWILIO_FROM_NUMBER && !env.TWILIO_MESSAGING_SERVICE_SID) {
    logger.warn("Twilio: set TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID, falling back to stub");
    return sendSmsStub(msg);
  }
  try {
    const to = normalizeIndianNumber(msg.to);
    const params = new URLSearchParams();
    params.set("To", to);
    params.set("Body", msg.text);
    if (env.TWILIO_MESSAGING_SERVICE_SID) {
      params.set("MessagingServiceSid", env.TWILIO_MESSAGING_SERVICE_SID);
    } else if (env.TWILIO_FROM_NUMBER) {
      params.set("From", env.TWILIO_FROM_NUMBER);
    }

    const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${auth}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      sid?: string;
      status?: string;
      message?: string;
      code?: number;
    };
    if (!res.ok) {
      return {
        ok: false,
        provider: "twilio",
        error: json.message ?? `HTTP ${res.status}${json.code ? ` (code ${json.code})` : ""}`,
      };
    }
    return { ok: true, provider: "twilio", id: json.sid };
  } catch (err) {
    return { ok: false, provider: "twilio", error: err instanceof Error ? err.message : "unknown" };
  }
}

export const messaging = {
  sendSms(msg: SmsMessage): Promise<SendResult> {
    return env.NOTIFICATIONS_PROVIDER === "live" ? sendSmsLive(msg) : sendSmsStub(msg);
  },
  // Email channel is intentionally disabled — SMS-only deployment via Twilio.
  sendEmail(msg: EmailMessage): Promise<SendResult> {
    return sendEmailStub(msg);
  },
};
