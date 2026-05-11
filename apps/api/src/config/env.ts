import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),

  DATABASE_URL: z.string().url(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPABASE_JWT_SECRET: z.string().min(20),

  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(10),
  UPSTASH_REDIS_URL: z.string().min(10),

  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "ENCRYPTION_KEY must be 64-char hex (32 bytes)"),

  FRONTEND_URL: z.string().url().default("http://localhost:5173"),

  SEED_ADMIN_EMAIL: z.string().email().default("admin@hoteldesk.local"),
  SEED_ADMIN_PASSWORD: z.string().min(8).default("ChangeMe123!"),
  SEED_ADMIN_NAME: z.string().default("Hotel Owner"),

  NOTIFICATIONS_PROVIDER: z.enum(["stub", "live"]).default("stub"),
  HOTEL_DISPLAY_NAME: z.string().default("SLDT Stay Inn"),

  TWILIO_ACCOUNT_SID: z.string().optional().transform((v) => (v === "" ? undefined : v)),
  TWILIO_AUTH_TOKEN: z.string().optional().transform((v) => (v === "" ? undefined : v)),
  TWILIO_WHATSAPP_FROM: z.string().optional().transform((v) => (v === "" ? undefined : v)),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional().transform((v) => (v === "" ? undefined : v)),

  OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
  OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(1800).default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
