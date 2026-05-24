// DPDP (data-subject requests) + GSTR returns + marketing consent log.

import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { guests } from "./guests.js";
import { profiles } from "./profiles.js";
import { properties } from "./properties.js";

export const DPDP_VERIFICATION_METHODS = ["staff_verified", "otp_verified"] as const;
export type DpdpVerificationMethod = (typeof DPDP_VERIFICATION_METHODS)[number];

export const dpdpExports = pgTable("dpdp_exports", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id")
    .notNull()
    .references(() => properties.id),
  guestId: uuid("guest_id").references(() => guests.id),
  subjectName: text("subject_name").notNull(),
  subjectPhone: text("subject_phone").notNull(),
  subjectEmail: text("subject_email"),
  verificationMethod: text("verification_method", {
    enum: DPDP_VERIFICATION_METHODS,
  }).notNull(),
  exportPayload: jsonb("export_payload").notNull(),
  exportUrl: text("export_url"),
  requestedBy: uuid("requested_by").references(() => profiles.id),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  fulfilledBy: uuid("fulfilled_by").references(() => profiles.id),
  fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dpdpDeletions = pgTable("dpdp_deletions", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id")
    .notNull()
    .references(() => properties.id),
  guestId: uuid("guest_id").references(() => guests.id),
  subjectSnapshot: jsonb("subject_snapshot").notNull(),
  redactedFields: text("redacted_fields").array().notNull(),
  reason: text("reason"),
  verificationMethod: text("verification_method", {
    enum: DPDP_VERIFICATION_METHODS,
  }).notNull(),
  requestedBy: uuid("requested_by").references(() => profiles.id),
  fulfilledBy: uuid("fulfilled_by").references(() => profiles.id),
  fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }).notNull().defaultNow(),
});

export const marketingConsentLog = pgTable("marketing_consent_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id")
    .notNull()
    .references(() => properties.id),
  guestId: uuid("guest_id")
    .notNull()
    .references(() => guests.id, { onDelete: "cascade" }),
  granted: boolean("granted").notNull(),
  channel: text("channel"),
  source: text("source"),
  changedBy: uuid("changed_by").references(() => profiles.id),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const GST_RETURN_TYPES = ["GSTR-1", "GSTR-3B"] as const;
export type GstReturnType = (typeof GST_RETURN_TYPES)[number];

export const gstReturnsRuns = pgTable(
  "gst_returns_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id),
    returnType: text("return_type", { enum: GST_RETURN_TYPES }).notNull(),
    periodMonth: integer("period_month").notNull(),
    periodYear: integer("period_year").notNull(),
    payload: jsonb("payload").notNull(),
    totalInvoices: integer("total_invoices").notNull().default(0),
    totalTaxable: numeric("total_taxable", { precision: 14, scale: 2 }).notNull().default("0"),
    totalCgst: numeric("total_cgst", { precision: 14, scale: 2 }).notNull().default("0"),
    totalSgst: numeric("total_sgst", { precision: 14, scale: 2 }).notNull().default("0"),
    totalIgst: numeric("total_igst", { precision: 14, scale: 2 }).notNull().default("0"),
    generatedBy: uuid("generated_by").references(() => profiles.id),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniquePerPeriod: uniqueIndex("gst_returns_runs_unique").on(
      t.propertyId,
      t.returnType,
      t.periodYear,
      t.periodMonth,
    ),
  }),
);

export type DpdpExport = typeof dpdpExports.$inferSelect;
export type DpdpDeletion = typeof dpdpDeletions.$inferSelect;
export type GstReturnsRun = typeof gstReturnsRuns.$inferSelect;
export type NewGstReturnsRun = typeof gstReturnsRuns.$inferInsert;
