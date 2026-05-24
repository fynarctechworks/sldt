import { z } from "zod";

// Rate plan create / update. Modifier is a multiplier on top of the
// room's base_rate; a value of 1.0 keeps the price unchanged. We cap
// the upper bound at 10× because a higher number is almost certainly
// a typo (e.g. typing 200 meaning 2.00).
export const ratePlanCreateSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(24)
    .regex(/^[A-Z0-9_]+$/, "code must be uppercase letters, digits, underscores"),
  name: z.string().min(2).max(80),
  description: z.string().max(500).optional().nullable(),
  baseModifier: z.coerce.number().min(0.01).max(10).default(1),
  minLengthOfStay: z.coerce.number().int().min(1).max(365).optional().nullable(),
  maxLengthOfStay: z.coerce.number().int().min(1).max(365).optional().nullable(),
  closedToArrival: z.boolean().default(false),
  closedToDeparture: z.boolean().default(false),
  isPublic: z.boolean().default(true),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(100),
});
export const ratePlanUpdateSchema = ratePlanCreateSchema.partial();

// Rate calendar bulk-set. Takes a date range, a list of room_types, and
// the patch to apply to each (rate_plan_id × room_type × date) cell.
// We do bulk-set rather than per-cell so a "make next 14 weekends +20%"
// operation is a single API call.
export const rateCalendarBulkSetSchema = z.object({
  ratePlanId: z.string().uuid(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  roomTypes: z.array(z.string().min(1)).min(1).max(50),
  // Only weekdays we want to TOUCH. Default: all 7. 0 = Sunday … 6 = Saturday.
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  patch: z
    .object({
      rateOverride: z.coerce.number().min(0).max(10_000_000).nullable().optional(),
      roomsAvailable: z.coerce.number().int().min(0).max(10_000).nullable().optional(),
      minLengthOfStay: z.coerce.number().int().min(1).max(365).nullable().optional(),
      maxLengthOfStay: z.coerce.number().int().min(1).max(365).nullable().optional(),
      closedToArrival: z.boolean().nullable().optional(),
      closedToDeparture: z.boolean().nullable().optional(),
      notes: z.string().max(240).nullable().optional(),
    })
    .refine((p) => Object.keys(p).length > 0, {
      message: "patch must include at least one field",
    }),
});

// Resolve a price for a (rate_plan, room_type, date) tuple. Used by
// the booking flow and the future direct-booking widget.
export const ratePlanLookupQuerySchema = z.object({
  ratePlanId: z.string().uuid().optional(),
  roomType: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const seasonCreateSchema = z.object({
  name: z.string().min(2).max(80),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  modifier: z.coerce.number().min(0.01).max(10).default(1),
  notes: z.string().max(500).optional().nullable(),
  isActive: z.boolean().default(true),
});

export type RatePlanCreateInput = z.infer<typeof ratePlanCreateSchema>;
export type RatePlanUpdateInput = z.infer<typeof ratePlanUpdateSchema>;
export type RateCalendarBulkSetInput = z.infer<typeof rateCalendarBulkSetSchema>;
export type RatePlanLookupQuery = z.infer<typeof ratePlanLookupQuerySchema>;
export type SeasonCreateInput = z.infer<typeof seasonCreateSchema>;
