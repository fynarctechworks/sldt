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

// Mask sequences that look like OTP codes (4-8 contiguous digits) so the
// stub log doesn't leak codes. Other meaningful content stays readable
// for development.
function redactOtpFromText(text: string): string {
  return text.replace(/\b\d{4,8}\b/g, "******");
}

// Mask the middle of a phone or email so log diagnostics still tie back to
// the right guest but the full identifier doesn't sit in plaintext.
function maskRecipient(to: string): string {
  if (to.includes("@")) {
    const [user, domain] = to.split("@");
    if (!user || !domain) return "***@***";
    return `${user.slice(0, 2)}***@${domain}`;
  }
  const digits = to.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***${digits.slice(-4)}`;
}

async function sendWhatsAppStub(msg: SmsMessage): Promise<SendResult> {
  // Stub mode is for local development. We log a masked recipient + a
  // redacted preview of the body so a developer can confirm a message
  // was triggered without seeing the OTP or the full guest contact.
  logger.info(
    {
      provider: "stub",
      to: maskRecipient(msg.to),
      preview: redactOtpFromText(msg.text).slice(0, 200),
    },
    "[WHATSAPP STUB]",
  );
  return { ok: true, provider: "stub", id: `stub-${Date.now()}` };
}

async function sendEmailStub(_msg: EmailMessage): Promise<SendResult> {
  // Email channel disabled — WhatsApp-only deployment via Twilio.
  return { ok: true, provider: "disabled", id: "skipped" };
}

function normalizeIndianNumber(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  if (raw.startsWith("+")) return raw;
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  return `+${digits}`;
}

function withWhatsAppPrefix(e164: string): string {
  return e164.startsWith("whatsapp:") ? e164 : `whatsapp:${e164}`;
}

async function sendWhatsAppLive(msg: SmsMessage): Promise<SendResult> {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    logger.warn("Twilio not configured, falling back to stub");
    return sendWhatsAppStub(msg);
  }
  if (!env.TWILIO_WHATSAPP_FROM && !env.TWILIO_MESSAGING_SERVICE_SID) {
    logger.warn(
      "Twilio: set TWILIO_WHATSAPP_FROM (e.g. +14155238886) or TWILIO_MESSAGING_SERVICE_SID, falling back to stub",
    );
    return sendWhatsAppStub(msg);
  }
  try {
    const to = withWhatsAppPrefix(normalizeIndianNumber(msg.to));
    const params = new URLSearchParams();
    params.set("To", to);
    params.set("Body", msg.text);
    if (env.TWILIO_MESSAGING_SERVICE_SID) {
      params.set("MessagingServiceSid", env.TWILIO_MESSAGING_SERVICE_SID);
    } else if (env.TWILIO_WHATSAPP_FROM) {
      params.set("From", withWhatsAppPrefix(env.TWILIO_WHATSAPP_FROM));
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
      error_code?: number;
      error_message?: string;
    };
    logger.info(
      {
        to: maskRecipient(to.replace("whatsapp:", "")),
        httpStatus: res.status,
        twilioStatus: json.status,
        sid: json.sid,
        errorCode: json.error_code ?? json.code,
        errorMessage: json.error_message ?? json.message,
      },
      "[twilio whatsapp] response",
    );
    if (!res.ok) {
      return {
        ok: false,
        provider: "twilio_whatsapp",
        error: json.message ?? `HTTP ${res.status}${json.code ? ` (code ${json.code})` : ""}`,
      };
    }
    // Twilio may return 201 with status=failed/undelivered when sandbox recipient hasn't joined
    if (json.status === "failed" || json.status === "undelivered") {
      return {
        ok: false,
        provider: "twilio_whatsapp",
        error: json.error_message ?? `Twilio reports ${json.status}. If using sandbox, recipient must first send "join <keyword>" to ${env.TWILIO_WHATSAPP_FROM}.`,
      };
    }
    return { ok: true, provider: "twilio_whatsapp", id: json.sid };
  } catch (err) {
    return {
      ok: false,
      provider: "twilio_whatsapp",
      error: err instanceof Error ? err.message : "unknown",
    };
  }
}

export const messaging = {
  // Sends via Twilio WhatsApp Business API (or stub in dev mode).
  // Kept the name `sendSms` for backwards-compat with existing call sites.
  sendSms(msg: SmsMessage): Promise<SendResult> {
    return env.NOTIFICATIONS_PROVIDER === "live" ? sendWhatsAppLive(msg) : sendWhatsAppStub(msg);
  },
  // Email channel is intentionally disabled — WhatsApp-only deployment.
  sendEmail(msg: EmailMessage): Promise<SendResult> {
    return sendEmailStub(msg);
  },
};
