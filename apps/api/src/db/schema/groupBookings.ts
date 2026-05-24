// Group bookings — master confirmation + rooming list.
//
// One group_block reserves N rooms over a date range for a single
// "group" (wedding, conference, corporate offsite). The group's
// rooming list is held in group_block_rooms; each entry can be
// promoted into a real reservation when the guest's details firm up.

import {
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
import { profiles } from "./profiles.js";
import { properties } from "./properties.js";
import { ratePlans } from "./ratePlans.js";
import { reservations } from "./reservations.js";
import { rooms } from "./rooms.js";

export const GROUP_BLOCK_STATUSES = [
  "tentative",
  "confirmed",
  "partial",
  "closed",
  "cancelled",
] as const;
export type GroupBlockStatus = (typeof GROUP_BLOCK_STATUSES)[number];

export const GROUP_ROOM_STATUSES = [
  "pending",
  "confirmed",
  "no_show",
  "released",
  "cancelled",
] as const;
export type GroupRoomStatus = (typeof GROUP_ROOM_STATUSES)[number];

export const groupBlocks = pgTable(
  "group_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id),
    groupCode: text("group_code").notNull(),
    groupName: text("group_name").notNull(),
    contactName: text("contact_name"),
    contactPhone: text("contact_phone"),
    contactEmail: text("contact_email"),
    companyId: uuid("company_id").references(() => companies.id),
    ratePlanId: uuid("rate_plan_id").references(() => ratePlans.id),
    blockStartDate: date("block_start_date").notNull(),
    blockEndDate: date("block_end_date").notNull(),
    cutoffDate: date("cutoff_date"),
    roomsBlocked: integer("rooms_blocked").notNull().default(0),
    roomsPickedUp: integer("rooms_picked_up").notNull().default(0),
    status: text("status", { enum: GROUP_BLOCK_STATUSES }).notNull().default("tentative"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => profiles.id),
  },
  (t) => ({
    codePerProperty: uniqueIndex("group_blocks_code_per_property").on(
      t.propertyId,
      t.groupCode,
    ),
    activeIdx: index("idx_group_blocks_active").on(
      t.propertyId,
      t.status,
      t.blockStartDate,
    ),
  }),
);

export const groupBlockRooms = pgTable(
  "group_block_rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupBlockId: uuid("group_block_id")
      .notNull()
      .references(() => groupBlocks.id, { onDelete: "cascade" }),
    roomType: text("room_type"),
    roomId: uuid("room_id").references(() => rooms.id),
    guestName: text("guest_name"),
    guestPhone: text("guest_phone"),
    guestEmail: text("guest_email"),
    ratePerNight: numeric("rate_per_night", { precision: 10, scale: 2 }),
    numAdults: integer("num_adults").notNull().default(1),
    numChildren: integer("num_children").notNull().default(0),
    reservationId: uuid("reservation_id").references(() => reservations.id),
    status: text("status", { enum: GROUP_ROOM_STATUSES }).notNull().default("pending"),
    notes: text("notes"),
  },
  (t) => ({
    byBlock: index("idx_group_block_rooms_block").on(t.groupBlockId),
  }),
);

export type GroupBlock = typeof groupBlocks.$inferSelect;
export type NewGroupBlock = typeof groupBlocks.$inferInsert;
export type GroupBlockRoom = typeof groupBlockRooms.$inferSelect;
export type NewGroupBlockRoom = typeof groupBlockRooms.$inferInsert;
