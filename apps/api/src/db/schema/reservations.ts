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
import { rooms } from "./rooms.js";

export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationNumber: text("reservation_number").notNull().unique(),
    guestId: uuid("guest_id")
      .notNull()
      .references(() => guests.id),
    checkInDate: date("check_in_date").notNull(),
    checkOutDate: date("check_out_date").notNull(),
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
    advancePaid: numeric("advance_paid", { precision: 10, scale: 2 }).notNull().default("0"),
    balanceDue: numeric("balance_due", { precision: 10, scale: 2 }).notNull(),
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
    checkOutAfterIn: check("res_checkout_after_checkin", sql`${t.checkOutDate} > ${t.checkInDate}`),
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
