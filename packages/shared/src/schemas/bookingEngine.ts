import { z } from "zod";

export const bookingEngineSettingsSchema = z.object({
  isEnabled: z.boolean().optional(),
  publicRatePlanId: z.string().uuid().nullable().optional(),
  cancellationPolicy: z.string().max(5000).nullable().optional(),
  minAdvanceHours: z.coerce.number().int().min(0).max(720).optional(),
  maxNightsPerBooking: z.coerce.number().int().min(1).max(60).optional(),
  requireKycAtBooking: z.boolean().optional(),
  bannerImageUrl: z.string().url().nullable().optional(),
  tagline: z.string().max(200).nullable().optional(),
  channelLabel: z.string().max(40).optional(),
});

// Public booking submission (used by the no-auth widget endpoint).
export const publicBookingSubmitSchema = z.object({
  propertyCode: z.string().min(2).max(40),
  checkInDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOutDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  numAdults: z.coerce.number().int().min(1).max(10).default(1),
  numChildren: z.coerce.number().int().min(0).max(10).default(0),
  roomType: z.string().min(1).max(60),
  guestName: z.string().min(2).max(120),
  guestPhone: z.string().min(6).max(20),
  guestEmail: z.string().email().nullable().optional(),
  // Acceptance flags — DPDP requires consent recorded.
  acceptsCancellationPolicy: z.boolean().refine((v) => v === true, {
    message: "Cancellation policy must be accepted",
  }),
  acceptsMarketing: z.boolean().default(false),
});

export const publicQuoteQuerySchema = z.object({
  propertyCode: z.string().min(2).max(40),
  checkInDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOutDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  roomType: z.string().min(1).max(60),
});

// Admin: review (accept/reject) a pending booking.
export const pendingBookingReviewSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept"), roomId: z.string().uuid() }),
  z.object({ action: z.literal("reject"), reason: z.string().min(2).max(500) }),
]);

export type BookingEngineSettingsInput = z.infer<typeof bookingEngineSettingsSchema>;
export type PublicBookingSubmitInput = z.infer<typeof publicBookingSubmitSchema>;
export type PublicQuoteQuery = z.infer<typeof publicQuoteQuerySchema>;
export type PendingBookingReviewInput = z.infer<typeof pendingBookingReviewSchema>;
