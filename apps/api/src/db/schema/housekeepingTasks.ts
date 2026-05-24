// Housekeeping task workflow (Phase 2).
//
// Each housekeeping_task is a unit of work for a single room. On
// checkout the API auto-creates a `checkout_clean` task with a
// default checklist; staff pick it up from the housekeeping board,
// tick off the steps, and mark it done. The `rooms.status` column
// still flips between clean/dirty/inspected as a quick summary, but
// the truth of "who cleaned this room and when" lives here.
//
// We use Postgres ENUM types for task_type and status because (a) the
// finite set is unlikely to grow and (b) the partial index for
// "open tasks" benefits from enum equality being cheap.

import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { profiles } from "./profiles.js";
import { properties } from "./properties.js";
import { reservations } from "./reservations.js";
import { rooms } from "./rooms.js";

export const housekeepingTaskType = pgEnum("housekeeping_task_type", [
  "checkout_clean",
  "daily_refresh",
  "deep_clean",
  "inspection",
  "maintenance_followup",
  "custom",
]);
export type HousekeepingTaskType = (typeof housekeepingTaskType.enumValues)[number];

export const housekeepingTaskStatus = pgEnum("housekeeping_task_status", [
  "pending",
  "in_progress",
  "blocked",
  "done",
  "skipped",
]);
export type HousekeepingTaskStatus = (typeof housekeepingTaskStatus.enumValues)[number];

export const housekeepingTasks = pgTable(
  "housekeeping_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    reservationId: uuid("reservation_id").references(() => reservations.id, {
      onDelete: "set null",
    }),
    taskType: housekeepingTaskType("task_type").notNull().default("checkout_clean"),
    status: housekeepingTaskStatus("status").notNull().default("pending"),
    priority: integer("priority").notNull().default(50),
    assignedTo: uuid("assigned_to").references(() => profiles.id, {
      onDelete: "set null",
    }),
    assignedBy: uuid("assigned_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    byRoom: index("idx_housekeeping_tasks_room").on(t.roomId, t.createdAt),
    byAssignee: index("idx_housekeeping_tasks_assignee").on(t.assignedTo, t.status),
  }),
);

export const housekeepingTaskSteps = pgTable(
  "housekeeping_task_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => housekeepingTasks.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    isDone: boolean("is_done").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(100),
    doneAt: timestamp("done_at", { withTimezone: true }),
    doneBy: uuid("done_by").references(() => profiles.id, { onDelete: "set null" }),
  },
  (t) => ({
    byTask: index("idx_housekeeping_task_steps_task").on(t.taskId, t.sortOrder),
  }),
);

export type HousekeepingTask = typeof housekeepingTasks.$inferSelect;
export type NewHousekeepingTask = typeof housekeepingTasks.$inferInsert;
export type HousekeepingTaskStep = typeof housekeepingTaskSteps.$inferSelect;
export type NewHousekeepingTaskStep = typeof housekeepingTaskSteps.$inferInsert;

// Default checklists per task type. These are seeded when a task is
// auto-created (or manually created with `useDefaultSteps: true`).
// Operators can edit steps freely after the fact.
export const DEFAULT_TASK_STEPS: Record<HousekeepingTaskType, string[]> = {
  checkout_clean: [
    "Strip linens & towels",
    "Sanitise bathroom (toilet, basin, shower)",
    "Replace amenities (soap, shampoo, slippers)",
    "Wipe surfaces & dust",
    "Vacuum / mop floor",
    "Make bed with fresh linens",
    "Check minibar & restock",
    "Empty trash & line bins",
    "Final inspection & lock",
  ],
  daily_refresh: [
    "Tidy room & make bed",
    "Replace towels if requested",
    "Refresh toiletries",
    "Empty trash",
  ],
  deep_clean: [
    "Strip linens & curtains",
    "Move furniture & vacuum under",
    "Steam-clean mattress & sofa",
    "Descale bathroom fittings",
    "Clean windows inside & out",
    "Polish all wood surfaces",
    "Replace shower curtain liner",
    "Air conditioner filter clean",
  ],
  inspection: [
    "Verify housekeeping completion",
    "Check linens & towels count",
    "Test AC / TV / lights",
    "Check bathroom plumbing",
    "Verify key card / lock works",
  ],
  maintenance_followup: ["Verify reported issue resolved", "Document fix"],
  custom: [],
};
