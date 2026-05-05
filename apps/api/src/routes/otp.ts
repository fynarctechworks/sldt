import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { guests, otps, reservations } from "../db/schema/index.js";
import { logger } from "../lib/logger.js";
import { messaging } from "../lib/messaging.js";
import { expiresAt, generateOtp, hashOtp, maskTarget } from "../lib/otp.js";
import { renderTemplate } from "../lib/templates.js";
import { fail, ok } from "../lib/response.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const router = Router();

const sendSchema = z.object({
  reservationId: z.string().uuid(),
  channel: z.enum(["sms", "email"]),
});

router.post("/send", requireAuth, validate(sendSchema), async (req, res) => {
  const { reservationId, channel } = req.body as z.infer<typeof sendSchema>;

  const [r] = await db.select().from(reservations).where(eq(reservations.id, reservationId)).limit(1);
  if (!r) return fail(res, 404, "NOT_FOUND", "Reservation not found");

  const [g] = await db.select().from(guests).where(eq(guests.id, r.guestId)).limit(1);
  if (!g) return fail(res, 404, "NOT_FOUND", "Guest not found");

  const target = channel === "sms" ? g.phone : g.email;
  if (!target) {
    return fail(res, 400, "NO_TARGET", channel === "sms" ? "Guest has no phone on file" : "Guest has no email on file");
  }

  const recent = await db
    .select({ id: otps.id })
    .from(otps)
    .where(
      and(
        eq(otps.target, target),
        eq(otps.purpose, "checkin"),
        gt(otps.createdAt, sql`now() - interval '1 minute'`),
      ),
    )
    .limit(1);
  if (recent.length > 0) {
    return fail(res, 429, "RATE_LIMITED", "Please wait before requesting a new code");
  }

  const code = generateOtp();
  const [row] = await db
    .insert(otps)
    .values({
      purpose: "checkin",
      channel,
      target,
      codeHash: hashOtp(code),
      reservationId: r.id,
      guestId: g.id,
      expiresAt: expiresAt(),
    })
    .returning({ id: otps.id });

  const otpVars = {
    hotel: env.HOTEL_DISPLAY_NAME,
    otp_code: code,
    otp_minutes: Math.floor(env.OTP_TTL_SECONDS / 60),
  };
  if (channel === "sms") {
    const t = await renderTemplate("otp_guest_sms", otpVars);
    await messaging.sendSms({ to: target, text: t.body });
  } else {
    // Email OTP uses the same body template since there's no separate email template for OTP
    const t = await renderTemplate("otp_guest_sms", otpVars);
    await messaging.sendEmail({
      to: target,
      subject: `${env.HOTEL_DISPLAY_NAME} check-in code: ${code}`,
      text: t.body,
    });
  }

  if (env.NOTIFICATIONS_PROVIDER === "stub") {
    logger.info({ otp: code, target }, "[OTP] generated (stub mode — code returned in response)");
  }

  return ok(res, {
    id: row!.id,
    channel,
    target: maskTarget(target, channel),
    expiresInSeconds: env.OTP_TTL_SECONDS,
    devCode: env.NOTIFICATIONS_PROVIDER === "stub" ? code : undefined,
  });
});

const verifySchema = z.object({
  reservationId: z.string().uuid(),
  code: z.string().min(4).max(8),
});

router.post("/verify", requireAuth, validate(verifySchema), async (req, res) => {
  const { reservationId, code } = req.body as z.infer<typeof verifySchema>;

  const [row] = await db
    .select()
    .from(otps)
    .where(
      and(
        eq(otps.reservationId, reservationId),
        eq(otps.purpose, "checkin"),
        isNull(otps.consumedAt),
      ),
    )
    .orderBy(sql`${otps.createdAt} desc`)
    .limit(1);

  if (!row) return fail(res, 404, "NO_OTP", "No active OTP for this reservation");
  if (row.expiresAt < new Date()) return fail(res, 400, "EXPIRED", "OTP has expired, request a new one");
  if (row.attempts >= env.OTP_MAX_ATTEMPTS) {
    return fail(res, 429, "TOO_MANY_ATTEMPTS", "Too many wrong attempts, request a new OTP");
  }

  if (row.codeHash !== hashOtp(code)) {
    await db.update(otps).set({ attempts: row.attempts + 1 }).where(eq(otps.id, row.id));
    return fail(res, 400, "INVALID_CODE", "Incorrect code");
  }

  await db.update(otps).set({ consumedAt: new Date() }).where(eq(otps.id, row.id));

  return ok(res, { verified: true, reservationId, verifiedAt: new Date().toISOString() });
});

export default router;
