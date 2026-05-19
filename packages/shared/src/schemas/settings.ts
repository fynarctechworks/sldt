import { z } from "zod";
import { ROLES } from "../enums.js";

export const settingsUpdateSchema = z.object({
  hotelName: z.string().min(1).optional(),
  hotelAddress: z.string().min(1).optional(),
  hotelPhone: z.string().min(1).optional(),
  hotelEmail: z.string().email().optional().nullable(),
  ownerPhone: z.string().optional().nullable().transform((v) => (v === "" ? null : v)),
  ownerNotifyEnabled: z.boolean().optional(),
  wifiSsid: z.string().max(60).optional().nullable().transform((v) => (v === "" ? null : v)),
  wifiPassword: z.string().max(120).optional().nullable().transform((v) => (v === "" ? null : v)),
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
  // 'exclusive': rate is net, GST added on top.
  // 'inclusive': rate already includes GST; net is extracted backwards.
  gstMode: z.enum(["exclusive", "inclusive"]).optional(),

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

// Strong-password rule: 10+ chars, at least one letter, at least one digit,
// at least one symbol. Catches the common weak choices ("password123",
// "12345678") while staying typeable. We don't enforce mixed case so users
// who type in non-Latin scripts aren't locked out — symbol-and-digit is
// sufficient entropy.
const STRONG_PASSWORD = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(72, "Password is too long")
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/[0-9]/, "Password must contain a digit")
  .regex(/[^A-Za-z0-9]/, "Password must contain a symbol")
  .refine((v) => !/^(.)\1+$/.test(v), "Password can't be all the same character")
  .refine(
    (v) => !["password", "12345678", "qwerty", "admin", "letmein"].some((bad) => v.toLowerCase().includes(bad)),
    "Password is too common — try something less predictable",
  );

export const staffCreateSchema = z.object({
  email: z.string().email(),
  password: STRONG_PASSWORD,
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
  password: STRONG_PASSWORD.optional(),
});

const slugRegex = /^[a-z0-9_]+$/;

// One row of the per-room-type short-stay price table. The reservation UI
// renders these as quick-pick pills and pro-rates a custom-hours entry from
// the closest band.
export const shortStayBandSchema = z.object({
  label: z.string().min(1).max(40),
  hours: z.coerce.number().positive().max(23.5),
  rate: z.coerce.number().min(0),
});
export type ShortStayBand = z.infer<typeof shortStayBandSchema>;

export const roomTypeCreateSchema = z.object({
  slug: z.string().min(1).max(40).regex(slugRegex, "Slug must be lowercase letters, numbers, underscore"),
  label: z.string().min(1).max(60),
  defaultRate: z.coerce.number().positive(),
  maxOccupancy: z.coerce.number().int().min(1).max(20).default(2),
  description: z.string().max(300).optional().nullable(),
  isActive: z.boolean().default(true),
  shortStayBands: z.array(shortStayBandSchema).max(10).optional(),
});

export const roomTypeUpdateSchema = roomTypeCreateSchema.partial().extend({
  slug: z.string().min(1).max(40).regex(slugRegex).optional(),
});

export type RoomTypeCreateInput = z.infer<typeof roomTypeCreateSchema>;
export type RoomTypeUpdateInput = z.infer<typeof roomTypeUpdateSchema>;

