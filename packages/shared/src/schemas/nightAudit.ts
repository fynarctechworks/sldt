import { z } from "zod";

export const nightAuditRunRequestSchema = z.object({
  // ISO date. Defaults to "yesterday in property TZ" if omitted —
  // resolved server-side so the client doesn't have to know the TZ.
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // When true, allow overwriting an existing row for that date. Default
  // false so accidental re-runs are visible as a 409.
  force: z.boolean().default(false),
});

export const nightAuditListQuerySchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(366).default(30),
});

export type NightAuditRunRequest = z.infer<typeof nightAuditRunRequestSchema>;
export type NightAuditListQuery = z.infer<typeof nightAuditListQuerySchema>;
