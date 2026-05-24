import { z } from "zod";

export const companyCreateSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(24)
    .regex(/^[A-Z0-9_-]+$/, "code must be uppercase letters, digits, _ or -"),
  name: z.string().min(2).max(120),
  legalName: z.string().max(200).nullable().optional(),
  gstin: z.string().max(20).nullable().optional(),
  pan: z.string().max(10).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  city: z.string().max(80).nullable().optional(),
  state: z.string().max(80).nullable().optional(),
  pincode: z.string().max(10).nullable().optional(),
  contactName: z.string().max(80).nullable().optional(),
  contactPhone: z.string().max(20).nullable().optional(),
  contactEmail: z.string().email().nullable().optional(),
  creditLimit: z.coerce.number().min(0).max(10_000_000_000).nullable().optional(),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(0),
  defaultRatePlanId: z.string().uuid().nullable().optional(),
  defaultDiscountPct: z.coerce.number().min(0).max(100).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const companyUpdateSchema = companyCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const companyListQuerySchema = z.object({
  search: z.string().max(80).optional(),
  // Include archived (is_active=false) accounts. Default false.
  includeArchived: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .transform((v) => v === true || v === "true")
    .default("false"),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
});

export type CompanyCreateInput = z.infer<typeof companyCreateSchema>;
export type CompanyUpdateInput = z.infer<typeof companyUpdateSchema>;
