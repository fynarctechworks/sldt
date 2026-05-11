import { Router } from "express";
import { z } from "zod";
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
  const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    return fail(res, 401, "INVALID_CREDENTIALS", "Email or password is incorrect");
  }
  return ok(res, {
    user: { id: data.user.id, email: data.user.email },
    token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
  });
});

router.post("/logout", requireAuth, async (_req, res) => {
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
