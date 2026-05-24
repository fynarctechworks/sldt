// Maintenance tickets (Phase 2).
//
// A ticket = one incident on a room (AC broken, leaking tap, etc.).
// Different from housekeeping_tasks: tasks are recurring stay hygiene,
// tickets are individual issues with a category, priority, photos,
// and a resolution. Tickets can `blocks_room=true` to flip the linked
// room into maintenance status until the ticket is resolved.
//
// Numbering: SLDT-MNT-NNNN, allocated from the sldt_maintenance_seq
// Postgres sequence (created in 0013).

import {
  boolean,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./profiles.js";
import { properties } from "./properties.js";
import { reservations } from "./reservations.js";
import { rooms } from "./rooms.js";

export const maintenanceCategory = pgEnum("maintenance_category", [
  "plumbing",
  "electrical",
  "ac_heating",
  "furniture",
  "appliances",
  "tv_internet",
  "locks_safety",
  "painting_walls",
  "flooring",
  "other",
]);
export type MaintenanceCategory = (typeof maintenanceCategory.enumValues)[number];

export const maintenancePriority = pgEnum("maintenance_priority", [
  "low",
  "medium",
  "high",
  "urgent",
]);
export type MaintenancePriority = (typeof maintenancePriority.enumValues)[number];

export const maintenanceStatus = pgEnum("maintenance_status", [
  "open",
  "triaged",
  "in_progress",
  "blocked",
  "resolved",
  "closed",
  "wont_fix",
]);
export type MaintenanceStatus = (typeof maintenanceStatus.enumValues)[number];

export const maintenanceTickets = pgTable(
  "maintenance_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketNumber: text("ticket_number").notNull().unique(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id),
    roomId: uuid("room_id").references(() => rooms.id, { onDelete: "set null" }),
    reservationId: uuid("reservation_id").references(() => reservations.id, {
      onDelete: "set null",
    }),
    category: maintenanceCategory("category").notNull().default("other"),
    priority: maintenancePriority("priority").notNull().default("medium"),
    status: maintenanceStatus("status").notNull().default("open"),
    title: text("title").notNull(),
    description: text("description"),
    reportedBy: uuid("reported_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    assignedTo: uuid("assigned_to").references(() => profiles.id, {
      onDelete: "set null",
    }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    blocksRoom: boolean("blocks_room").notNull().default(false),
    estimatedCost: numeric("estimated_cost", { precision: 10, scale: 2 }),
    actualCost: numeric("actual_cost", { precision: 10, scale: 2 }),
    resolutionNotes: text("resolution_notes"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byRoom: index("idx_maintenance_tickets_room").on(t.roomId, t.status),
    byAssignee: index("idx_maintenance_tickets_assignee").on(t.assignedTo, t.status),
  }),
);

export const maintenanceTicketPhotos = pgTable(
  "maintenance_ticket_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => maintenanceTickets.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    storagePath: text("storage_path"),
    caption: text("caption"),
    uploadedBy: uuid("uploaded_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTicket: index("idx_maintenance_ticket_photos_ticket").on(
      t.ticketId,
      t.uploadedAt,
    ),
  }),
);

export const maintenanceTicketEvents = pgTable(
  "maintenance_ticket_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => maintenanceTickets.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    description: text("description"),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    actorId: uuid("actor_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTicket: index("idx_maintenance_ticket_events_ticket").on(
      t.ticketId,
      t.createdAt,
    ),
  }),
);

export type MaintenanceTicket = typeof maintenanceTickets.$inferSelect;
export type NewMaintenanceTicket = typeof maintenanceTickets.$inferInsert;
export type MaintenanceTicketPhoto = typeof maintenanceTicketPhotos.$inferSelect;
export type MaintenanceTicketEvent = typeof maintenanceTicketEvents.$inferSelect;

// Set of statuses that count as "still on the inbox" for filtering.
// Anything not in this set is hidden from the default list view.
export const MAINTENANCE_OPEN_STATUSES: readonly MaintenanceStatus[] = [
  "open",
  "triaged",
  "in_progress",
  "blocked",
];

// Allowed status transitions. We enforce this in the route handler so
// the audit trail is meaningful (no jumping from open → closed without
// passing through resolved).
export const MAINTENANCE_STATUS_TRANSITIONS: Record<
  MaintenanceStatus,
  readonly MaintenanceStatus[]
> = {
  open:        ["triaged","in_progress","wont_fix","resolved"],
  triaged:     ["in_progress","blocked","wont_fix","resolved"],
  in_progress: ["blocked","resolved","wont_fix"],
  blocked:     ["in_progress","wont_fix","resolved"],
  resolved:    ["closed","in_progress"],   // reopen path
  closed:      ["in_progress"],             // reopen
  wont_fix:    ["in_progress"],             // reopen
};
