import { z } from "zod";
import { ROLES } from "../enums.js";

export const settingsUpdateSchema = z.object({
  hotelName: z.string().min(1).optional(),
  hotelAddress: z.string().min(1).optional(),
  hotelPhone: z.string().min(1).optional(),
  hotelEmail: z.string().email().optional().nullable(),
  ownerPhone: z.string().optional().nullable().transform((v) => (v === "" ? null : v)),
  ownerNotifyEnabled: z.boolean().optional(),
  hotelGstin: z.string().min(1).optional(),
  hotelLogoUrl: z.string().url().optional().nullable(),
  checkInTime: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .optional(),
  checkOutTime: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .optional(),
  currencySymbol: z.string().min(1).optional(),
  invoicePrefix: z.string().min(1).max(10).optional(),
  gstSlabExemptBelow: z.coerce.number().min(0).optional(),
  gstSlabLowRate: z.coerce.number().min(0).max(100).optional(),
  gstSlabLowMax: z.coerce.number().min(0).optional(),
  gstSlabHighRate: z.coerce.number().min(0).max(100).optional(),
  additionalChargeDefaultGst: z.coerce.number().min(0).max(100).optional(),

  docPrimaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  docAccentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  docInvoiceTitle: z.string().min(1).max(60).optional(),
  docReceiptTitle: z.string().min(1).max(60).optional(),
  docFooterText: z.string().max(300).optional(),
  docTermsText: z.string().max(2000).optional().nullable(),
  docSignatoryLabel: z.string().min(1).max(80).optional(),
  docInvoicePageSize: z.enum(["A4", "A5", "Letter"]).optional(),
  docReceiptPageSize: z.enum(["A4", "A5", "A6", "Letter"]).optional(),
  docShowLogo: z.boolean().optional(),
  docShowGstin: z.boolean().optional(),
  docShowTerms: z.boolean().optional(),
  docShowSignature: z.boolean().optional(),
});

export const staffCreateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(2),
  role: z.enum(ROLES),
  phone: z.string().optional(),
});

export const staffUpdateSchema = z.object({
  fullName: z.string().min(2).optional(),
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional(),
  password: z.string().min(8).max(72).optional(),
});

const slugRegex = /^[a-z0-9_]+$/;

export const roomTypeCreateSchema = z.object({
  slug: z.string().min(1).max(40).regex(slugRegex, "Slug must be lowercase letters, numbers, underscore"),
  label: z.string().min(1).max(60),
  defaultRate: z.coerce.number().positive(),
  maxOccupancy: z.coerce.number().int().min(1).max(20).default(2),
  description: z.string().max(300).optional().nullable(),
  isActive: z.boolean().default(true),
});

export const roomTypeUpdateSchema = roomTypeCreateSchema.partial().extend({
  slug: z.string().min(1).max(40).regex(slugRegex).optional(),
});

export type RoomTypeCreateInput = z.infer<typeof roomTypeCreateSchema>;
export type RoomTypeUpdateInput = z.infer<typeof roomTypeUpdateSchema>;

