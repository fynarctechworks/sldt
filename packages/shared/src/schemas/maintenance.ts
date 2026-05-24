import { z } from "zod";

export const MAINTENANCE_CATEGORIES = [
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
] as const;
export type MaintenanceCategory = (typeof MAINTENANCE_CATEGORIES)[number];

export const MAINTENANCE_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type MaintenancePriority = (typeof MAINTENANCE_PRIORITIES)[number];

export const MAINTENANCE_STATUSES = [
  "open",
  "triaged",
  "in_progress",
  "blocked",
  "resolved",
  "closed",
  "wont_fix",
] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export const maintenanceTicketCreateSchema = z.object({
  roomId: z.string().uuid().optional().nullable(),
  reservationId: z.string().uuid().optional().nullable(),
  category: z.enum(MAINTENANCE_CATEGORIES).default("other"),
  priority: z.enum(MAINTENANCE_PRIORITIES).default("medium"),
  title: z.string().min(3).max(200),
  description: z.string().max(2000).optional().nullable(),
  assignedTo: z.string().uuid().optional().nullable(),
  dueAt: z.string().datetime({ offset: true }).optional().nullable(),
  // When true, flip the linked room into 'maintenance' status until
  // the ticket is resolved. Requires roomId.
  blocksRoom: z.boolean().default(false),
  estimatedCost: z.coerce.number().min(0).max(10_000_000).optional().nullable(),
});

export const maintenanceTicketUpdateSchema = z.object({
  category: z.enum(MAINTENANCE_CATEGORIES).optional(),
  priority: z.enum(MAINTENANCE_PRIORITIES).optional(),
  title: z.string().min(3).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  blocksRoom: z.boolean().optional(),
  estimatedCost: z.coerce.number().min(0).max(10_000_000).nullable().optional(),
  actualCost: z.coerce.number().min(0).max(10_000_000).nullable().optional(),
});

export const maintenanceTicketStatusSchema = z.object({
  status: z.enum(MAINTENANCE_STATUSES),
  resolutionNotes: z.string().max(2000).optional().nullable(),
});

export const maintenanceTicketListQuerySchema = z.object({
  status: z.enum(MAINTENANCE_STATUSES).optional(),
  // 'open' = open|triaged|in_progress|blocked (default true).
  openOnly: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .transform((v) => v === true || v === "true")
    .default("true"),
  category: z.enum(MAINTENANCE_CATEGORIES).optional(),
  priority: z.enum(MAINTENANCE_PRIORITIES).optional(),
  roomId: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
});

export type MaintenanceTicketCreateInput = z.infer<typeof maintenanceTicketCreateSchema>;
export type MaintenanceTicketUpdateInput = z.infer<typeof maintenanceTicketUpdateSchema>;
export type MaintenanceTicketStatusInput = z.infer<typeof maintenanceTicketStatusSchema>;
export type MaintenanceTicketListQuery = z.infer<typeof maintenanceTicketListQuerySchema>;
