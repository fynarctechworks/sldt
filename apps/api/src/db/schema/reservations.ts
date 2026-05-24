import { sql } from "drizzle-orm";
import {
  check,
  date,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { BOOKING_SOURCES, RESERVATION_STATUSES } from "./enums.js";
import { guests } from "./guests.js";
import { profiles } from "./profiles.js";
import { properties } from "./properties.js";
import { ratePlans } from "./ratePlans.js";
import { rooms } from "./rooms.js";

export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationNumber: text("reservation_number").notNull().unique(),
    // Phase 2: reservations live under a property. Back-filled to
    // PRIMARY by migration 0013.
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id),
    // Phase 2: optional rate-plan snapshot. The id FK lets the rate
    // calendar editor surface "live" rate-plan info; the code text is
    // duplicated for legibility if the plan is later deleted.
    ratePlanId: uuid("rate_plan_id").references(() => ratePlans.id),
    ratePlanCode: text("rate_plan_code"),
    // Phase 2 Revenue & Ops — optional company (B2B) and group block.
    // Both FK-only; the application snapshots company_code for legibility.
    // We do NOT import companies / group_blocks here to avoid a cyclic
    // schema dep; the columns are plain uuid types and Drizzle is happy
    // because the FK constraint lives at the DB level (added by 0014).
    companyId: uuid("company_id"),
    companyCode: text("company_code"),
    groupBlockId: uuid("group_block_id"),
    guestId: uuid("guest_id")
      .notNull()
      .references(() => guests.id),
    checkInDate: date("check_in_date").notNull(),
    checkOutDate: date("check_out_date").notNull(),
    // 'overnight' (default) — traditional night-based booking.
    // 'short_stay' — same-calendar-day day-use booking measured in hours;
    // duration_hours is required and check_out_date == check_in_date.
    stayType: text("stay_type", { enum: ["overnight", "short_stay"] as const })
      .notNull()
      .default("overnight"),
    durationHours: numeric("duration_hours", { precision: 5, scale: 2 }),
    numAdults: integer("num_adults").notNull().default(1),
    numChildren: integer("num_children").notNull().default(0),
    ratePerNight: numeric("rate_per_night", { precision: 10, scale: 2 }).notNull(),
    numNights: integer("num_nights")
      .notNull()
      .generatedAlwaysAs(sql`(check_out_date - check_in_date)`),
    subtotal: numeric("subtotal", { precision: 10, scale: 2 }).notNull(),
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull(),
    gstAmount: numeric("gst_amount", { precision: 10, scale: 2 }).notNull(),
    grandTotal: numeric("grand_total", { precision: 10, scale: 2 }).notNull(),
    // GST mode snapshot at create time. 'exclusive' means subtotal is the
    // net (GST added on top), 'inclusive' means grand_total already
    // contained GST (subtotal was extracted backwards). Recalcs and
    // edits on this row honour the same mode it was created with, so the
    // property's current setting can change without rewriting history.
    gstMode: text("gst_mode", { enum: ["exclusive", "inclusive"] as const })
      .notNull()
      .default("exclusive"),
    advancePaid: numeric("advance_paid", { precision: 10, scale: 2 }).notNull().default("0"),
    // Wallet credit applied as a discount on this booking. Deducted from
    // balanceDue (and shown as a separate line on the invoice). The source
    // entries live in guest_ledger with entryType='credit_used'.
    walletCreditApplied: numeric("wallet_credit_applied", { precision: 10, scale: 2 })
      .notNull()
      .default("0"),
    balanceDue: numeric("balance_due", { precision: 10, scale: 2 }).notNull(),
    // Extra hours granted via POST /:id/late-checkout. Added to the hotel's
    // default checkOutTime to compute the effective per-reservation
    // check-out moment. 0 = no extension (the default).
    lateCheckoutHours: numeric("late_checkout_hours", { precision: 4, scale: 2 })
      .notNull()
      .default("0"),
    status: text("status", { enum: RESERVATION_STATUSES }).notNull().default("confirmed"),
    bookingSource: text("booking_source", { enum: BOOKING_SOURCES }).notNull().default("walkin"),
    creditNotes: text("credit_notes"),
    cancellationReason: text("cancellation_reason"),
    specialRequests: text("special_requests"),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),
    checkedInBy: uuid("checked_in_by").references(() => profiles.id),
    checkedOutBy: uuid("checked_out_by").references(() => profiles.id),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    checkOutAfterIn: check(
      "res_checkout_after_checkin",
      sql`(${t.stayType} = 'short_stay' AND ${t.checkOutDate} >= ${t.checkInDate})
        OR (${t.stayType} = 'overnight' AND ${t.checkOutDate} > ${t.checkInDate})`,
    ),
  }),
);

export const reservationRooms = pgTable("reservation_rooms", {
  id: uuid("id").primaryKey().defaultRandom(),
  reservationId: uuid("reservation_id")
    .notNull()
    .references(() => reservations.id, { onDelete: "cascade" }),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id),
  ratePerNight: numeric("rate_per_night", { precision: 10, scale: 2 }).notNull(),
  soldAsType: text("sold_as_type"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Reservation = typeof reservations.$inferSelect;
export type NewReservation = typeof reservations.$inferInsert;
export type ReservationRoom = typeof reservationRooms.$inferSelect;
export type NewReservationRoom = typeof reservationRooms.$inferInsert;
