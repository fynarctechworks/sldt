// Pricing rules API. CRUD only — the engine that applies them lives
// in lib/pricingEngine.ts and is called by reservation create.
//
// Endpoints:
//   GET    /pricing-rules               — list (scoped to current property)
//   POST   /pricing-rules               — create
//   PATCH  /pricing-rules/:id           — update
//   DELETE /pricing-rules/:id           — archive (soft, is_active=false)
//   POST   /pricing-rules/preview       — compute a quote with rules applied

import { pricingRuleCreateSchema, pricingRuleUpdateSchema } from "@hoteldesk/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { pricingRules } from "../db/schema/pricingRules.js";
import { rooms } from "../db/schema/rooms.js";
import { logActivity } from "../lib/activity.js";
import { resolveCurrentPropertyId } from "../lib/currentProperty.js";
import { applyPricingRules } from "../lib/pricingEngine.js";
import { resolveEffectiveRate } from "../lib/ratePlanResolve.js";
import { fail, list, ok } from "../lib/response.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const router = Router();

router.get(
  "/",
  requireAuth,
  requirePermission("view_pricing_rules"),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const rows = await db
      .select()
      .from(pricingRules)
      .where(eq(pricingRules.propertyId, propertyId))
      .orderBy(asc(pricingRules.priority), asc(pricingRules.name));
    return list(res, rows, { total: rows.length, page: 1, per_page: rows.length });
  },
);

router.post(
  "/",
  requireAuth,
  requirePermission("manage_pricing_rules"),
  validate(pricingRuleCreateSchema),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const input = req.body as z.infer<typeof pricingRuleCreateSchema>;
    try {
      const [created] = await db
        .insert(pricingRules)
        .values({
          ...input,
          propertyId,
          adjustmentValue: String(input.adjustmentValue),
        })
        .returning();
      await logActivity({
        action: "pricing_rule_created",
        entityType: "pricing_rule",
        entityId: created!.id,
        description: `${created!.code} (${created!.name})`,
        performedBy: req.user!.id,
        ipAddress: req.ip,
      });
      return ok(res, created, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("pricing_rules_code_per_property")) {
        return fail(res, 409, "DUPLICATE_CODE", "A rule with that code already exists");
      }
      throw err;
    }
  },
);

router.patch(
  "/:id",
  requireAuth,
  requirePermission("manage_pricing_rules"),
  validate(pricingRuleUpdateSchema),
  async (req, res) => {
    const id = req.params.id!;
    const propertyId = await resolveCurrentPropertyId(req);
    const patch = req.body as z.infer<typeof pricingRuleUpdateSchema>;
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      if (k === "adjustmentValue") updateData[k] = String(v);
      else updateData[k] = v;
    }
    const [updated] = await db
      .update(pricingRules)
      .set(updateData)
      .where(and(eq(pricingRules.id, id), eq(pricingRules.propertyId, propertyId)))
      .returning();
    if (!updated) return fail(res, 404, "NOT_FOUND", "Rule not found");
    return ok(res, updated);
  },
);

router.delete(
  "/:id",
  requireAuth,
  requirePermission("manage_pricing_rules"),
  async (req, res) => {
    const id = req.params.id!;
    const propertyId = await resolveCurrentPropertyId(req);
    const [archived] = await db
      .update(pricingRules)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(pricingRules.id, id), eq(pricingRules.propertyId, propertyId)))
      .returning();
    if (!archived) return fail(res, 404, "NOT_FOUND", "Rule not found");
    return ok(res, { archived: archived.id });
  },
);

// Preview a price for a (room, date) tuple with all rules applied.
// Used by the Pricing Rules settings page so admins can see what the
// engine will do before bookings come in.
const previewSchema = z.object({
  roomId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ratePlanId: z.string().uuid().nullable().optional(),
  nights: z.coerce.number().int().min(1).max(60).default(1),
  forecastOccupancyPct: z.coerce.number().min(0).max(100).optional(),
});

router.post(
  "/preview",
  requireAuth,
  requirePermission("view_pricing_rules"),
  validate(previewSchema),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const input = req.body as z.infer<typeof previewSchema>;

    const [room] = await db
      .select({ id: rooms.id, roomType: rooms.roomType })
      .from(rooms)
      .where(and(eq(rooms.id, input.roomId), eq(rooms.propertyId, propertyId)))
      .limit(1);
    if (!room) return fail(res, 404, "ROOM_NOT_FOUND", "Room not found");

    const base = await resolveEffectiveRate({
      ratePlanId: input.ratePlanId ?? null,
      roomId: input.roomId,
      date: input.date,
    });
    const adjusted = await applyPricingRules({
      base: base.ratePerNight,
      context: {
        propertyId,
        date: input.date,
        roomType: room.roomType,
        ratePlanId: input.ratePlanId ?? null,
        nights: input.nights,
        forecastOccupancyPct: input.forecastOccupancyPct,
      },
    });
    return ok(res, {
      base: base.ratePerNight,
      baseSource: base.source,
      adjusted: adjusted.ratePerNight,
      appliedRules: adjusted.applied,
    });
  },
);

export default router;
