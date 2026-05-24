// Pricing engine — applies pricing_rules in priority order on top of a
// base per-night rate. Called by reservation create AFTER the rate-plan
// resolver, and by the public quote endpoint for the booking widget.
//
// The engine is deliberately stateless: callers pass in the context
// (date, room_type, rate_plan, nights, occupancy_pct), the engine reads
// active rules and returns the adjusted rate + the list of applied
// rules (for receipt audit + UI display).

import { and, asc, eq, gte, lte, or, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { pricingRules, type PricingRule } from "../db/schema/pricingRules.js";

type Db = typeof db;
type Exec = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface PricingContext {
  propertyId: string;
  date: string;          // yyyy-MM-dd of the night being priced
  roomType: string;
  ratePlanId?: string | null;
  nights: number;        // total stay length
  bookedAt?: string;     // ISO instant when the booking was made; defaults to now
  forecastOccupancyPct?: number; // 0-100; supplied by caller (uses dashboard helper)
}

export interface AppliedRule {
  id: string;
  code: string;
  name: string;
  adjustmentType: "multiplier" | "flat";
  adjustmentValue: number;
  before: number;
  after: number;
}

export interface PriceResult {
  ratePerNight: number;
  applied: AppliedRule[];
}

// Test whether a rule matches a given context. We push as much as
// possible into the WHERE clause (date/property/active), and evaluate
// the kind-specific condition here.
function ruleMatches(rule: PricingRule, ctx: PricingContext): boolean {
  // Date-range gating.
  if (rule.startsAt && rule.startsAt > ctx.date) return false;
  if (rule.endsAt && rule.endsAt < ctx.date) return false;
  // Scope gating.
  if (rule.appliesToRatePlanId && rule.appliesToRatePlanId !== ctx.ratePlanId) return false;
  if (rule.appliesToRoomType && rule.appliesToRoomType !== ctx.roomType) return false;

  const cond = (rule.condition ?? {}) as Record<string, unknown>;
  switch (rule.kind) {
    case "occupancy_threshold": {
      const minPct = Number(cond.min_pct ?? 0);
      return (ctx.forecastOccupancyPct ?? 0) >= minPct;
    }
    case "length_of_stay": {
      const minN = cond.min_nights !== undefined ? Number(cond.min_nights) : 0;
      const maxN = cond.max_nights !== undefined ? Number(cond.max_nights) : Number.POSITIVE_INFINITY;
      return ctx.nights >= minN && ctx.nights <= maxN;
    }
    case "advance_purchase": {
      const minDays = Number(cond.min_days_ahead ?? 0);
      const booked = ctx.bookedAt ? new Date(ctx.bookedAt) : new Date();
      const stay = new Date(`${ctx.date}T00:00:00Z`);
      const days = Math.floor((stay.getTime() - booked.getTime()) / 86400000);
      return days >= minDays;
    }
    case "day_of_week": {
      const allowed = Array.isArray(cond.weekdays) ? (cond.weekdays as number[]) : [];
      const dow = new Date(`${ctx.date}T00:00:00Z`).getUTCDay();
      return allowed.includes(dow);
    }
    case "season": {
      const start = String(cond.start_date ?? "0000-01-01");
      const end = String(cond.end_date ?? "9999-12-31");
      return ctx.date >= start && ctx.date <= end;
    }
    case "manual":
      // 'manual' is reserved for hand-tagged rules a manager flips on
      // for a one-off promotion. Always matches when active.
      return true;
  }
  return false;
}

function applyAdjustment(price: number, rule: PricingRule): number {
  const v = Number(rule.adjustmentValue);
  if (rule.adjustmentType === "multiplier") return +(price * v).toFixed(2);
  return +(price + v).toFixed(2);
}

export async function applyPricingRules(args: {
  exec?: Exec;
  base: number;
  context: PricingContext;
}): Promise<PriceResult> {
  const exec = args.exec ?? db;
  // Pull every active rule for this property whose date range, if any,
  // could include the stay date. We over-fetch slightly (the matching
  // logic above re-checks) because the kind-specific conditions don't
  // map cleanly to a single WHERE.
  const candidates = await exec
    .select()
    .from(pricingRules)
    .where(
      and(
        eq(pricingRules.propertyId, args.context.propertyId),
        eq(pricingRules.isActive, true),
        or(sql`${pricingRules.startsAt} IS NULL`, lte(pricingRules.startsAt, args.context.date)),
        or(sql`${pricingRules.endsAt} IS NULL`, gte(pricingRules.endsAt, args.context.date)),
      ),
    )
    .orderBy(asc(pricingRules.priority));

  let running = +args.base.toFixed(2);
  const applied: AppliedRule[] = [];
  for (const rule of candidates) {
    if (!ruleMatches(rule, args.context)) continue;
    const before = running;
    running = applyAdjustment(running, rule);
    applied.push({
      id: rule.id,
      code: rule.code,
      name: rule.name,
      adjustmentType: rule.adjustmentType,
      adjustmentValue: Number(rule.adjustmentValue),
      before,
      after: running,
    });
    if (rule.stopAfter) break;
  }
  return { ratePerNight: running, applied };
}
