// GSTR-1 + GSTR-3B JSON export.
//
// These are India's monthly GST returns. The government publishes a
// JSON schema (the "offline tool" import format) that filers can use
// instead of typing into the portal. We produce that JSON from our
// invoice + invoice_line_items tables.
//
// IMPORTANT — this code generates the JSON in the documented schema,
// but the schema EVOLVES every few quarters. Your chartered accountant
// must verify the generated file before submission. We bake the
// schema version into the payload so downstream consumers can detect
// mismatches.
//
// Endpoints:
//   POST /gst-returns/run        — generate (or re-generate) a return
//   GET  /gst-returns            — list past runs
//   GET  /gst-returns/:id        — single run, full payload
//   GET  /gst-returns/:id/json   — single run, raw JSON download

import { gstReturnRunSchema } from "@hoteldesk/shared";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { gstReturnsRuns } from "../db/schema/compliance.js";
import { properties } from "../db/schema/properties.js";
import {
  invoiceLineItems,
  invoices,
  payments,
} from "../db/schema/invoices.js";
import { logActivity } from "../lib/activity.js";
import { resolveCurrentPropertyId } from "../lib/currentProperty.js";
import { fail, list, ok } from "../lib/response.js";
import { getSettings } from "../lib/settings.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const router = Router();

router.post(
  "/run",
  requireAuth,
  requirePermission("export_gstr"),
  validate(gstReturnRunSchema),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const input = req.body as z.infer<typeof gstReturnRunSchema>;
    const periodStr = `${input.periodYear}-${String(input.periodMonth).padStart(2, "0")}`;
    const firstDay = `${periodStr}-01`;
    const lastDate = new Date(input.periodYear, input.periodMonth, 0).getDate();
    const lastDay = `${periodStr}-${String(lastDate).padStart(2, "0")}`;

    // Re-run guard.
    const [existing] = await db
      .select({ id: gstReturnsRuns.id })
      .from(gstReturnsRuns)
      .where(
        and(
          eq(gstReturnsRuns.propertyId, propertyId),
          eq(gstReturnsRuns.returnType, input.returnType),
          eq(gstReturnsRuns.periodYear, input.periodYear),
          eq(gstReturnsRuns.periodMonth, input.periodMonth),
        ),
      )
      .limit(1);
    if (existing && !input.force) {
      return fail(
        res,
        409,
        "ALREADY_RUN",
        `${input.returnType} for ${periodStr} already generated. Use force=true to regenerate.`,
      );
    }

    const [prop] = await db
      .select()
      .from(properties)
      .where(eq(properties.id, propertyId))
      .limit(1);
    const settings = await getSettings();
    const sellerGstin = prop?.gstin ?? settings.hotelGstin ?? "";
    const sellerState = prop?.state ?? "Andhra Pradesh";

    // Pull all non-voided invoices for the period at the property.
    const invRows = await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.propertyId, propertyId),
          sql`${invoices.status} <> 'voided'`,
          gte(invoices.createdAt, new Date(`${firstDay}T00:00:00+05:30`)),
          lte(invoices.createdAt, new Date(`${lastDay}T23:59:59+05:30`)),
        ),
      )
      .orderBy(asc(invoices.createdAt));

    const lineItemsByInvoice = new Map<
      string,
      Array<typeof invoiceLineItems.$inferSelect>
    >();
    if (invRows.length) {
      const items = await db
        .select()
        .from(invoiceLineItems)
        .where(
          sql`${invoiceLineItems.invoiceId} IN (${sql.raw(invRows.map((i) => `'${i.id}'::uuid`).join(","))})`,
        );
      for (const it of items) {
        const arr = lineItemsByInvoice.get(it.invoiceId) ?? [];
        arr.push(it);
        lineItemsByInvoice.set(it.invoiceId, arr);
      }
    }

    let totalTaxable = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;

    let payload: unknown;
    if (input.returnType === "GSTR-1") {
      // GSTR-1 = outward supplies. For a hotel that issues mostly B2C
      // invoices, the relevant section is B2CS (small B2C consolidated
      // by state + tax rate). Each invoice line item rolls up into a
      // row keyed by (place_of_supply, rate).
      type B2csKey = string;
      const b2cs = new Map<
        B2csKey,
        {
          sply_ty: "INTER" | "INTRA";
          pos: string;        // state code, 2 digits
          rt: number;
          typ: "OE";
          txval: number;
          iamt: number;
          camt: number;
          samt: number;
          csamt: number;
        }
      >();

      // Indian state code lookup — minimal, just for the property's
      // state. (Real implementation would resolve guest_state per
      // invoice; we default to property state for B2CS.)
      const stateCode = stateToCode(sellerState);

      for (const inv of invRows) {
        const items = lineItemsByInvoice.get(inv.id) ?? [];
        for (const it of items) {
          const taxable = Number(it.amount);
          const gstRate = Number(it.gstRate);
          // Intra-state assumption for B2CS small invoices. Inter-state
          // would need igst_amount > 0 and pos != seller_state.
          const cgst = +((taxable * (gstRate / 2)) / 100).toFixed(2);
          const sgst = cgst;
          totalTaxable += taxable;
          totalCgst += cgst;
          totalSgst += sgst;

          const key = `${stateCode}_${gstRate}`;
          const cur = b2cs.get(key) ?? {
            sply_ty: "INTRA" as const,
            pos: stateCode,
            rt: gstRate,
            typ: "OE" as const,
            txval: 0,
            iamt: 0,
            camt: 0,
            samt: 0,
            csamt: 0,
          };
          cur.txval += taxable;
          cur.camt += cgst;
          cur.samt += sgst;
          b2cs.set(key, cur);
        }
      }

      // Round all aggregates to 2 dp.
      const b2csRows = Array.from(b2cs.values()).map((r) => ({
        ...r,
        txval: +r.txval.toFixed(2),
        camt: +r.camt.toFixed(2),
        samt: +r.samt.toFixed(2),
      }));

      payload = {
        gstin: sellerGstin,
        ret_period: `${String(input.periodMonth).padStart(2, "0")}${input.periodYear}`,
        // schema_version is OUR tag, not government-defined, but
        // useful for the consumer to detect mismatches.
        schema_version: "1.0-hoteldesk",
        b2cs: b2csRows,
        // hsn summary — SAC 9963 for accommodation services
        hsn: {
          data: [
            {
              num: 1,
              hsn_sc: "9963",
              desc: "Accommodation, food and beverage services",
              uqc: "OTH",
              qty: invRows.length,
              val: +(totalTaxable + totalCgst + totalSgst).toFixed(2),
              txval: +totalTaxable.toFixed(2),
              iamt: 0,
              camt: +totalCgst.toFixed(2),
              samt: +totalSgst.toFixed(2),
              csamt: 0,
            },
          ],
        },
        // doc issued range
        doc_issue: {
          doc_det: [
            {
              doc_num: 12,
              docs: [
                {
                  num: 1,
                  from: invRows[0]?.invoiceNumber ?? "",
                  to: invRows[invRows.length - 1]?.invoiceNumber ?? "",
                  totnum: invRows.length,
                  cancel: 0,
                  net_issue: invRows.length,
                },
              ],
            },
          ],
        },
      };
    } else {
      // GSTR-3B = monthly summary. Three sections that matter for a
      // hotel: 3.1.a outward taxable supplies (other than zero rated),
      // 6.1 payment of tax, and 5 exempt/nil-rated/non-GST.
      let zeroRated = 0;
      for (const inv of invRows) {
        const items = lineItemsByInvoice.get(inv.id) ?? [];
        for (const it of items) {
          const amt = Number(it.amount);
          const rate = Number(it.gstRate);
          if (rate === 0) {
            zeroRated += amt;
            continue;
          }
          const cgst = +((amt * (rate / 2)) / 100).toFixed(2);
          totalTaxable += amt;
          totalCgst += cgst;
          totalSgst += cgst;
        }
      }
      payload = {
        gstin: sellerGstin,
        ret_period: `${String(input.periodMonth).padStart(2, "0")}${input.periodYear}`,
        schema_version: "1.0-hoteldesk",
        sup_details: {
          osup_det: {
            txval: +totalTaxable.toFixed(2),
            iamt: 0,
            camt: +totalCgst.toFixed(2),
            samt: +totalSgst.toFixed(2),
            csamt: 0,
          },
          osup_zero: { txval: 0, iamt: 0, csamt: 0 },
          osup_nil_exmp: { txval: +zeroRated.toFixed(2) },
          isup_rev: { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 },
          osup_nongst: { txval: 0 },
        },
      };
    }

    // Upsert into gst_returns_runs.
    const [saved] = await db
      .insert(gstReturnsRuns)
      .values({
        propertyId,
        returnType: input.returnType,
        periodMonth: input.periodMonth,
        periodYear: input.periodYear,
        payload: payload as object,
        totalInvoices: invRows.length,
        totalTaxable: String(totalTaxable.toFixed(2)),
        totalCgst: String(totalCgst.toFixed(2)),
        totalSgst: String(totalSgst.toFixed(2)),
        totalIgst: String(totalIgst.toFixed(2)),
        generatedBy: req.user!.id,
        generatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          gstReturnsRuns.propertyId,
          gstReturnsRuns.returnType,
          gstReturnsRuns.periodYear,
          gstReturnsRuns.periodMonth,
        ],
        set: {
          payload: payload as object,
          totalInvoices: invRows.length,
          totalTaxable: String(totalTaxable.toFixed(2)),
          totalCgst: String(totalCgst.toFixed(2)),
          totalSgst: String(totalSgst.toFixed(2)),
          totalIgst: String(totalIgst.toFixed(2)),
          generatedBy: req.user!.id,
          generatedAt: new Date(),
        },
      })
      .returning();

    await logActivity({
      action: "gstr_generated",
      entityType: "gst_returns_run",
      entityId: saved!.id,
      description: `${input.returnType} ${periodStr} (${invRows.length} invoices, ₹${totalTaxable.toFixed(2)} taxable)`,
      performedBy: req.user!.id,
      ipAddress: req.ip,
    });
    return ok(res, saved);
  },
);

router.get(
  "/",
  requireAuth,
  requirePermission("export_gstr"),
  async (req, res) => {
    const propertyId = await resolveCurrentPropertyId(req);
    const rows = await db
      .select()
      .from(gstReturnsRuns)
      .where(eq(gstReturnsRuns.propertyId, propertyId))
      .orderBy(desc(gstReturnsRuns.periodYear), desc(gstReturnsRuns.periodMonth));
    return list(res, rows, { total: rows.length, page: 1, per_page: rows.length });
  },
);

router.get(
  "/:id",
  requireAuth,
  requirePermission("export_gstr"),
  async (req, res) => {
    const id = req.params.id!;
    const propertyId = await resolveCurrentPropertyId(req);
    const [row] = await db
      .select()
      .from(gstReturnsRuns)
      .where(and(eq(gstReturnsRuns.id, id), eq(gstReturnsRuns.propertyId, propertyId)))
      .limit(1);
    if (!row) return fail(res, 404, "NOT_FOUND", "Run not found");
    return ok(res, row);
  },
);

router.get(
  "/:id/json",
  requireAuth,
  requirePermission("export_gstr"),
  async (req, res) => {
    const id = req.params.id!;
    const propertyId = await resolveCurrentPropertyId(req);
    const [row] = await db
      .select()
      .from(gstReturnsRuns)
      .where(and(eq(gstReturnsRuns.id, id), eq(gstReturnsRuns.propertyId, propertyId)))
      .limit(1);
    if (!row) return fail(res, 404, "NOT_FOUND", "Run not found");
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${row.returnType}-${row.periodYear}-${String(row.periodMonth).padStart(2, "0")}.json"`,
    );
    return res.send(JSON.stringify(row.payload, null, 2));
  },
);

// Minimal state name → state code map. Covers Indian states + UTs by
// the official GSTN 2-digit numeric codes. Government schema needs
// these as strings.
function stateToCode(name: string): string {
  const map: Record<string, string> = {
    "Andhra Pradesh": "37",
    "Arunachal Pradesh": "12",
    Assam: "18",
    Bihar: "10",
    Chhattisgarh: "22",
    Goa: "30",
    Gujarat: "24",
    Haryana: "06",
    "Himachal Pradesh": "02",
    "Jammu and Kashmir": "01",
    Jharkhand: "20",
    Karnataka: "29",
    Kerala: "32",
    "Madhya Pradesh": "23",
    Maharashtra: "27",
    Manipur: "14",
    Meghalaya: "17",
    Mizoram: "15",
    Nagaland: "13",
    Odisha: "21",
    Punjab: "03",
    Rajasthan: "08",
    Sikkim: "11",
    "Tamil Nadu": "33",
    Telangana: "36",
    Tripura: "16",
    "Uttar Pradesh": "09",
    Uttarakhand: "05",
    "West Bengal": "19",
    Delhi: "07",
    Chandigarh: "04",
    "Dadra and Nagar Haveli and Daman and Diu": "26",
    Lakshadweep: "31",
    Puducherry: "34",
    Ladakh: "38",
    "Andaman and Nicobar Islands": "35",
  };
  return map[name] ?? "37"; // default to AP for SLDT
}

export default router;
