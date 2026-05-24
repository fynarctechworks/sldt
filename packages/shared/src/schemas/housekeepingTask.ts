import { z } from "zod";

export const HOUSEKEEPING_TASK_TYPES = [
  "checkout_clean",
  "daily_refresh",
  "deep_clean",
  "inspection",
  "maintenance_followup",
  "custom",
] as const;
export type HousekeepingTaskType = (typeof HOUSEKEEPING_TASK_TYPES)[number];

export const HOUSEKEEPING_TASK_STATUSES = [
  "pending",
  "in_progress",
  "blocked",
  "done",
  "skipped",
] as const;
export type HousekeepingTaskStatus = (typeof HOUSEKEEPING_TASK_STATUSES)[number];

export const housekeepingTaskCreateSchema = z.object({
  roomId: z.string().uuid(),
  reservationId: z.string().uuid().optional().nullable(),
  taskType: z.enum(HOUSEKEEPING_TASK_TYPES).default("checkout_clean"),
  priority: z.coerce.number().int().min(0).max(100).default(50),
  assignedTo: z.string().uuid().optional().nullable(),
  dueAt: z.string().datetime({ offset: true }).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  // When true, seed the task with the default checklist for the task_type.
  // The default lives in apps/api/src/db/schema/housekeepingTasks.ts.
  useDefaultSteps: z.boolean().default(true),
  customSteps: z.array(z.string().min(1).max(120)).max(40).optional(),
});

export const housekeepingTaskUpdateSchema = z.object({
  priority: z.coerce.number().int().min(0).max(100).optional(),
  status: z.enum(HOUSEKEEPING_TASK_STATUSES).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export const housekeepingTaskListQuerySchema = z.object({
  status: z.enum(HOUSEKEEPING_TASK_STATUSES).optional(),
  taskType: z.enum(HOUSEKEEPING_TASK_TYPES).optional(),
  assignedTo: z.string().uuid().optional(),
  roomId: z.string().uuid().optional(),
  // 'open' = pending | in_progress | blocked. Shortcut for the
  // default housekeeping inbox view.
  openOnly: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .transform((v) => v === true || v === "true")
    .default("true"),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(50),
});

export const housekeepingTaskStepUpdateSchema = z.object({
  isDone: z.boolean(),
});

export const housekeepingTaskStepCreateSchema = z.object({
  label: z.string().min(1).max(120),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
});

export type HousekeepingTaskCreateInput = z.infer<typeof housekeepingTaskCreateSchema>;
export type HousekeepingTaskUpdateInput = z.infer<typeof housekeepingTaskUpdateSchema>;
export type HousekeepingTaskListQuery = z.infer<typeof housekeepingTaskListQuerySchema>;
