// Night audit (Phase 2 — Revenue & Operations).
//
// The night audit is the end-of-day close. It freezes the day's
// metrics (occupancy / ADR / RevPAR / revenue / arrivals / etc.) into
// a row so reports a year later still match the manager's morning
// report. Idempotent per (property, business_date) — running twice
// updates the existing row when `force=true`.
//
// Endpoints:
//   POST /night-audit/run             — run for businessDate (or yesterday)
//   GET  /night-audit                 — list past runs (paged by date)
//   GET  /night-audit/:date           — single date (yyyy-MM-dd)

import {
  nightAuditListQuerySchema,
  nightAuditRunRequestSchema,
} from "@hoteldesk/shared";
import { desc, eq, gte, lte, and, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { nightAuditRuns } from "../db/schema/nightAudit.js";
import { logActivity } from "../lib/activity.js";
import { resolveCurrentPropertyId } from "../lib/currentProperty.js";
import { fail, list, ok } from "../lib/response.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const router = Router();

const PROPERTY_TZ = "Asia/Kolkata";
function istDate(d = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: PROPERTY_TZ });
}
function yesterdayIst(): string {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() - 1);
  return istDate(t);
}

router.post(
  "/run",
  requireAuth,
  requirePermission("run_night_audit"),
  validate(nightAuditRunRequestSchema),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const input = req.body as z.infer<typeof nightAuditRunRequestSchema>;
    const date = input.businessDate ?? yesterdayIst();

    // Refuse re-run unless force=true.
    const [existing] = await db
      .select({ id: nightAuditRuns.id })
      .from(nightAuditRuns)
      .where(
        and(
          eq(nightAuditRuns.propertyId, propertyId),
          eq(nightAuditRuns.businessDate, date),
        ),
      )
      .limit(1);
    if (existing && !input.force) {
      return fail(
        res,
        409,
        "ALREADY_RUN",
        `Night audit already exists for ${date}. Pass force=true to re-run.`,
      );
    }

    // Aggregate the day's numbers in one SQL pass so the snapshot is
    // internally consistent. We compute against the property scope so
    // multi-property reports stay clean.
    //
    // "rooms_sold for date D" = number of distinct rooms occupied on D
    // (reservation overlaps D as a check-in night). For a stay
    // 10→13, D=11 counts as a sold night.
    const result = await db.execute<{
      total_rooms: number;
      rooms_sold: number;
      room_revenue: string;
      additional_revenue: string;
      gst_collected: string;
      arrivals: number;
      departures: number;
      no_shows: number;
      cancellations: number;
      walk_ins: number;
    }>(sql`
      WITH
      params AS (
        SELECT ${date}::date AS biz_date,
               ${propertyId}::uuid AS pid
      ),
      total_rooms AS (
        SELECT COUNT(*)::int AS n FROM rooms WHERE property_id = (SELECT pid FROM params)
      ),
      rooms_sold AS (
        SELECT COUNT(DISTINCT rr.room_id)::int AS n
        FROM reservation_rooms rr
        JOIN reservations r ON r.id = rr.reservation_id
        WHERE r.property_id = (SELECT pid FROM params)
          AND r.status IN ('checked_in','checked_out','confirmed')
          AND r.booking_source <> 'complimentary'
          AND daterange(r.check_in_date, GREATEST(r.check_out_date, r.check_in_date + 1), '[)')
              @> (SELECT biz_date FROM params)
      ),
      room_rev AS (
        SELECT COALESCE(SUM(CAST(rr.rate_per_night AS NUMERIC)), 0)::text AS revenue
        FROM reservation_rooms rr
        JOIN reservations r ON r.id = rr.reservation_id
        WHERE r.property_id = (SELECT pid FROM params)
          AND r.status IN ('checked_in','checked_out','confirmed')
          AND r.booking_source <> 'complimentary'
          AND daterange(r.check_in_date, GREATEST(r.check_out_date, r.check_in_date + 1), '[)')
              @> (SELECT biz_date FROM params)
      ),
      additional_rev AS (
        SELECT COALESCE(SUM(ac.amount), 0)::text AS revenue
        FROM additional_charges ac
        JOIN reservations r ON r.id = ac.reservation_id
        WHERE r.property_id = (SELECT pid FROM params)
          AND ac.created_at::date = (SELECT biz_date FROM params)
      ),
      gst_today AS (
        SELECT COALESCE(SUM(i.cgst_amount + i.sgst_amount), 0)::text AS gst
        FROM invoices i
        WHERE i.property_id = (SELECT pid FROM params)
          AND i.status <> 'voided'
          AND i.created_at::date = (SELECT biz_date FROM params)
      ),
      arr AS (
        SELECT COUNT(*)::int AS n
        FROM reservations r
        WHERE r.property_id = (SELECT pid FROM params)
          AND r.check_in_date = (SELECT biz_date FROM params)
          AND r.status IN ('checked_in','checked_out','confirmed')
      ),
      dep AS (
        SELECT COUNT(*)::int AS n
        FROM reservations r
        WHERE r.property_id = (SELECT pid FROM params)
          AND r.check_out_date = (SELECT biz_date FROM params)
          AND r.status IN ('checked_out','checked_in')
      ),
      ns AS (
        SELECT COUNT(*)::int AS n
        FROM reservations r
        WHERE r.property_id = (SELECT pid FROM params)
          AND r.check_in_date = (SELECT biz_date FROM params)
          AND r.status = 'no_show'
      ),
      cx AS (
        SELECT COUNT(*)::int AS n
        FROM reservations r
        WHERE r.property_id = (SELECT pid FROM params)
          AND r.status = 'cancelled'
          AND r.updated_at::date = (SELECT biz_date FROM params)
      ),
      wi AS (
        SELECT COUNT(*)::int AS n
        FROM reservations r
        WHERE r.property_id = (SELECT pid FROM params)
          AND r.booking_source = 'walkin'
          AND r.check_in_date = (SELECT biz_date FROM params)
      )
      SELECT
        (SELECT n FROM total_rooms) AS total_rooms,
        (SELECT n FROM rooms_sold) AS rooms_sold,
        (SELECT revenue FROM room_rev) AS room_revenue,
        (SELECT revenue FROM additional_rev) AS additional_revenue,
        (SELECT gst FROM gst_today) AS gst_collected,
        (SELECT n FROM arr) AS arrivals,
        (SELECT n FROM dep) AS departures,
        (SELECT n FROM ns) AS no_shows,
        (SELECT n FROM cx) AS cancellations,
        (SELECT n FROM wi) AS walk_ins
    `);
    const row = result[0] as unknown as {
      total_rooms: number;
      rooms_sold: number;
      room_revenue: string;
      additional_revenue: string;
      gst_collected: string;
      arrivals: number;
      departures: number;
      no_shows: number;
      cancellations: number;
      walk_ins: number;
    };

    const totalRooms = Number(row.total_rooms ?? 0);
    const sold = Number(row.rooms_sold ?? 0);
    const roomRevenue = Number(row.room_revenue ?? 0);
    const additionalRevenue = Number(row.additional_revenue ?? 0);
    const totalRevenue = +(roomRevenue + additionalRevenue).toFixed(2);
    const occupancy = totalRooms > 0 ? +((sold / totalRooms) * 100).toFixed(2) : 0;
    const adr = sold > 0 ? +(roomRevenue / sold).toFixed(2) : 0;
    const revpar = totalRooms > 0 ? +(roomRevenue / totalRooms).toFixed(2) : 0;

    const values = {
      propertyId,
      businessDate: date,
      roomsSold: sold,
      roomsAvailable: totalRooms,
      occupancyPct: String(occupancy),
      roomRevenue: String(roomRevenue.toFixed(2)),
      additionalRevenue: String(additionalRevenue.toFixed(2)),
      totalRevenue: String(totalRevenue),
      gstCollected: String(Number(row.gst_collected ?? 0).toFixed(2)),
      adr: String(adr),
      revpar: String(revpar),
      arrivals: Number(row.arrivals ?? 0),
      departures: Number(row.departures ?? 0),
      noShows: Number(row.no_shows ?? 0),
      cancellations: Number(row.cancellations ?? 0),
      walkIns: Number(row.walk_ins ?? 0),
      status: "completed" as const,
      ranBy: req.user!.id,
      ranAt: new Date(),
    };

    const [saved] = await db
      .insert(nightAuditRuns)
      .values(values)
      .onConflictDoUpdate({
        target: [nightAuditRuns.propertyId, nightAuditRuns.businessDate],
        set: {
          ...values,
          // Don't reset the primary key — onConflictDoUpdate handles
          // that, but we do reset ranBy + ranAt so the row reflects
          // who re-ran.
        },
      })
      .returning();

    await logActivity({
      action: existing ? "night_audit_rerun" : "night_audit_run",
      entityType: "night_audit_run",
      entityId: saved!.id,
      description: `Night audit for ${date}: ${sold}/${totalRooms} sold, ₹${totalRevenue} total`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    return ok(res, saved);
  },
);

router.get(
  "/",
  requireAuth,
  requirePermission("view_night_audit"),
  validate(nightAuditListQuerySchema, "query"),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const q = req.query as unknown as z.infer<typeof nightAuditListQuerySchema>;
    const conditions = [eq(nightAuditRuns.propertyId, propertyId)];
    if (q.start) conditions.push(gte(nightAuditRuns.businessDate, q.start));
    if (q.end) conditions.push(lte(nightAuditRuns.businessDate, q.end));
    const rows = await db
      .select()
      .from(nightAuditRuns)
      .where(and(...conditions))
      .orderBy(desc(nightAuditRuns.businessDate))
      .limit(q.limit);
    return list(res, rows, { total: rows.length, page: 1, per_page: q.limit });
  },
);

router.get(
  "/:date",
  requireAuth,
  requirePermission("view_night_audit"),
  async (req, res) => {
    const date = req.params.date!;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return fail(res, 400, "BAD_DATE", "Date must be yyyy-MM-dd");
    }
    const propertyId = await resolveCurrentPropertyId(req);
    const [row] = await db
      .select()
      .from(nightAuditRuns)
      .where(
        and(
          eq(nightAuditRuns.propertyId, propertyId),
          eq(nightAuditRuns.businessDate, date),
        ),
      )
      .limit(1);
    if (!row) return fail(res, 404, "NOT_FOUND", `No audit run for ${date}`);
    return ok(res, row);
  },
);

export default router;
