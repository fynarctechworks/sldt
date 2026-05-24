import { z } from "zod";

// DPDP: data-subject export. Subject identifies themselves; staff or
// OTP verifies before fulfilment.
export const dpdpExportRequestSchema = z.object({
  guestId: z.string().uuid(),
  verificationMethod: z.enum(["staff_verified", "otp_verified"]),
  verificationNote: z.string().max(500).optional(),
});

// DPDP: data-subject deletion. Once fulfilled, the guest's PII is
// redacted in place (full_name, phone, email, address, IDs). The
// audit row (dpdp_deletions) keeps a copy with reason.
export const dpdpDeleteRequestSchema = z.object({
  guestId: z.string().uuid(),
  verificationMethod: z.enum(["staff_verified", "otp_verified"]),
  reason: z.string().min(2).max(1000),
});

export const GST_RETURN_TYPES = ["GSTR-1", "GSTR-3B"] as const;
export type GstReturnType = (typeof GST_RETURN_TYPES)[number];

export const gstReturnRunSchema = z.object({
  returnType: z.enum(GST_RETURN_TYPES),
  periodMonth: z.coerce.number().int().min(1).max(12),
  periodYear: z.coerce.number().int().min(2017).max(2100),
  force: z.boolean().default(false),
});

export type DpdpExportRequest = z.infer<typeof dpdpExportRequestSchema>;
export type DpdpDeleteRequest = z.infer<typeof dpdpDeleteRequestSchema>;
export type GstReturnRunInput = z.infer<typeof gstReturnRunSchema>;
