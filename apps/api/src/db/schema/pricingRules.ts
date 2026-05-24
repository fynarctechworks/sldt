// Pricing rules (Phase 3 — dynamic-pricing engine).
//
// Declarative rules layered on top of the base_rate × rate_plan.modifier
// × rate_calendar.override pipeline. Applied in `priority` order at
// reservation create time.

import {
  boolean,
  date,
  index,
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
import { properties } from "./properties.js";
import { ratePlans } from "./ratePlans.js";

export const PRICING_RULE_KINDS = [
  "occupancy_threshold",
  "length_of_stay",
  "advance_purchase",
  "day_of_week",
  "season",
  "manual",
] as const;
export type PricingRuleKind = (typeof PRICING_RULE_KINDS)[number];

export const PRICING_ADJUSTMENT_TYPES = ["multiplier", "flat"] as const;
export type PricingAdjustmentType = (typeof PRICING_ADJUSTMENT_TYPES)[number];

export const pricingRules = pgTable(
  "pricing_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    kind: text("kind", { enum: PRICING_RULE_KINDS }).notNull(),
    condition: jsonb("condition").notNull().default(sql`'{}'::jsonb`),
    adjustmentType: text("adjustment_type", { enum: PRICING_ADJUSTMENT_TYPES }).notNull(),
    adjustmentValue: numeric("adjustment_value", { precision: 10, scale: 4 }).notNull(),
    priority: integer("priority").notNull().default(100),
    stopAfter: boolean("stop_after").notNull().default(false),
    appliesToRatePlanId: uuid("applies_to_rate_plan_id").references(() => ratePlans.id),
    appliesToRoomType: text("applies_to_room_type"),
    isActive: boolean("is_active").notNull().default(true),
    startsAt: date("starts_at"),
    endsAt: date("ends_at"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codePerProperty: uniqueIndex("pricing_rules_code_per_property").on(
      t.propertyId,
      t.code,
    ),
    activeIdx: index("idx_pricing_rules_active").on(t.propertyId, t.priority),
  }),
);

export type PricingRule = typeof pricingRules.$inferSelect;
export type NewPricingRule = typeof pricingRules.$inferInsert;
