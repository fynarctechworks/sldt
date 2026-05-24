// Pricing Rules — list + create + preview.
// Rules layer on top of base + rate plan + calendar to produce the
// final per-night price.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, TrendingUp, X } from "lucide-react";
import { useState } from "react";
import { Can } from "@/auth/Can";
import { Loader } from "@/components/Loader";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api";
import { inr } from "@/lib/utils";

const KIND_LABEL: Record<string, string> = {
  occupancy_threshold: "Occupancy threshold",
  length_of_stay: "Length of stay",
  advance_purchase: "Advance purchase",
  day_of_week: "Day of week",
  season: "Season",
  manual: "Manual",
};

interface PricingRule {
  id: string;
  code: string;
  name: string;
  kind: string;
  condition: Record<string, unknown>;
  adjustmentType: "multiplier" | "flat";
  adjustmentValue: string;
  priority: number;
  isActive: boolean;
  stopAfter: boolean;
}

export default function PricingRulesPage() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);

  const q = useQuery({
    queryKey: ["pricing-rules"],
    queryFn: () =>
      api
        .get<{ data?: PricingRule[] } | PricingRule[]>("/pricing-rules")
        .then((r) => (Array.isArray(r) ? r : (r as { data?: PricingRule[] }).data ?? [])),
  });

  const rules = q.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Pricing Rules</h1>
          <div className="text-xs text-textSecondary mt-0.5">
            Dynamic price adjustments applied on top of the rate plan
          </div>
        </div>
        <Can do="manage_pricing_rules">
          <button onClick={() => setShowNew(true)} className="btn-primary inline-flex items-center gap-2">
            <Plus className="w-4 h-4" /> New rule
          </button>
        </Can>
      </div>

      {q.isLoading ? (
        <Loader label="Loading…" />
      ) : rules.length === 0 ? (
        <div className="card text-center py-10 text-sm text-textSecondary">
          <TrendingUp className="w-10 h-10 mx-auto mb-2 opacity-40" />
          No pricing rules yet.
        </div>
      ) : (
        <div className="card !p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg/60 text-textSecondary">
              <tr>
                <th className="px-3 py-2 text-left">Priority</th>
                <th className="px-3 py-2 text-left">Code</th>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Kind</th>
                <th className="px-3 py-2 text-right">Adjustment</th>
                <th className="px-3 py-2 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className="border-t border-borderc/60">
                  <td className="px-3 py-2 font-mono">{r.priority}</td>
                  <td className="px-3 py-2 font-mono text-accentBlue">{r.code}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-textSecondary">{KIND_LABEL[r.kind] ?? r.kind}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {r.adjustmentType === "multiplier"
                      ? `×${Number(r.adjustmentValue).toFixed(3)}`
                      : `${Number(r.adjustmentValue) >= 0 ? "+" : ""}${inr(Number(r.adjustmentValue))}`}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${r.isActive ? "bg-success/15 text-success" : "bg-bg text-textSecondary"}`}
                    >
                      {r.isActive ? "active" : "inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <NewRuleModal
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            void qc.invalidateQueries({ queryKey: ["pricing-rules"] });
          }}
        />
      )}
    </div>
  );
}

function NewRuleModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    code: "",
    name: "",
    kind: "occupancy_threshold" as
      | "occupancy_threshold"
      | "length_of_stay"
      | "advance_purchase"
      | "day_of_week"
      | "season"
      | "manual",
    minPct: "80",
    minNights: "7",
    minDaysAhead: "30",
    weekdays: "5,6", // Fri/Sat default
    adjustmentType: "multiplier" as "multiplier" | "flat",
    adjustmentValue: "1.15",
    priority: "100",
  });

  const create = useMutation({
    mutationFn: () => {
      let condition: Record<string, unknown> = {};
      if (form.kind === "occupancy_threshold") condition = { min_pct: Number(form.minPct) };
      else if (form.kind === "length_of_stay") condition = { min_nights: Number(form.minNights) };
      else if (form.kind === "advance_purchase")
        condition = { min_days_ahead: Number(form.minDaysAhead) };
      else if (form.kind === "day_of_week") {
        condition = {
          weekdays: form.weekdays
            .split(",")
            .map((s) => Number(s.trim()))
            .filter((n) => n >= 0 && n <= 6),
        };
      }
      return api.post("/pricing-rules", {
        code: form.code.toUpperCase(),
        name: form.name,
        kind: form.kind,
        condition,
        adjustmentType: form.adjustmentType,
        adjustmentValue: Number(form.adjustmentValue),
        priority: Number(form.priority),
      });
    },
    onSuccess: () => {
      toast("Rule created", "success");
      onCreated();
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  return (
    <div className="fixed inset-0 z-50 bg-brand-dark/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-md border border-borderc w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between px-4 py-3 border-b border-borderc">
          <h2 className="font-semibold text-brand-dark">New pricing rule</h2>
          <button onClick={onClose} className="p-1 hover:bg-bg rounded">
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-textSecondary">Code</label>
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                className="input mt-1 w-full"
                placeholder="WKND_PEAK"
                autoFocus
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-textSecondary">Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="input mt-1 w-full"
                placeholder="Weekend peak surcharge"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-textSecondary">Kind</label>
            <select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as typeof form.kind })}
              className="input mt-1 w-full"
            >
              {Object.entries(KIND_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          {form.kind === "occupancy_threshold" && (
            <div>
              <label className="text-xs font-medium text-textSecondary">Min occupancy %</label>
              <input
                type="number"
                value={form.minPct}
                onChange={(e) => setForm({ ...form, minPct: e.target.value })}
                className="input mt-1 w-full"
              />
            </div>
          )}
          {form.kind === "length_of_stay" && (
            <div>
              <label className="text-xs font-medium text-textSecondary">Min nights</label>
              <input
                type="number"
                value={form.minNights}
                onChange={(e) => setForm({ ...form, minNights: e.target.value })}
                className="input mt-1 w-full"
              />
            </div>
          )}
          {form.kind === "advance_purchase" && (
            <div>
              <label className="text-xs font-medium text-textSecondary">Min days ahead</label>
              <input
                type="number"
                value={form.minDaysAhead}
                onChange={(e) => setForm({ ...form, minDaysAhead: e.target.value })}
                className="input mt-1 w-full"
              />
            </div>
          )}
          {form.kind === "day_of_week" && (
            <div>
              <label className="text-xs font-medium text-textSecondary">Weekdays (0=Sun … 6=Sat)</label>
              <input
                value={form.weekdays}
                onChange={(e) => setForm({ ...form, weekdays: e.target.value })}
                className="input mt-1 w-full"
                placeholder="5,6"
              />
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-textSecondary">Adjustment</label>
              <select
                value={form.adjustmentType}
                onChange={(e) =>
                  setForm({ ...form, adjustmentType: e.target.value as typeof form.adjustmentType })
                }
                className="input mt-1 w-full"
              >
                <option value="multiplier">Multiplier</option>
                <option value="flat">Flat ₹</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-textSecondary">Value</label>
              <input
                type="number"
                step="0.05"
                value={form.adjustmentValue}
                onChange={(e) => setForm({ ...form, adjustmentValue: e.target.value })}
                className="input mt-1 w-full"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-textSecondary">Priority</label>
              <input
                type="number"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
                className="input mt-1 w-full"
              />
            </div>
          </div>
          <p className="text-[11px] text-textSecondary">
            Multiplier 1.20 = +20%. Flat -500 = ₹500 discount per night. Lower priority runs first.
          </p>
        </div>
        <footer className="flex justify-end gap-2 px-4 py-3 border-t border-borderc">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            disabled={form.code.length < 2 || form.name.length < 2 || create.isPending}
            onClick={() => create.mutate()}
            className="btn-primary"
          >
            {create.isPending ? "Creating…" : "Create"}
          </button>
        </footer>
      </div>
    </div>
  );
}
