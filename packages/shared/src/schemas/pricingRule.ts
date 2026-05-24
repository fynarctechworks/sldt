import { z } from "zod";

export const PRICING_RULE_KINDS = [
  "occupancy_threshold",
  "length_of_stay",
  "advance_purchase",
  "day_of_week",
  "season",
  "manual",
] as const;
export type PricingRuleKind = (typeof PRICING_RULE_KINDS)[number];

export const PRICING_ADJUSTMENT_TYPES = ["multiplier", "flat"] as const;
export type PricingAdjustmentType = (typeof PRICING_ADJUSTMENT_TYPES)[number];

// Kind-specific condition shapes. The DB accepts any jsonb, but we
// validate here so the UI can keep its forms typed and the engine can
// trust the rows it reads.
const conditionSchemas = {
  occupancy_threshold: z.object({ min_pct: z.number().min(0).max(100) }),
  length_of_stay: z.object({
    min_nights: z.number().int().min(1).max(365).optional(),
    max_nights: z.number().int().min(1).max(365).optional(),
  }),
  advance_purchase: z.object({ min_days_ahead: z.number().int().min(0).max(365) }),
  day_of_week: z.object({
    // 0 = Sunday … 6 = Saturday.
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  }),
  season: z.object({
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  manual: z.object({}).catchall(z.unknown()),
};

export const pricingRuleCreateSchema = z
  .object({
    code: z.string().min(2).max(40).regex(/^[A-Z0-9_-]+$/i),
    name: z.string().min(2).max(120),
    description: z.string().max(500).nullable().optional(),
    kind: z.enum(PRICING_RULE_KINDS),
    condition: z.record(z.string(), z.unknown()).default({}),
    adjustmentType: z.enum(PRICING_ADJUSTMENT_TYPES),
    adjustmentValue: z.coerce.number(),
    priority: z.coerce.number().int().min(0).max(9999).default(100),
    stopAfter: z.boolean().default(false),
    appliesToRatePlanId: z.string().uuid().nullable().optional(),
    appliesToRoomType: z.string().min(1).max(60).nullable().optional(),
    isActive: z.boolean().default(true),
    startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  })
  .superRefine((val, ctx) => {
    // Multiplier must be positive; flat can be negative (discount).
    if (val.adjustmentType === "multiplier" && (val.adjustmentValue <= 0 || val.adjustmentValue > 10)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["adjustmentValue"],
        message: "multiplier must be > 0 and <= 10",
      });
    }
    // Validate kind-specific condition shape.
    const schema = conditionSchemas[val.kind];
    const parsed = schema.safeParse(val.condition);
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["condition"],
        message: `condition for kind=${val.kind} is invalid: ${parsed.error.message}`,
      });
    }
  });

export const pricingRuleUpdateSchema = pricingRuleCreateSchema._def.schema.partial();

export type PricingRuleCreateInput = z.infer<typeof pricingRuleCreateSchema>;
