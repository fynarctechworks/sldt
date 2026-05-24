// Booking engine settings (single row per property) + pending bookings
// inbox (anonymous traffic from the public widget).

import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { profiles } from "./profiles.js";
import { properties } from "./properties.js";
import { ratePlans } from "./ratePlans.js";
import { reservations } from "./reservations.js";

export const bookingEngineSettings = pgTable("booking_engine_settings", {
  propertyId: uuid("property_id")
    .primaryKey()
    .references(() => properties.id),
  isEnabled: boolean("is_enabled").notNull().default(false),
  publicRatePlanId: uuid("public_rate_plan_id").references(() => ratePlans.id),
  cancellationPolicy: text("cancellation_policy"),
  minAdvanceHours: integer("min_advance_hours").notNull().default(0),
  maxNightsPerBooking: integer("max_nights_per_booking").notNull().default(14),
  requireKycAtBooking: boolean("require_kyc_at_booking").notNull().default(false),
  bannerImageUrl: text("banner_image_url"),
  tagline: text("tagline"),
  channelLabel: text("channel_label").notNull().default("phone_whatsapp"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const PENDING_BOOKING_STATUSES = [
  "received",
  "accepted",
  "rejected",
  "expired",
] as const;
export type PendingBookingStatus = (typeof PENDING_BOOKING_STATUSES)[number];

export const PENDING_BOOKING_PAYMENT_STATUSES = [
  "unpaid",
  "pending",
  "paid",
  "refunded",
  "failed",
] as const;

export const pendingBookings = pgTable(
  "pending_bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id),
    publicRef: text("public_ref").notNull().unique(),
    checkInDate: date("check_in_date").notNull(),
    checkOutDate: date("check_out_date").notNull(),
    numAdults: integer("num_adults").notNull().default(1),
    numChildren: integer("num_children").notNull().default(0),
    roomType: text("room_type").notNull(),
    ratePlanId: uuid("rate_plan_id").references(() => ratePlans.id),
    guestName: text("guest_name").notNull(),
    guestPhone: text("guest_phone").notNull(),
    guestEmail: text("guest_email"),
    quotedRate: numeric("quoted_rate", { precision: 10, scale: 2 }).notNull(),
    quotedTotal: numeric("quoted_total", { precision: 12, scale: 2 }).notNull(),
    paymentProvider: text("payment_provider"),
    paymentOrderId: text("payment_order_id"),
    paymentPaymentId: text("payment_payment_id"),
    paymentStatus: text("payment_status", { enum: PENDING_BOOKING_PAYMENT_STATUSES })
      .notNull()
      .default("unpaid"),
    status: text("status", { enum: PENDING_BOOKING_STATUSES }).notNull().default("received"),
    reservationId: uuid("reservation_id").references(() => reservations.id),
    rejectedReason: text("rejected_reason"),
    submittedIp: text("submitted_ip"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by").references(() => profiles.id),
  },
  (t) => ({
    inbox: index("idx_pending_bookings_inbox").on(
      t.propertyId,
      t.status,
      t.submittedAt,
    ),
  }),
);

export type BookingEngineSettings = typeof bookingEngineSettings.$inferSelect;
export type PendingBooking = typeof pendingBookings.$inferSelect;
export type NewPendingBooking = typeof pendingBookings.$inferInsert;
