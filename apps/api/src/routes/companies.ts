// Companies API (Phase 2 — Revenue & Operations).
//
// Endpoints:
//   GET    /companies               — list (search + paged)
//   POST   /companies               — create
//   GET    /companies/:id           — detail with outstanding aggregate
//   PATCH  /companies/:id           — edit
//   DELETE /companies/:id           — archive (soft; sets is_active=false)

import {
  companyCreateSchema,
  companyListQuerySchema,
  companyUpdateSchema,
} from "@hoteldesk/shared";
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { companies } from "../db/schema/companies.js";
import { invoices, payments } from "../db/schema/invoices.js";
import { reservations } from "../db/schema/reservations.js";
import { logActivity } from "../lib/activity.js";
import { resolveCurrentPropertyId } from "../lib/currentProperty.js";
import { fail, list, ok } from "../lib/response.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const router = Router();

router.get(
  "/",
  requireAuth,
  requirePermission("view_companies"),
  validate(companyListQuerySchema, "query"),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const q = req.query as unknown as z.infer<typeof companyListQuerySchema>;
    const conditions = [eq(companies.propertyId, propertyId)];
    if (!q.includeArchived) conditions.push(eq(companies.isActive, true));
    if (q.search) {
      const like = `%${q.search}%`;
      conditions.push(
        or(
          ilike(companies.name, like),
          ilike(companies.code, like),
          ilike(companies.gstin, like),
          ilike(companies.contactPhone, like),
        )!,
      );
    }
    const [rows, [count]] = await Promise.all([
      db
        .select()
        .from(companies)
        .where(and(...conditions))
        .orderBy(asc(companies.name))
        .limit(q.per_page)
        .offset((q.page - 1) * q.per_page),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(companies)
        .where(and(...conditions)),
    ]);
    return list(res, rows, { total: count?.c ?? 0, page: q.page, per_page: q.per_page });
  },
);

router.post(
  "/",
  requireAuth,
  requirePermission("manage_companies"),
  validate(companyCreateSchema),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const input = req.body as z.infer<typeof companyCreateSchema>;
    try {
      const [created] = await db
        .insert(companies)
        .values({
          ...input,
          propertyId,
          // Drizzle's `numeric` columns want string|null.
          creditLimit:
            input.creditLimit == null ? null : String(input.creditLimit),
          defaultDiscountPct:
            input.defaultDiscountPct == null ? null : String(input.defaultDiscountPct),
        })
        .returning();
      await logActivity({
        action: "company_created",
        entityType: "company",
        entityId: created!.id,
        description: `${created!.code} (${created!.name}) created`,
        performedBy: req.user!.id,
        ipAddress: req.ip,
      });
      return ok(res, created, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown";
      if (msg.includes("companies_code_per_property")) {
        return fail(res, 409, "DUPLICATE_CODE", "A company with that code already exists");
      }
      throw err;
    }
  },
);

router.get(
  "/:id",
  requireAuth,
  requirePermission("view_companies"),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const id = req.params.id!;
    const [company] = await db
      .select()
      .from(companies)
      .where(and(eq(companies.id, id), eq(companies.propertyId, propertyId)))
      .limit(1);
    if (!company) return fail(res, 404, "NOT_FOUND", "Company not found");

    // Aggregate outstanding for this company across all its invoices.
    // Outstanding = SUM(invoice.balance_due) for non-voided invoices.
    const [outstanding] = await db
      .select({
        outstanding: sql<string>`COALESCE(SUM(${invoices.balanceDue}), 0)::text`,
        invoiceCount: sql<number>`COUNT(${invoices.id})::int`,
      })
      .from(invoices)
      .where(and(eq(invoices.companyId, id), sql`${invoices.status} <> 'voided'`));

    const [totals] = await db
      .select({
        reservationCount: sql<number>`COUNT(${reservations.id})::int`,
      })
      .from(reservations)
      .where(eq(reservations.companyId, id));

    return ok(res, {
      ...company,
      outstanding: Number(outstanding?.outstanding ?? 0),
      invoiceCount: outstanding?.invoiceCount ?? 0,
      reservationCount: totals?.reservationCount ?? 0,
    });
  },
);

router.patch(
  "/:id",
  requireAuth,
  requirePermission("manage_companies"),
  validate(companyUpdateSchema),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const id = req.params.id!;
    const patch = req.body as z.infer<typeof companyUpdateSchema>;
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      // Coerce numeric fields to string for Drizzle.
      if (k === "creditLimit" || k === "defaultDiscountPct") {
        updateData[k] = v == null ? null : String(v);
      } else {
        updateData[k] = v;
      }
    }
    const [updated] = await db
      .update(companies)
      .set(updateData)
      .where(and(eq(companies.id, id), eq(companies.propertyId, propertyId)))
      .returning();
    if (!updated) return fail(res, 404, "NOT_FOUND", "Company not found");
    await logActivity({
      action: "company_updated",
      entityType: "company",
      entityId: id,
      description: `${updated.code} updated`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    return ok(res, updated);
  },
);

router.delete(
  "/:id",
  requireAuth,
  requirePermission("manage_companies"),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const id = req.params.id!;
    const [archived] = await db
      .update(companies)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(companies.id, id), eq(companies.propertyId, propertyId)))
      .returning();
    if (!archived) return fail(res, 404, "NOT_FOUND", "Company not found");
    return ok(res, { archived: archived.id });
  },
);

export default router;
