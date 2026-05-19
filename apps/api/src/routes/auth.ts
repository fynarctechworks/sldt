import { Router } from "express";
import { z } from "zod";
import { logger } from "../lib/logger.js";
import {
  checkLockout,
  recordFailure,
  recordSuccess,
} from "../lib/loginLockout.js";
import { supabaseAdmin } from "../lib/supabase.js";
import { fail, ok } from "../lib/response.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/login", validate(loginSchema), async (req, res) => {
  const { email, password } = req.body as z.infer<typeof loginSchema>;
  const clientIp = req.ip ?? "unknown";

  // Account-level lockout. Refuses BEFORE calling Supabase so a locked
  // account can't even consume our outbound auth budget. The message is
  // intentionally vague so an attacker can't use the lock state as an
  // oracle to confirm which emails exist.
  const lockedMsRemaining = checkLockout(email);
  if (lockedMsRemaining > 0) {
    logger.warn(
      { email, ip: clientIp, lockedMsRemaining },
      "login rejected: account temporarily locked",
    );
    return fail(
      res,
      401,
      "INVALID_CREDENTIALS",
      "Email or password is incorrect",
    );
  }

  const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    const tripped = recordFailure(email, clientIp);
    logger.warn(
      { email, ip: clientIp, reason: error?.message ?? "no_session", lockTripped: tripped },
      "login failed",
    );
    return fail(res, 401, "INVALID_CREDENTIALS", "Email or password is incorrect");
  }
  recordSuccess(email);
  logger.info({ userId: data.user.id, email, ip: clientIp }, "login succeeded");
  return ok(res, {
    user: { id: data.user.id, email: data.user.email },
    token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
  });
});

router.post("/logout", requireAuth, async (req, res) => {
  // Revoke every active session for this user across all devices.
  // Supabase admin signOut takes the user's JWT (not the user id).
  const header = req.header("authorization") ?? req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  try {
    if (token) await supabaseAdmin.auth.admin.signOut(token, "global");
  } catch (err) {
    logger.warn({ err, userId: req.user!.id }, "global sign-out failed");
  }
  return ok(res, { success: true });
});

router.get("/me", requireAuth, async (req, res) => {
  const u = req.user!;
  return ok(res, {
    profile: {
      id: u.id,
      email: u.email,
      role: u.role,
      fullName: u.fullName,
      rbacRoleKey: u.rbacRoleKey,
      isGodMode: u.isGodMode,
      permissions: Array.from(u.permissions),
    },
  });
});

export default router;
