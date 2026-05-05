import { sql } from "drizzle-orm";
import { boolean, check, date, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { INVOICE_STATUSES, LINE_ITEM_TYPES, PAYMENT_METHODS } from "./enums.js";
import { guests } from "./guests.js";
import { profiles } from "./profiles.js";
import { reservations } from "./reservations.js";

export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  reservationId: uuid("reservation_id")
    .notNull()
    .references(() => reservations.id),
  guestId: uuid("guest_id")
    .notNull()
    .references(() => guests.id),
  hotelName: text("hotel_name").notNull(),
  hotelAddress: text("hotel_address").notNull(),
  hotelGstin: text("hotel_gstin").notNull(),
  guestName: text("guest_name").notNull(),
  guestAddress: text("guest_address"),
  guestGstin: text("guest_gstin"),
  subtotal: numeric("subtotal", { precision: 10, scale: 2 }).notNull(),
  cgstRate: numeric("cgst_rate", { precision: 5, scale: 2 }).notNull(),
  cgstAmount: numeric("cgst_amount", { precision: 10, scale: 2 }).notNull(),
  sgstRate: numeric("sgst_rate", { precision: 5, scale: 2 }).notNull(),
  sgstAmount: numeric("sgst_amount", { precision: 10, scale: 2 }).notNull(),
  grandTotal: numeric("grand_total", { precision: 10, scale: 2 }).notNull(),
  totalPaid: numeric("total_paid", { precision: 10, scale: 2 }).notNull().default("0"),
  balanceDue: numeric("balance_due", { precision: 10, scale: 2 }).notNull(),
  status: text("status", { enum: INVOICE_STATUSES }).notNull().default("issued"),
  notes: text("notes"),
  issueDate: date("issue_date"),
  reissuedFrom: uuid("reissued_from"),
  voidedReason: text("voided_reason"),
  voidedBy: uuid("voided_by").references(() => profiles.id),
  issuedBy: uuid("issued_by")
    .notNull()
    .references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invoiceLineItems = pgTable("invoice_line_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  sacCode: text("sac_code").notNull().default("9963"),
  quantity: integer("quantity").notNull().default(1),
  rate: numeric("rate", { precision: 10, scale: 2 }).notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull(),
  gstAmount: numeric("gst_amount", { precision: 10, scale: 2 }).notNull(),
  itemType: text("item_type", { enum: LINE_ITEM_TYPES }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receiptNumber: text("receipt_number").unique(),
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    paymentMethod: text("payment_method", { enum: PAYMENT_METHODS }).notNull(),
    paymentDate: timestamp("payment_date", { withTimezone: true }).notNull().defaultNow(),
    receivedBy: uuid("received_by")
      .notNull()
      .references(() => profiles.id),
    notes: text("notes"),
    voided: boolean("voided").notNull().default(false),
    voidedReason: text("voided_reason"),
    voidedBy: uuid("voided_by"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    amountPositive: check("payment_amount_positive", sql`${t.amount} > 0`),
  }),
);

export const additionalCharges = pgTable("additional_charges", {
  id: uuid("id").primaryKey().defaultRandom(),
  reservationId: uuid("reservation_id")
    .notNull()
    .references(() => reservations.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull().default(1),
  rate: numeric("rate", { precision: 10, scale: 2 }).notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull().default("18"),
  addedBy: uuid("added_by")
    .notNull()
    .references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type InvoiceLineItem = typeof invoiceLineItems.$inferSelect;
export type NewInvoiceLineItem = typeof invoiceLineItems.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type AdditionalCharge = typeof additionalCharges.$inferSelect;
export type NewAdditionalCharge = typeof additionalCharges.$inferInsert;
