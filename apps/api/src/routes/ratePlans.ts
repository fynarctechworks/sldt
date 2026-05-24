// Rate plan + rate calendar + seasons API.
//
// Endpoints:
//   GET    /rate-plans                       — list (scoped to current property)
//   POST   /rate-plans                       — create
//   PATCH  /rate-plans/:id                   — update
//   DELETE /rate-plans/:id                   — soft-delete (is_active=false)
//
//   GET    /rate-plans/:id/calendar          — read the calendar grid
//                                              ?start=YYYY-MM-DD&end=YYYY-MM-DD
//                                              [&roomType=...]
//   POST   /rate-plans/:id/calendar/bulk-set — bulk patch a date range
//   GET    /rate-plans/lookup                — resolve the effective rate for
//                                              a (rate_plan, room_type, date)
//
//   GET    /seasons                          — list
//   POST   /seasons                          — create
//   PATCH  /seasons/:id                      — update / deactivate

import {
  rateCalendarBulkSetSchema,
  ratePlanCreateSchema,
  ratePlanLookupQuerySchema,
  ratePlanUpdateSchema,
  seasonCreateSchema,
} from "@hoteldesk/shared";
import { and, asc, between, eq, inArray, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { rateCalendar, ratePlans, seasons } from "../db/schema/ratePlans.js";
import { rooms } from "../db/schema/rooms.js";
import { logActivity } from "../lib/activity.js";
import { resolveCurrentPropertyId } from "../lib/currentProperty.js";
import { fail, list, ok } from "../lib/response.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const router = Router();

// ---------- Rate plans ----------

router.get(
  "/",
  requireAuth,
  requirePermission("view_rate_plans"),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const rows = await db
      .select()
      .from(ratePlans)
      .where(eq(ratePlans.propertyId, propertyId))
      .orderBy(asc(ratePlans.sortOrder), asc(ratePlans.name));
    return list(res, rows, { total: rows.length, page: 1, per_page: rows.length });
  },
);

router.post(
  "/",
  requireAuth,
  requirePermission("manage_rate_plans"),
  validate(ratePlanCreateSchema),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const input = req.body as z.infer<typeof ratePlanCreateSchema>;

    // Default-plan invariant: at most one is_default per property. If
    // the caller marks this one default, demote the previous default
    // inside a tx so we never sit between two defaults.
    const row = await db.transaction(async (tx) => {
      if (input.isDefault) {
        await tx
          .update(ratePlans)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(and(eq(ratePlans.propertyId, propertyId), eq(ratePlans.isDefault, true)));
      }
      const [r] = await tx
        .insert(ratePlans)
        .values({
          ...input,
          propertyId,
          baseModifier: String(input.baseModifier),
          description: input.description ?? null,
          minLengthOfStay: input.minLengthOfStay ?? null,
          maxLengthOfStay: input.maxLengthOfStay ?? null,
        })
        .returning();
      return r!;
    });

    await logActivity({
      action: "rate_plan_created",
      entityType: "rate_plan",
      entityId: row.id,
      description: `${row.code} (${row.name}) created`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    return ok(res, row);
  },
);

router.patch(
  "/:id",
  requireAuth,
  requirePermission("manage_rate_plans"),
  validate(ratePlanUpdateSchema),
  async (req, res) => {
    const id = req.params.id!;
    const propertyId = await resolveCurrentPropertyId(req);
    const patch = req.body as z.infer<typeof ratePlanUpdateSchema>;

    const updated = await db.transaction(async (tx) => {
      if (patch.isDefault === true) {
        await tx
          .update(ratePlans)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(
            and(
              eq(ratePlans.propertyId, propertyId),
              eq(ratePlans.isDefault, true),
              sql`${ratePlans.id} <> ${id}::uuid`,
            ),
          );
      }
      const [row] = await tx
        .update(ratePlans)
        .set({
          ...patch,
          baseModifier:
            patch.baseModifier !== undefined ? String(patch.baseModifier) : undefined,
          updatedAt: new Date(),
        })
        .where(and(eq(ratePlans.id, id), eq(ratePlans.propertyId, propertyId)))
        .returning();
      return row ?? null;
    });
    if (!updated) return fail(res, 404, "NOT_FOUND", "Rate plan not found");
    return ok(res, updated);
  },
);

router.delete(
  "/:id",
  requireAuth,
  requirePermission("manage_rate_plans"),
  async (req, res) => {
    const id = req.params.id!;
    const propertyId = await resolveCurrentPropertyId(req);
    // Hard-delete only if there are no calendar rows and no
    // reservations referencing it; otherwise soft-delete (is_active=false).
    // Reservations keep their rate_plan_code text snapshot regardless.
    const [plan] = await db
      .select()
      .from(ratePlans)
      .where(and(eq(ratePlans.id, id), eq(ratePlans.propertyId, propertyId)))
      .limit(1);
    if (!plan) return fail(res, 404, "NOT_FOUND", "Rate plan not found");
    if (plan.isDefault) {
      return fail(res, 409, "DEFAULT_PROTECTED", "Cannot delete the default rate plan. Promote another plan first.");
    }
    const [calCount] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(rateCalendar)
      .where(eq(rateCalendar.ratePlanId, id));
    if ((calCount?.c ?? 0) > 0) {
      const [updated] = await db
        .update(ratePlans)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(ratePlans.id, id))
        .returning();
      return ok(res, { soft: true, ratePlan: updated });
    }
    await db.delete(ratePlans).where(eq(ratePlans.id, id));
    return ok(res, { soft: false });
  },
);

// ---------- Rate calendar ----------

router.get(
  "/:id/calendar",
  requireAuth,
  requirePermission("view_rate_plans"),
  async (req, res) => {
    const ratePlanId = req.params.id!;
    const q = req.query as Record<string, string | undefined>;
    if (!q.start || !q.end) {
      return fail(res, 400, "MISSING_RANGE", "start and end query params are required (YYYY-MM-DD)");
    }
    const conditions = [
      eq(rateCalendar.ratePlanId, ratePlanId),
      between(rateCalendar.date, q.start, q.end),
    ];
    if (q.roomType) conditions.push(eq(rateCalendar.roomType, q.roomType));

    const rows = await db
      .select()
      .from(rateCalendar)
      .where(and(...conditions))
      .orderBy(asc(rateCalendar.date), asc(rateCalendar.roomType));
    return ok(res, rows);
  },
);

router.post(
  "/:id/calendar/bulk-set",
  requireAuth,
  requirePermission("manage_rate_plans"),
  validate(rateCalendarBulkSetSchema),
  async (req, res) => {
    const ratePlanId = req.params.id!;
    const body = req.body as z.infer<typeof rateCalendarBulkSetSchema>;

    if (body.startDate > body.endDate) {
      return fail(res, 400, "INVALID_RANGE", "startDate must be <= endDate");
    }
    if (body.ratePlanId !== ratePlanId) {
      return fail(res, 400, "MISMATCH", "ratePlanId in body must match URL");
    }

    // Generate the date list. Capped at 366 days so a typo doesn't
    // accidentally write a year+ of rows.
    const days: string[] = [];
    {
      const start = new Date(`${body.startDate}T00:00:00Z`);
      const end = new Date(`${body.endDate}T00:00:00Z`);
      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        days.push(d.toISOString().slice(0, 10));
      }
      if (days.length > 366) {
        return fail(res, 400, "RANGE_TOO_WIDE", "Bulk-set is capped at 366 days at a time");
      }
    }
    const allowedWeekdays = body.weekdays ?? [0, 1, 2, 3, 4, 5, 6];
    const filteredDays = days.filter((d) => {
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
      return allowedWeekdays.includes(dow);
    });

    // Materialize the (room_type × day) cells to upsert.
    const values = filteredDays.flatMap((date) =>
      body.roomTypes.map((roomType) => ({
        ratePlanId,
        roomType,
        date,
        rateOverride:
          body.patch.rateOverride === undefined
            ? undefined
            : body.patch.rateOverride === null
              ? null
              : String(body.patch.rateOverride),
        roomsAvailable: body.patch.roomsAvailable,
        minLengthOfStay: body.patch.minLengthOfStay,
        maxLengthOfStay: body.patch.maxLengthOfStay,
        closedToArrival: body.patch.closedToArrival ?? undefined,
        closedToDeparture: body.patch.closedToDeparture ?? undefined,
        notes: body.patch.notes,
      })),
    );

    if (!values.length) {
      return ok(res, { written: 0 });
    }

    await db.transaction(async (tx) => {
      // Chunk to keep individual statements small.
      const chunkSize = 500;
      for (let i = 0; i < values.length; i += chunkSize) {
        const chunk = values.slice(i, i + chunkSize);
        await tx
          .insert(rateCalendar)
          .values(chunk)
          .onConflictDoUpdate({
            target: [rateCalendar.ratePlanId, rateCalendar.roomType, rateCalendar.date],
            set: {
              rateOverride:
                body.patch.rateOverride === undefined
                  ? sql`${rateCalendar.rateOverride}`
                  : body.patch.rateOverride === null
                    ? null
                    : String(body.patch.rateOverride),
              roomsAvailable:
                body.patch.roomsAvailable === undefined
                  ? sql`${rateCalendar.roomsAvailable}`
                  : body.patch.roomsAvailable,
              minLengthOfStay:
                body.patch.minLengthOfStay === undefined
                  ? sql`${rateCalendar.minLengthOfStay}`
                  : body.patch.minLengthOfStay,
              maxLengthOfStay:
                body.patch.maxLengthOfStay === undefined
                  ? sql`${rateCalendar.maxLengthOfStay}`
                  : body.patch.maxLengthOfStay,
              closedToArrival:
                body.patch.closedToArrival === undefined
                  ? sql`${rateCalendar.closedToArrival}`
                  : body.patch.closedToArrival,
              closedToDeparture:
                body.patch.closedToDeparture === undefined
                  ? sql`${rateCalendar.closedToDeparture}`
                  : body.patch.closedToDeparture,
              notes:
                body.patch.notes === undefined
                  ? sql`${rateCalendar.notes}`
                  : body.patch.notes,
              updatedAt: new Date(),
            },
          });
      }
    });

    await logActivity({
      action: "rate_calendar_bulk_set",
      entityType: "rate_plan",
      entityId: ratePlanId,
      description: `${body.startDate} → ${body.endDate} · ${body.roomTypes.length} room type(s) · ${values.length} cells`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
      metadata: { startDate: body.startDate, endDate: body.endDate, patch: body.patch },
    });

    return ok(res, { written: values.length });
  },
);

// Resolve the effective price for a (room_type, date, [rate_plan]).
// Precedence:
//   1. rate_calendar.rate_override for the exact tuple
//   2. ratePlans.base_modifier × room.base_rate for that room_type
//   3. room.base_rate (no rate plan attached)
router.get(
  "/lookup",
  requireAuth,
  requirePermission("view_rate_plans"),
  validate(ratePlanLookupQuerySchema, "query"),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const q = req.query as unknown as z.infer<typeof ratePlanLookupQuerySchema>;

    // Pick the rate plan. Explicit id wins; else the property default.
    let plan: typeof ratePlans.$inferSelect | undefined;
    if (q.ratePlanId) {
      [plan] = await db
        .select()
        .from(ratePlans)
        .where(and(eq(ratePlans.id, q.ratePlanId), eq(ratePlans.propertyId, propertyId)))
        .limit(1);
    } else {
      [plan] = await db
        .select()
        .from(ratePlans)
        .where(
          and(
            eq(ratePlans.propertyId, propertyId),
            eq(ratePlans.isDefault, true),
            eq(ratePlans.isActive, true),
          ),
        )
        .limit(1);
    }

    // Base rate from the first room of the requested type. We pick the
    // cheapest base in case the property has heterogeneous rates for
    // the same type — operators can override per-room afterwards.
    const [baseRow] = await db
      .select({ baseRate: rooms.baseRate })
      .from(rooms)
      .where(and(eq(rooms.propertyId, propertyId), eq(rooms.roomType, q.roomType)))
      .orderBy(asc(rooms.baseRate))
      .limit(1);
    if (!baseRow) {
      return fail(res, 404, "NO_ROOMS", "No rooms of that type at the current property");
    }
    const base = Number(baseRow.baseRate);

    // Calendar override?
    let calendarOverride: number | null = null;
    let restrictions: {
      minLengthOfStay?: number | null;
      maxLengthOfStay?: number | null;
      closedToArrival?: boolean | null;
      closedToDeparture?: boolean | null;
      roomsAvailable?: number | null;
    } = {};
    if (plan) {
      const [cal] = await db
        .select()
        .from(rateCalendar)
        .where(
          and(
            eq(rateCalendar.ratePlanId, plan.id),
            eq(rateCalendar.roomType, q.roomType),
            eq(rateCalendar.date, q.date),
          ),
        )
        .limit(1);
      if (cal) {
        if (cal.rateOverride !== null) calendarOverride = Number(cal.rateOverride);
        restrictions = {
          minLengthOfStay: cal.minLengthOfStay ?? plan.minLengthOfStay,
          maxLengthOfStay: cal.maxLengthOfStay ?? plan.maxLengthOfStay,
          closedToArrival: cal.closedToArrival ?? plan.closedToArrival,
          closedToDeparture: cal.closedToDeparture ?? plan.closedToDeparture,
          roomsAvailable: cal.roomsAvailable,
        };
      } else {
        restrictions = {
          minLengthOfStay: plan.minLengthOfStay,
          maxLengthOfStay: plan.maxLengthOfStay,
          closedToArrival: plan.closedToArrival,
          closedToDeparture: plan.closedToDeparture,
        };
      }
    }

    const modifier = plan ? Number(plan.baseModifier) : 1;
    const rate =
      calendarOverride !== null ? calendarOverride : +(base * modifier).toFixed(2);

    return ok(res, {
      date: q.date,
      roomType: q.roomType,
      ratePlan: plan
        ? { id: plan.id, code: plan.code, name: plan.name, baseModifier: plan.baseModifier }
        : null,
      baseRate: base,
      modifier,
      rateOverride: calendarOverride,
      effectiveRate: rate,
      restrictions,
    });
  },
);

// ---------- Seasons (bulk-edit helpers) ----------

router.get(
  "/seasons/list",
  requireAuth,
  requirePermission("view_rate_plans"),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const rows = await db
      .select()
      .from(seasons)
      .where(eq(seasons.propertyId, propertyId))
      .orderBy(asc(seasons.startDate));
    return ok(res, rows);
  },
);

router.post(
  "/seasons/create",
  requireAuth,
  requirePermission("manage_rate_plans"),
  validate(seasonCreateSchema),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const input = req.body as z.infer<typeof seasonCreateSchema>;
    if (input.endDate < input.startDate) {
      return fail(res, 400, "INVALID_RANGE", "endDate must be >= startDate");
    }
    const [row] = await db
      .insert(seasons)
      .values({
        ...input,
        propertyId,
        modifier: String(input.modifier),
        notes: input.notes ?? null,
      })
      .returning();
    return ok(res, row);
  },
);

export default router;
