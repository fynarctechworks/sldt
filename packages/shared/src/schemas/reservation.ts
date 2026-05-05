import { z } from "zod";
import { BOOKING_SOURCES, PAYMENT_METHODS, RESERVATION_STATUSES } from "../enums.js";

export const reservationCreateSchema = z
  .object({
    guestId: z.string().uuid(),
    rooms: z
      .array(
        z.object({
          roomId: z.string().uuid(),
          ratePerNight: z.coerce.number().positive(),
          soldAsType: z.string().min(1).max(64).optional().nullable(),
        }),
      )
      .min(1),
    checkInDate: z.string().date(),
    checkOutDate: z.string().date(),
    numAdults: z.coerce.number().int().min(1).default(1),
    numChildren: z.coerce.number().int().min(0).default(0),
    advancePaid: z.coerce.number().min(0).default(0),
    advancePaymentMethod: z.enum(PAYMENT_METHODS).optional(),
    specialRequests: z.string().max(1000).optional().nullable(),
    bookingSource: z.enum(BOOKING_SOURCES).optional().default("walkin"),
    creditNotes: z.string().max(500).optional().nullable(),
  })
  .refine((d) => new Date(d.checkOutDate) > new Date(d.checkInDate), {
    message: "check_out_date must be after check_in_date",
    path: ["checkOutDate"],
  });

export const reservationListQuerySchema = z.object({
  status: z.enum(RESERVATION_STATUSES).optional(),
  date: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
});

export const checkInSchema = z.object({
  advancePayment: z.coerce.number().min(0).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
});

export const checkOutSchema = z.object({
  finalPayment: z.coerce.number().min(0).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
});

export const cancelSchema = z.object({
  cancellationReason: z.string().min(1).max(500),
});

export const swapRoomSchema = z.object({
  newRoomId: z.string().uuid(),
});

export const additionalChargeSchema = z.object({
  description: z.string().min(1).max(200),
  quantity: z.coerce.number().int().min(1).default(1),
  rate: z.coerce.number().positive(),
  gstRate: z.coerce.number().min(0).max(100).default(18),
});

export const paymentSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.coerce.number().positive(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  notes: z.string().max(500).optional(),
});

export const voidInvoiceSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const availabilityQuerySchema = z.object({
  check_in: z.string().date(),
  check_out: z.string().date(),
});

export const extendReservationSchema = z.object({
  newCheckOutDate: z.string().date(),
  ratePerNight: z.coerce.number().positive().optional(),
});

export const lateCheckoutSchema = z.object({
  hours: z.coerce.number().positive().max(24),
  fee: z.coerce.number().min(0).default(0),
  notes: z.string().max(500).optional().nullable(),
});

export const addRoomSchema = z.object({
  roomId: z.string().uuid(),
  ratePerNight: z.coerce.number().positive(),
  soldAsType: z.string().min(1).max(64).optional().nullable(),
  startDate: z.string().date().optional(),
});

export const editRoomRateSchema = z.object({
  ratePerNight: z.coerce.number().positive(),
});

export const editChargeSchema = z.object({
  description: z.string().min(1).max(200).optional(),
  quantity: z.coerce.number().int().min(1).optional(),
  rate: z.coerce.number().positive().optional(),
  gstRate: z.coerce.number().min(0).max(100).optional(),
});

export const editDatesSchema = z
  .object({
    checkInDate: z.string().date(),
    checkOutDate: z.string().date(),
  })
  .refine((d) => new Date(d.checkOutDate) > new Date(d.checkInDate), {
    message: "check_out_date must be after check_in_date",
    path: ["checkOutDate"],
  });

export const editInvoiceSchema = z.object({
  issueDate: z.string().date().optional(),
  notes: z.string().max(1000).optional().nullable(),
});

export const editPaymentSchema = z.object({
  paymentDate: z.string().datetime().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  notes: z.string().max(500).optional().nullable(),
});

export const voidPaymentSchema = z.object({
  reason: z.string().min(1).max(500),
});

export type ReservationCreateInput = z.infer<typeof reservationCreateSchema>;
export type CheckInInput = z.infer<typeof checkInSchema>;
export type CheckOutInput = z.infer<typeof checkOutSchema>;
export type AdditionalChargeInput = z.infer<typeof additionalChargeSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
