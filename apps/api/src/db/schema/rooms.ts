import {
  boolean,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { ROOM_STATUSES } from "./enums.js";

export const rooms = pgTable("rooms", {
  id: uuid("id").primaryKey().defaultRandom(),
  roomNumber: text("room_number").notNull().unique(),
  floor: integer("floor").notNull(),
  roomType: text("room_type").notNull(),
  baseRate: numeric("base_rate", { precision: 10, scale: 2 }).notNull(),
  maxOccupancy: integer("max_occupancy").notNull().default(2),
  hasAc: boolean("has_ac").notNull().default(true),
  hasTv: boolean("has_tv").notNull().default(true),
  hasWifi: boolean("has_wifi").notNull().default(true),
  status: text("status", { enum: ROOM_STATUSES }).notNull().default("available"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Room = typeof rooms.$inferSelect;
export type NewRoom = typeof rooms.$inferInsert;
