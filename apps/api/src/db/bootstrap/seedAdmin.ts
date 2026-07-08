import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { env } from "../../config/env.js";
import { db } from "../client.js";
import { hashSecret } from "../../lib/localAuth.js";
import { logger } from "../../lib/logger.js";
import { localCredentials } from "../schema/localCredentials.js";
import { profiles } from "../schema/profiles.js";

// Ensure a fresh offline desk has an admin to log in with. A brand-new
// embedded cluster has zero profiles, so without this there's no way in. We
// create ONE admin with a default PIN the operator must change on first login.
//
// Idempotent: if any profile already exists, this is a no-op (a backfilled or
// previously-seeded desk keeps its real users).
//
// Defaults come from env (SEED_ADMIN_EMAIL/NAME + a fixed first-run PIN); the
// operator is expected to change the PIN immediately via Settings.
const DEFAULT_PIN = "424242";

export async function ensureOfflineAdmin(): Promise<void> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(profiles);
  if ((rows[0]?.n ?? 0) > 0) {
    logger.info("offline admin seed skipped — profiles already exist");
    return;
  }

  const id = randomUUID();
  const email = env.SEED_ADMIN_EMAIL;
  const fullName = env.SEED_ADMIN_NAME;

  await db.insert(profiles).values({
    id,
    email,
    fullName,
    role: "admin",
    isActive: true,
  });
  await db
    .insert(localCredentials)
    .values({ profileId: id, pinHash: hashSecret(DEFAULT_PIN) })
    .onConflictDoUpdate({
      target: localCredentials.profileId,
      set: { pinHash: hashSecret(DEFAULT_PIN), updatedAt: new Date() },
    });

  // Grant god-mode admin via RBAC if the schema has the wiring; ignore if the
  // legacy role column alone is sufficient (the admin role already implies
  // full access in requirePermission via isGodMode from the resolver).
  logger.warn(
    { email, pin: DEFAULT_PIN },
    "seeded first-run offline admin — CHANGE THE PIN on first login",
  );

  // Best-effort: make sure any RBAC default admin role assignment exists.
  await ensureAdminRbac(id).catch((err) =>
    logger.debug({ err: err instanceof Error ? err.message : err }, "admin rbac seed skipped"),
  );
}

// Assign the admin RBAC role if the rbac tables exist and have an admin role.
async function ensureAdminRbac(profileId: string): Promise<void> {
  // Resolve the admin role key -> id and insert a user_roles row. Uses raw SQL
  // so a schema without these tables just throws and is swallowed above.
  const rows = await db.execute<{ id: string }>(sql`
    SELECT id FROM roles WHERE key = 'admin' LIMIT 1
  `);
  const roleId = (rows as unknown as Array<{ id: string }>)[0]?.id;
  if (!roleId) return;
  await db.execute(sql`
    INSERT INTO user_roles (profile_id, role_id)
    VALUES (${profileId}, ${roleId})
    ON CONFLICT DO NOTHING
  `);
}
