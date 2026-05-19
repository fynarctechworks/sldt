import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "migrations");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

try {
  // Bootstrap the ledger table itself (it's also in 0001_baseline.sql, but we
  // need it before we can check what's applied).
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const appliedRows = await sql`SELECT name FROM schema_migrations`;
  const applied = new Set(appliedRows.map((r) => r.name));

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`= ${file} (already applied)`);
      continue;
    }
    const body = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    console.log(`→ ${file}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });
    ran++;
  }

  console.log(ran === 0 ? "Nothing to apply." : `Applied ${ran} migration(s).`);
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
