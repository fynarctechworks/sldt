// Night audit — frozen daily snapshot of revenue + occupancy + ops.
//
// One row per business_date. Running again for the same date overwrites
// (idempotent close-of-day). The snapshot column holds the long tail
// of metrics that don't earn a top-level column.

import {
  date,
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
import { profiles } from "./profiles.js";
import { properties } from "./properties.js";

export const NIGHT_AUDIT_STATUSES = ["running", "completed", "failed"] as const;
export type NightAuditStatus = (typeof NIGHT_AUDIT_STATUSES)[number];

export const nightAuditRuns = pgTable(
  "night_audit_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id),
    businessDate: date("business_date").notNull(),
    roomsSold: integer("rooms_sold").notNull().default(0),
    roomsAvailable: integer("rooms_available").notNull().default(0),
    occupancyPct: numeric("occupancy_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    roomRevenue: numeric("room_revenue", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    additionalRevenue: numeric("additional_revenue", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    totalRevenue: numeric("total_revenue", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    gstCollected: numeric("gst_collected", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    adr: numeric("adr", { precision: 12, scale: 2 }).notNull().default("0"),
    revpar: numeric("revpar", { precision: 12, scale: 2 }).notNull().default("0"),
    arrivals: integer("arrivals").notNull().default(0),
    departures: integer("departures").notNull().default(0),
    noShows: integer("no_shows").notNull().default(0),
    cancellations: integer("cancellations").notNull().default(0),
    walkIns: integer("walk_ins").notNull().default(0),
    snapshot: jsonb("snapshot").notNull().default(sql`'{}'::jsonb`),
    status: text("status", { enum: NIGHT_AUDIT_STATUSES }).notNull().default("completed"),
    ranBy: uuid("ran_by").references(() => profiles.id),
    ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniquePerDay: uniqueIndex("night_audit_runs_unique_per_day").on(
      t.propertyId,
      t.businessDate,
    ),
  }),
);

export type NightAuditRun = typeof nightAuditRuns.$inferSelect;
export type NewNightAuditRun = typeof nightAuditRuns.$inferInsert;
