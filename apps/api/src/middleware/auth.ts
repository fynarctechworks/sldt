import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { db } from "../db/client.js";
import type { Role } from "../db/schema/enums.js";
import { profiles } from "../db/schema/profiles.js";
import { supabaseAdmin } from "../lib/supabase.js";
import { fail } from "../lib/response.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: {
      id: string;
      email: string;
      role: Role;
      fullName: string;
    };
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization") ?? req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return fail(res, 401, "UNAUTHENTICATED", "Missing or malformed Authorization header");
  }
  const token = header.slice("Bearer ".length).trim();

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    return fail(res, 401, "INVALID_TOKEN", "Token is invalid or expired");
  }

  const profile = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, data.user.id))
    .limit(1);

  if (profile.length === 0) {
    return fail(res, 403, "NO_PROFILE", "User has no associated profile");
  }
  if (!profile[0]!.isActive) {
    return fail(res, 403, "INACTIVE_USER", "Account is deactivated");
  }

  req.user = {
    id: profile[0]!.id,
    email: profile[0]!.email,
    role: profile[0]!.role,
    fullName: profile[0]!.fullName,
  };
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return fail(res, 401, "UNAUTHENTICATED", "Not authenticated");
    if (!roles.includes(req.user.role)) {
      return fail(res, 403, "FORBIDDEN", `Requires role: ${roles.join(" or ")}`);
    }
    next();
  };
}

export const requireAdmin = requireRole("admin");
