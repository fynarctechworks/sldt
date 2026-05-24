import { z } from "zod";

export const FOLIO_PAYER_TYPES = ["guest", "company", "agent", "other"] as const;
export type FolioPayerType = (typeof FOLIO_PAYER_TYPES)[number];

// Folios are always created inside a reservation context.
// Either payer_guest_id (when payerType=guest), payer_company_id (when
// payerType=company/agent), or payer_name (when payerType=other) is
// required — enforced both here and by the DB CHECK constraint.
export const folioCreateSchema = z
  .object({
    label: z.string().min(1).max(80),
    payerType: z.enum(FOLIO_PAYER_TYPES),
    payerGuestId: z.string().uuid().nullable().optional(),
    payerCompanyId: z.string().uuid().nullable().optional(),
    payerName: z.string().min(1).max(120).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.payerType === "guest" && !val.payerGuestId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "payerGuestId is required when payerType=guest",
        path: ["payerGuestId"],
      });
    }
    if ((val.payerType === "company" || val.payerType === "agent") && !val.payerCompanyId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "payerCompanyId is required when payerType=company/agent",
        path: ["payerCompanyId"],
      });
    }
    if (val.payerType === "other" && !val.payerName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "payerName is required when payerType=other",
        path: ["payerName"],
      });
    }
  });

export const folioChargeCreateSchema = z.object({
  description: z.string().min(2).max(200),
  quantity: z.coerce.number().min(0.01).max(1000).default(1),
  rate: z.coerce.number().min(0).max(10_000_000),
  gstRate: z.coerce.number().min(0).max(50).default(0),
  source: z
    .enum(["room", "additional", "manual", "discount"] as const)
    .default("manual"),
  chargeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// Move a charge from one folio to another. Used by the "split bill"
// UI — operator drags an additional-charge row from folio A to folio B.
export const folioChargeMoveSchema = z.object({
  toFolioId: z.string().uuid(),
});

export type FolioCreateInput = z.infer<typeof folioCreateSchema>;
export type FolioChargeCreateInput = z.infer<typeof folioChargeCreateSchema>;
