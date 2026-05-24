// Corporate accounts (and travel agents — same model).
//
// A company is anyone who pays bills on behalf of a guest: a corporate
// account, a travel agency, an OTA wholesaler. We attach them to
// reservations (FK only — the agreed rate stays snapshotted on the
// reservation rows so credit-policy changes don't rewrite history)
// and to folios (the company is then the payer of that folio).

import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { properties } from "./properties.js";
import { ratePlans } from "./ratePlans.js";

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    legalName: text("legal_name"),
    gstin: text("gstin"),
    pan: text("pan"),
    address: text("address"),
    city: text("city"),
    state: text("state"),
    pincode: text("pincode"),
    contactName: text("contact_name"),
    contactPhone: text("contact_phone"),
    contactEmail: text("contact_email"),
    creditLimit: numeric("credit_limit", { precision: 12, scale: 2 }),
    paymentTermsDays: integer("payment_terms_days").notNull().default(0),
    defaultRatePlanId: uuid("default_rate_plan_id").references(() => ratePlans.id),
    defaultDiscountPct: numeric("default_discount_pct", { precision: 5, scale: 2 }),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codePerProperty: uniqueIndex("companies_code_per_property").on(
      t.propertyId,
      t.code,
    ),
    byPropertyName: index("idx_companies_property_name").on(t.propertyId, t.name),
  }),
);

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
