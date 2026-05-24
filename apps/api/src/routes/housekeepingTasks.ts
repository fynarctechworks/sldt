// Housekeeping tasks API (Phase 2).
//
// Endpoints:
//   GET    /housekeeping-tasks               — list with filters
//   POST   /housekeeping-tasks               — create (manual; auto-create
//                                              also happens on checkout via
//                                              the reservations route)
//   GET    /housekeeping-tasks/:id           — read with steps
//   PATCH  /housekeeping-tasks/:id           — update meta (priority, assignee,
//                                              due, notes, status with
//                                              state-machine enforcement)
//   POST   /housekeeping-tasks/:id/start     — convenience: status→in_progress
//   POST   /housekeeping-tasks/:id/complete  — convenience: status→done
//                                              (requires all steps done)
//   POST   /housekeeping-tasks/:id/steps     — append a step
//   PATCH  /housekeeping-tasks/:id/steps/:stepId — toggle is_done
//   DELETE /housekeeping-tasks/:id/steps/:stepId
//
// Auto-creation on checkout: a helper `enqueueCheckoutCleanTask` is
// exported and called from the reservations checkout flow.

import {
  housekeepingTaskCreateSchema,
  housekeepingTaskListQuerySchema,
  housekeepingTaskStepCreateSchema,
  housekeepingTaskStepUpdateSchema,
  housekeepingTaskUpdateSchema,
} from "@hoteldesk/shared";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { guests } from "../db/schema/guests.js";
import {
  DEFAULT_TASK_STEPS,
  housekeepingTaskSteps,
  housekeepingTasks,
  type HousekeepingTaskStatus,
  type HousekeepingTaskType,
} from "../db/schema/housekeepingTasks.js";
import { profiles } from "../db/schema/profiles.js";
import { reservations } from "../db/schema/reservations.js";
import { rooms } from "../db/schema/rooms.js";
import { logActivity } from "../lib/activity.js";
import { resolveCurrentPropertyId } from "../lib/currentProperty.js";
import { fail, list, ok } from "../lib/response.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const router = Router();

// State machine. Same shape as the maintenance one. The completion
// states (done, skipped) are terminal; nothing transitions out of them
// (a re-clean creates a new task).
const STATUS_TRANSITIONS: Record<HousekeepingTaskStatus, readonly HousekeepingTaskStatus[]> = {
  pending: ["in_progress", "blocked", "skipped"],
  in_progress: ["blocked", "done"],
  blocked: ["in_progress", "skipped"],
  done: [],
  skipped: [],
};

function canTransition(from: HousekeepingTaskStatus, to: HousekeepingTaskStatus): boolean {
  if (from === to) return true;
  return (STATUS_TRANSITIONS[from] ?? []).includes(to);
}

// ---------- Auto-create helper (exported for use in reservations.ts) ----------
//
// Inserts a `checkout_clean` task for the given room+reservation with
// the default step list. Idempotent: if an open task of this type for
// the same reservation already exists, returns it instead of duplicating.
export async function enqueueCheckoutCleanTask(args: {
  propertyId: string;
  roomId: string;
  reservationId: string;
  createdBy: string;
}): Promise<string> {
  const { propertyId, roomId, reservationId, createdBy } = args;
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: housekeepingTasks.id })
      .from(housekeepingTasks)
      .where(
        and(
          eq(housekeepingTasks.reservationId, reservationId),
          eq(housekeepingTasks.taskType, "checkout_clean"),
          inArray(housekeepingTasks.status, ["pending", "in_progress", "blocked"]),
        ),
      )
      .limit(1);
    if (existing) return existing.id;

    const [task] = await tx
      .insert(housekeepingTasks)
      .values({
        propertyId,
        roomId,
        reservationId,
        taskType: "checkout_clean",
        status: "pending",
        priority: 70,
        createdBy,
      })
      .returning({ id: housekeepingTasks.id });
    const taskId = task!.id;

    const steps = DEFAULT_TASK_STEPS.checkout_clean.map((label, i) => ({
      taskId,
      label,
      sortOrder: (i + 1) * 10,
    }));
    if (steps.length) await tx.insert(housekeepingTaskSteps).values(steps);

    return taskId;
  });
}

// ---------- Routes ----------

router.get(
  "/",
  requireAuth,
  requirePermission("view_housekeeping_tasks"),
  validate(housekeepingTaskListQuerySchema, "query"),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const q = req.query as unknown as z.infer<typeof housekeepingTaskListQuerySchema>;

    const conditions = [eq(housekeepingTasks.propertyId, propertyId)];
    if (q.status) conditions.push(eq(housekeepingTasks.status, q.status));
    if (q.taskType) conditions.push(eq(housekeepingTasks.taskType, q.taskType));
    if (q.assignedTo) conditions.push(eq(housekeepingTasks.assignedTo, q.assignedTo));
    if (q.roomId) conditions.push(eq(housekeepingTasks.roomId, q.roomId));
    if (q.openOnly && !q.status) {
      conditions.push(
        inArray(housekeepingTasks.status, ["pending", "in_progress", "blocked"] as const),
      );
    }

    const rows = await db
      .select({
        task: housekeepingTasks,
        roomNumber: rooms.roomNumber,
        floor: rooms.floor,
        roomType: rooms.roomType,
        assigneeName: profiles.fullName,
      })
      .from(housekeepingTasks)
      .innerJoin(rooms, eq(rooms.id, housekeepingTasks.roomId))
      .leftJoin(profiles, eq(profiles.id, housekeepingTasks.assignedTo))
      .where(and(...conditions))
      .orderBy(
        // Critical first, then oldest first within priority.
        desc(housekeepingTasks.priority),
        asc(housekeepingTasks.createdAt),
      )
      .limit(q.per_page)
      .offset((q.page - 1) * q.per_page);

    const [count] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(housekeepingTasks)
      .where(and(...conditions));

    return list(
      res,
      rows.map((r) => ({
        ...r.task,
        roomNumber: r.roomNumber,
        floor: r.floor,
        roomType: r.roomType,
        assigneeName: r.assigneeName,
      })),
      { total: count?.c ?? 0, page: q.page, per_page: q.per_page },
    );
  },
);

router.post(
  "/",
  requireAuth,
  requirePermission("view_housekeeping_tasks"),
  validate(housekeepingTaskCreateSchema),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const input = req.body as z.infer<typeof housekeepingTaskCreateSchema>;

    const [room] = await db
      .select({ id: rooms.id, propertyId: rooms.propertyId })
      .from(rooms)
      .where(eq(rooms.id, input.roomId))
      .limit(1);
    if (!room) return fail(res, 404, "ROOM_NOT_FOUND", "Room not found");
    if (room.propertyId !== propertyId) {
      return fail(res, 403, "CROSS_PROPERTY", "Room belongs to a different property");
    }

    const created = await db.transaction(async (tx) => {
      const [task] = await tx
        .insert(housekeepingTasks)
        .values({
          propertyId,
          roomId: input.roomId,
          reservationId: input.reservationId ?? null,
          taskType: input.taskType,
          priority: input.priority,
          assignedTo: input.assignedTo ?? null,
          assignedBy: input.assignedTo ? req.user!.id : null,
          assignedAt: input.assignedTo ? new Date() : null,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          notes: input.notes ?? null,
          createdBy: req.user!.id,
        })
        .returning();
      const taskId = task!.id;

      const stepLabels = input.useDefaultSteps
        ? DEFAULT_TASK_STEPS[input.taskType as HousekeepingTaskType] ?? []
        : input.customSteps ?? [];
      if (stepLabels.length) {
        await tx.insert(housekeepingTaskSteps).values(
          stepLabels.map((label, i) => ({
            taskId,
            label,
            sortOrder: (i + 1) * 10,
          })),
        );
      }
      return task!;
    });

    await logActivity({
      action: "housekeeping_task_created",
      entityType: "housekeeping_task",
      entityId: created.id,
      description: `${created.taskType} task for room`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
      metadata: { roomId: input.roomId, taskType: created.taskType },
    });
    return ok(res, created);
  },
);

router.get(
  "/:id",
  requireAuth,
  requirePermission("view_housekeeping_tasks"),
  async (req, res) => {
    const id = req.params.id!;
    const propertyId = await resolveCurrentPropertyId(req);
    const [task] = await db
      .select()
      .from(housekeepingTasks)
      .where(and(eq(housekeepingTasks.id, id), eq(housekeepingTasks.propertyId, propertyId)))
      .limit(1);
    if (!task) return fail(res, 404, "NOT_FOUND", "Task not found");

    const [steps, [room], [reservation]] = await Promise.all([
      db
        .select()
        .from(housekeepingTaskSteps)
        .where(eq(housekeepingTaskSteps.taskId, id))
        .orderBy(asc(housekeepingTaskSteps.sortOrder)),
      db
        .select({ id: rooms.id, roomNumber: rooms.roomNumber, floor: rooms.floor, roomType: rooms.roomType, status: rooms.status })
        .from(rooms)
        .where(eq(rooms.id, task.roomId))
        .limit(1),
      task.reservationId
        ? db
            .select({
              id: reservations.id,
              reservationNumber: reservations.reservationNumber,
              guestName: guests.fullName,
              checkOutDate: reservations.checkOutDate,
            })
            .from(reservations)
            .innerJoin(guests, eq(guests.id, reservations.guestId))
            .where(eq(reservations.id, task.reservationId))
            .limit(1)
        : Promise.resolve([] as Array<{ id: string; reservationNumber: string; guestName: string; checkOutDate: string }>),
    ]);

    return ok(res, {
      ...task,
      steps,
      room: room ?? null,
      reservation: reservation ?? null,
    });
  },
);

router.patch(
  "/:id",
  requireAuth,
  requirePermission("view_housekeeping_tasks"),
  validate(housekeepingTaskUpdateSchema),
  async (req, res) => {
    const id = req.params.id!;
    const propertyId = await resolveCurrentPropertyId(req);
    const patch = req.body as z.infer<typeof housekeepingTaskUpdateSchema>;

    const [existing] = await db
      .select()
      .from(housekeepingTasks)
      .where(and(eq(housekeepingTasks.id, id), eq(housekeepingTasks.propertyId, propertyId)))
      .limit(1);
    if (!existing) return fail(res, 404, "NOT_FOUND", "Task not found");

    // Status change rules.
    if (patch.status && patch.status !== existing.status) {
      if (!canTransition(existing.status, patch.status)) {
        return fail(
          res,
          409,
          "INVALID_TRANSITION",
          `Cannot transition ${existing.status} → ${patch.status}`,
        );
      }
      // Completion requires all steps done. (Skipped doesn't.)
      if (patch.status === "done") {
        const [openSteps] = await db
          .select({ c: sql<number>`count(*)::int` })
          .from(housekeepingTaskSteps)
          .where(
            and(
              eq(housekeepingTaskSteps.taskId, id),
              eq(housekeepingTaskSteps.isDone, false),
            ),
          );
        if ((openSteps?.c ?? 0) > 0) {
          return fail(res, 409, "STEPS_OPEN", "All checklist steps must be done to complete the task");
        }
      }
    }

    // Assignment changes require the assign_housekeeping_tasks
    // permission. We can't add a second middleware after validate, so
    // we check inline.
    if (
      patch.assignedTo !== undefined &&
      patch.assignedTo !== existing.assignedTo
    ) {
      // permission resolver lives in the auth middleware; here we
      // re-check by querying req.user's role-permissions snapshot.
      const userPerms = (req.user as unknown as { permissions?: string[] }).permissions ?? [];
      if (!userPerms.includes("assign_housekeeping_tasks") && !userPerms.includes("*")) {
        return fail(res, 403, "FORBIDDEN", "assign_housekeeping_tasks permission required to change assignee");
      }
    }

    const now = new Date();
    const updateData: Record<string, unknown> = {};
    if (patch.priority !== undefined) updateData.priority = patch.priority;
    if (patch.notes !== undefined) updateData.notes = patch.notes;
    if (patch.dueAt !== undefined) {
      updateData.dueAt = patch.dueAt ? new Date(patch.dueAt) : null;
    }
    if (patch.assignedTo !== undefined) {
      updateData.assignedTo = patch.assignedTo;
      updateData.assignedBy = patch.assignedTo ? req.user!.id : null;
      updateData.assignedAt = patch.assignedTo ? now : null;
    }
    if (patch.status !== undefined) {
      updateData.status = patch.status;
      if (patch.status === "in_progress" && !existing.startedAt) updateData.startedAt = now;
      if (patch.status === "done") {
        updateData.completedAt = now;
        updateData.completedBy = req.user!.id;
      }
    }

    const [updated] = await db
      .update(housekeepingTasks)
      .set(updateData)
      .where(eq(housekeepingTasks.id, id))
      .returning();

    return ok(res, updated);
  },
);

router.post(
  "/:id/start",
  requireAuth,
  requirePermission("complete_housekeeping_tasks"),
  async (req, res) => {
    const id = req.params.id!;
    const propertyId = await resolveCurrentPropertyId(req);
    const [existing] = await db
      .select()
      .from(housekeepingTasks)
      .where(and(eq(housekeepingTasks.id, id), eq(housekeepingTasks.propertyId, propertyId)))
      .limit(1);
    if (!existing) return fail(res, 404, "NOT_FOUND", "Task not found");
    if (!canTransition(existing.status, "in_progress")) {
      return fail(res, 409, "INVALID_TRANSITION", `Cannot start a ${existing.status} task`);
    }
    const [updated] = await db
      .update(housekeepingTasks)
      .set({
        status: "in_progress",
        startedAt: existing.startedAt ?? new Date(),
        assignedTo: existing.assignedTo ?? req.user!.id,
        assignedAt: existing.assignedAt ?? new Date(),
      })
      .where(eq(housekeepingTasks.id, id))
      .returning();
    return ok(res, updated);
  },
);

router.post(
  "/:id/complete",
  requireAuth,
  requirePermission("complete_housekeeping_tasks"),
  async (req, res) => {
    const id = req.params.id!;
    const propertyId = await resolveCurrentPropertyId(req);
    const [existing] = await db
      .select()
      .from(housekeepingTasks)
      .where(and(eq(housekeepingTasks.id, id), eq(housekeepingTasks.propertyId, propertyId)))
      .limit(1);
    if (!existing) return fail(res, 404, "NOT_FOUND", "Task not found");
    if (!canTransition(existing.status, "done")) {
      return fail(res, 409, "INVALID_TRANSITION", `Cannot complete a ${existing.status} task`);
    }
    const [openSteps] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(housekeepingTaskSteps)
      .where(and(eq(housekeepingTaskSteps.taskId, id), eq(housekeepingTaskSteps.isDone, false)));
    if ((openSteps?.c ?? 0) > 0) {
      return fail(res, 409, "STEPS_OPEN", "Tick every step before completing the task");
    }
    const now = new Date();
    const updated = await db.transaction(async (tx) => {
      const [task] = await tx
        .update(housekeepingTasks)
        .set({ status: "done", completedAt: now, completedBy: req.user!.id })
        .where(eq(housekeepingTasks.id, id))
        .returning();
      // Side effect: bump the room status to 'clean' for checkout
      // cleans. We deliberately don't go all the way to inspected —
      // an inspection task or front-desk action handles that.
      if (task && task.taskType === "checkout_clean") {
        await tx
          .update(rooms)
          .set({ status: "clean", updatedAt: now })
          .where(eq(rooms.id, task.roomId));
      }
      return task!;
    });
    return ok(res, updated);
  },
);

router.post(
  "/:id/steps",
  requireAuth,
  requirePermission("view_housekeeping_tasks"),
  validate(housekeepingTaskStepCreateSchema),
  async (req, res) => {
    const id = req.params.id!;
    const propertyId = await resolveCurrentPropertyId(req);
    const input = req.body as z.infer<typeof housekeepingTaskStepCreateSchema>;
    const [task] = await db
      .select({ id: housekeepingTasks.id })
      .from(housekeepingTasks)
      .where(and(eq(housekeepingTasks.id, id), eq(housekeepingTasks.propertyId, propertyId)))
      .limit(1);
    if (!task) return fail(res, 404, "NOT_FOUND", "Task not found");

    const [maxOrder] = await db
      .select({ m: sql<number>`COALESCE(MAX(${housekeepingTaskSteps.sortOrder}), 0)::int` })
      .from(housekeepingTaskSteps)
      .where(eq(housekeepingTaskSteps.taskId, id));
    const nextOrder = input.sortOrder ?? (maxOrder?.m ?? 0) + 10;

    const [row] = await db
      .insert(housekeepingTaskSteps)
      .values({ taskId: id, label: input.label, sortOrder: nextOrder })
      .returning();
    return ok(res, row);
  },
);

router.patch(
  "/:id/steps/:stepId",
  requireAuth,
  requirePermission("complete_housekeeping_tasks"),
  validate(housekeepingTaskStepUpdateSchema),
  async (req, res) => {
    const { id, stepId } = req.params as { id: string; stepId: string };
    const propertyId = await resolveCurrentPropertyId(req);
    const { isDone } = req.body as z.infer<typeof housekeepingTaskStepUpdateSchema>;
    // Ensure the step belongs to a task in the current property.
    const [step] = await db
      .select({ taskId: housekeepingTaskSteps.taskId })
      .from(housekeepingTaskSteps)
      .innerJoin(housekeepingTasks, eq(housekeepingTasks.id, housekeepingTaskSteps.taskId))
      .where(
        and(
          eq(housekeepingTaskSteps.id, stepId),
          eq(housekeepingTasks.id, id),
          eq(housekeepingTasks.propertyId, propertyId),
        ),
      )
      .limit(1);
    if (!step) return fail(res, 404, "NOT_FOUND", "Step not found");

    const [updated] = await db
      .update(housekeepingTaskSteps)
      .set({
        isDone,
        doneAt: isDone ? new Date() : null,
        doneBy: isDone ? req.user!.id : null,
      })
      .where(eq(housekeepingTaskSteps.id, stepId))
      .returning();
    return ok(res, updated);
  },
);

router.delete(
  "/:id/steps/:stepId",
  requireAuth,
  requirePermission("view_housekeeping_tasks"),
  async (req, res) => {
    const { id, stepId } = req.params as { id: string; stepId: string };
    const propertyId = await resolveCurrentPropertyId(req);
    const [step] = await db
      .select({ id: housekeepingTaskSteps.id })
      .from(housekeepingTaskSteps)
      .innerJoin(housekeepingTasks, eq(housekeepingTasks.id, housekeepingTaskSteps.taskId))
      .where(
        and(
          eq(housekeepingTaskSteps.id, stepId),
          eq(housekeepingTasks.id, id),
          eq(housekeepingTasks.propertyId, propertyId),
        ),
      )
      .limit(1);
    if (!step) return fail(res, 404, "NOT_FOUND", "Step not found");
    await db.delete(housekeepingTaskSteps).where(eq(housekeepingTaskSteps.id, stepId));
    return ok(res, { deleted: stepId });
  },
);

export default router;
