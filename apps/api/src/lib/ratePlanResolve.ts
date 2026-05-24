// Effective per-night rate resolution for a (rate_plan, room_type, date)
// tuple. Used by:
//   - reservation create (when ratePlanId is set, we override each room's
//     rate per stay night)
//   - group-booking pick-up (same logic, applied to every rooming-list row)
//   - the /rate-plans/lookup endpoint (UI calculator)
//
// Precedence (highest first):
//   1. rate_calendar.rate_override for the exact (plan, type, date) cell
//   2. rate_plan.base_modifier × room.base_rate for that room_type
//   3. room.base_rate alone (no rate plan)
//
// Each room of the same type in a single reservation gets its own room's
// base_rate as the multiplier base (so a 'deluxe' room with a higher base
// is still 'deluxe' after the modifier applies).

import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { rateCalendar, ratePlans } from "../db/schema/ratePlans.js";
import { rooms } from "../db/schema/rooms.js";
import { applyPricingRules } from "./pricingEngine.js";

type Db = typeof db;
type Exec = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface ResolvedRate {
  ratePerNight: number;
  // The source the rate came from. Useful for the receipt + audit log:
  //   'override' — explicit row in rate_calendar
  //   'modifier' — base_rate × modifier
  //   'base'     — no plan attached
  source: "override" | "modifier" | "base";
}

// Resolve the effective per-night rate for one room on one specific
// date. Cheap — single index hit per call. We deliberately don't memoise
// across dates here; reservation create calls this O(rooms × nights)
// inside a tx and the calendar row is on a covering index.
export async function resolveEffectiveRate(args: {
  exec?: Exec;
  ratePlanId: string | null;
  roomId: string;
  date: string; // yyyy-MM-dd
}): Promise<ResolvedRate> {
  const exec = args.exec ?? db;

  const [room] = await exec
    .select({ baseRate: rooms.baseRate, roomType: rooms.roomType })
    .from(rooms)
    .where(eq(rooms.id, args.roomId))
    .limit(1);
  if (!room) throw new Error(`Room ${args.roomId} not found`);

  const base = Number(room.baseRate);
  if (!args.ratePlanId) return { ratePerNight: base, source: "base" };

  const [plan] = await exec
    .select({
      id: ratePlans.id,
      modifier: ratePlans.baseModifier,
      isActive: ratePlans.isActive,
    })
    .from(ratePlans)
    .where(eq(ratePlans.id, args.ratePlanId))
    .limit(1);
  if (!plan || !plan.isActive) return { ratePerNight: base, source: "base" };

  const [cal] = await exec
    .select({ rateOverride: rateCalendar.rateOverride })
    .from(rateCalendar)
    .where(
      and(
        eq(rateCalendar.ratePlanId, plan.id),
        eq(rateCalendar.roomType, room.roomType),
        eq(rateCalendar.date, args.date),
      ),
    )
    .limit(1);
  if (cal?.rateOverride !== undefined && cal.rateOverride !== null) {
    return { ratePerNight: Number(cal.rateOverride), source: "override" };
  }

  return {
    ratePerNight: +(base * Number(plan.modifier)).toFixed(2),
    source: "modifier",
  };
}

// Average effective rate for a room over a date range, with Phase 3
// pricing rules applied per night. Used when the reservation pricing
// math needs a single per-night number (we use the average across
// nights so a stay that straddles a weekend surcharge still gets fair
// invoice line-item math).
//
// Rules layer in this order, per night:
//   1. room.base_rate
//   2. rate_plan.modifier (if a plan is attached)
//   3. rate_calendar override (if a row exists for that exact day)
//   4. pricing_rules in priority order (multiplier/flat adjustments)
export async function resolveAverageRate(args: {
  exec?: Exec;
  propertyId: string;
  ratePlanId: string | null;
  roomId: string;
  roomType: string;
  checkInDate: string;
  checkOutDate: string;
  forecastOccupancyPct?: number;
}): Promise<number> {
  const exec = args.exec ?? db;
  const start = new Date(`${args.checkInDate}T00:00:00Z`);
  const end = new Date(`${args.checkOutDate}T00:00:00Z`);
  const ms = 86400 * 1000;
  const nights = Math.max(1, Math.round((end.getTime() - start.getTime()) / ms));
  let total = 0;
  for (let i = 0; i < nights; i++) {
    const d = new Date(start.getTime() + i * ms).toISOString().slice(0, 10);
    const base = await resolveEffectiveRate({
      exec,
      ratePlanId: args.ratePlanId,
      roomId: args.roomId,
      date: d,
    });
    const adjusted = await applyPricingRules({
      exec,
      base: base.ratePerNight,
      context: {
        propertyId: args.propertyId,
        date: d,
        roomType: args.roomType,
        ratePlanId: args.ratePlanId,
        nights,
        forecastOccupancyPct: args.forecastOccupancyPct,
      },
    });
    total += adjusted.ratePerNight;
  }
  return +(total / nights).toFixed(2);
}
