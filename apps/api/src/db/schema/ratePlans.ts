// Rate plans, rate calendar, and seasons.
//
// rate_plans  = named pricing strategy (BAR, WEEKEND, CORP, OTA).
// rate_calendar = per-day override grid: (rate_plan, room_type, date)
//                 → explicit rate, inventory cap, LOS / arrival/departure
//                 restrictions. Empty rows mean "use base modifier".
// seasons     = bulk-edit helpers (peak / shoulder / festival X) with
//               a start/end date and a multiplier. Not a runtime
//               input — operators "apply" them into the calendar.

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
import { properties } from "./properties.js";

export const ratePlans = pgTable(
  "rate_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    baseModifier: numeric("base_modifier", { precision: 5, scale: 3 })
      .notNull()
      .default("1.000"),
    minLengthOfStay: integer("min_length_of_stay"),
    maxLengthOfStay: integer("max_length_of_stay"),
    closedToArrival: boolean("closed_to_arrival").notNull().default(false),
    closedToDeparture: boolean("closed_to_departure").notNull().default(false),
    isPublic: boolean("is_public").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    isDefault: boolean("is_default").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(100),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codePerProperty: uniqueIndex("rate_plans_code_per_property").on(
      t.propertyId,
      t.code,
    ),
    // One default per property. Partial unique index on (property_id)
    // where is_default = true. Drizzle's uniqueIndex on a single column
    // is enough; the partial WHERE is added at the SQL layer in 0013.
    oneDefaultPerProperty: uniqueIndex("uq_rate_plans_one_default_per_property").on(
      t.propertyId,
    ),
  }),
);

export const rateCalendar = pgTable(
  "rate_calendar",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ratePlanId: uuid("rate_plan_id")
      .notNull()
      .references(() => ratePlans.id, { onDelete: "cascade" }),
    roomType: text("room_type").notNull(),
    date: date("date").notNull(),
    rateOverride: numeric("rate_override", { precision: 10, scale: 2 }),
    roomsAvailable: integer("rooms_available"),
    minLengthOfStay: integer("min_length_of_stay"),
    maxLengthOfStay: integer("max_length_of_stay"),
    closedToArrival: boolean("closed_to_arrival"),
    closedToDeparture: boolean("closed_to_departure"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniquePerDay: uniqueIndex("rate_calendar_unique_per_day").on(
      t.ratePlanId,
      t.roomType,
      t.date,
    ),
    lookup: index("idx_rate_calendar_lookup").on(t.roomType, t.date, t.ratePlanId),
  }),
);

export const seasons = pgTable(
  "seasons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id),
    name: text("name").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    modifier: numeric("modifier", { precision: 5, scale: 3 }).notNull().default("1.000"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byPropertyDates: index("idx_seasons_property_dates").on(
      t.propertyId,
      t.startDate,
      t.endDate,
    ),
  }),
);

export type RatePlan = typeof ratePlans.$inferSelect;
export type NewRatePlan = typeof ratePlans.$inferInsert;
export type RateCalendarEntry = typeof rateCalendar.$inferSelect;
export type NewRateCalendarEntry = typeof rateCalendar.$inferInsert;
export type Season = typeof seasons.$inferSelect;
export type NewSeason = typeof seasons.$inferInsert;
