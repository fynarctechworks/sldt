import { z } from "zod";

export const GROUP_BLOCK_STATUSES = [
  "tentative",
  "confirmed",
  "partial",
  "closed",
  "cancelled",
] as const;
export type GroupBlockStatus = (typeof GROUP_BLOCK_STATUSES)[number];

export const groupBlockCreateSchema = z.object({
  groupCode: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[A-Z0-9_-]+$/i, "letters/digits/_/- only"),
  groupName: z.string().min(2).max(120),
  contactName: z.string().max(80).nullable().optional(),
  contactPhone: z.string().max(20).nullable().optional(),
  contactEmail: z.string().email().nullable().optional(),
  companyId: z.string().uuid().nullable().optional(),
  ratePlanId: z.string().uuid().nullable().optional(),
  blockStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  blockEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cutoffDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const groupBlockUpdateSchema = groupBlockCreateSchema.partial().extend({
  status: z.enum(GROUP_BLOCK_STATUSES).optional(),
});

// Add a row to the rooming list. Either roomType or roomId must be set.
export const groupRoomCreateSchema = z
  .object({
    roomType: z.string().min(1).max(60).nullable().optional(),
    roomId: z.string().uuid().nullable().optional(),
    guestName: z.string().min(2).max(120).nullable().optional(),
    guestPhone: z.string().max(20).nullable().optional(),
    guestEmail: z.string().email().nullable().optional(),
    ratePerNight: z.coerce.number().min(0).max(10_000_000).nullable().optional(),
    numAdults: z.coerce.number().int().min(1).max(10).default(1),
    numChildren: z.coerce.number().int().min(0).max(10).default(0),
    notes: z.string().max(500).nullable().optional(),
  })
  .refine((v) => !!v.roomType || !!v.roomId, {
    message: "roomType or roomId is required",
  });

// Bulk-add — the rooming-list editor lets staff paste a list and submit
// up to 50 rows in one call.
export const groupRoomBulkCreateSchema = z.object({
  rows: z.array(groupRoomCreateSchema).min(1).max(50),
});

export type GroupBlockCreateInput = z.infer<typeof groupBlockCreateSchema>;
export type GroupBlockUpdateInput = z.infer<typeof groupBlockUpdateSchema>;
export type GroupRoomCreateInput = z.infer<typeof groupRoomCreateSchema>;
