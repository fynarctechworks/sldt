// Multi-folio billing.
//
// A folio is a sub-bill within a reservation. The classic example:
// "company pays room, guest pays food" — two folios on the same
// reservation. folio_charges is the line-item table (one charge can
// be moved between folios; the trigger keeps totals current).

import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { guests } from "./guests.js";
import { profiles } from "./profiles.js";
import { properties } from "./properties.js";
import { reservations } from "./reservations.js";

export const FOLIO_PAYER_TYPES = ["guest", "company", "agent", "other"] as const;
export type FolioPayerType = (typeof FOLIO_PAYER_TYPES)[number];

export const FOLIO_STATUSES = ["open", "settled", "voided"] as const;
export type FolioStatus = (typeof FOLIO_STATUSES)[number];

export const FOLIO_CHARGE_SOURCES = ["room", "additional", "manual", "discount"] as const;
export type FolioChargeSource = (typeof FOLIO_CHARGE_SOURCES)[number];

export const folios = pgTable(
  "folios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "cascade" }),
    folioNumber: integer("folio_number").notNull(),
    label: text("label").notNull(),
    payerType: text("payer_type", { enum: FOLIO_PAYER_TYPES }).notNull(),
    payerGuestId: uuid("payer_guest_id").references(() => guests.id),
    payerCompanyId: uuid("payer_company_id").references(() => companies.id),
    payerName: text("payer_name"),
    isPrimary: boolean("is_primary").notNull().default(false),
    chargesTotal: numeric("charges_total", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    paidTotal: numeric("paid_total", { precision: 12, scale: 2 }).notNull().default("0"),
    balanceDue: numeric("balance_due", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    status: text("status", { enum: FOLIO_STATUSES }).notNull().default("open"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    numberPerReservation: uniqueIndex("folios_number_per_reservation").on(
      t.reservationId,
      t.folioNumber,
    ),
    byReservation: index("idx_folios_reservation").on(t.reservationId, t.folioNumber),
  }),
);

export const folioCharges = pgTable(
  "folio_charges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    folioId: uuid("folio_id")
      .notNull()
      .references(() => folios.id, { onDelete: "cascade" }),
    source: text("source", { enum: FOLIO_CHARGE_SOURCES }).notNull(),
    sourceId: uuid("source_id"),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull().default("1"),
    rate: numeric("rate", { precision: 12, scale: 2 }).notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    gstAmount: numeric("gst_amount", { precision: 12, scale: 2 }).notNull().default("0"),
    chargeDate: date("charge_date").notNull().defaultNow(),
    voided: boolean("voided").notNull().default(false),
    voidedReason: text("voided_reason"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: uuid("voided_by").references(() => profiles.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => profiles.id),
  },
  (t) => ({
    byFolio: index("idx_folio_charges_folio").on(t.folioId, t.chargeDate),
  }),
);

export type Folio = typeof folios.$inferSelect;
export type NewFolio = typeof folios.$inferInsert;
export type FolioCharge = typeof folioCharges.$inferSelect;
export type NewFolioCharge = typeof folioCharges.$inferInsert;
