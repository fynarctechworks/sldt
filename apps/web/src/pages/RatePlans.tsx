// Rate Plans + rate calendar editor.
//
// Left: list of rate plans (BAR / WEEKEND / CORP / custom) with their
// base modifier. Right: a calendar grid for the selected plan showing
// per-day rate overrides per room type, plus a "bulk set" panel to
// paint a date range × room-type with an override / restriction.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { Plus, Star, Tags, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Can } from "@/auth/Can";
import { useAuth } from "@/auth/AuthContext";
import { Loader } from "@/components/Loader";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api";
import { inr } from "@/lib/utils";

interface RatePlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  baseModifier: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
}

interface CalEntry {
  id: string;
  roomType: string;
  date: string;
  rateOverride: string | null;
  roomsAvailable: number | null;
  closedToArrival: boolean | null;
  closedToDeparture: boolean | null;
}

export default function RatePlansPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const canManage = can("manage_rate_plans");

  const plansQuery = useQuery({
    queryKey: ["rate-plans"],
    queryFn: () =>
      api
        .get<{ data?: RatePlan[] } | RatePlan[]>("/rate-plans")
        .then((r) => (Array.isArray(r) ? r : (r as { data?: RatePlan[] }).data ?? [])),
  });

  const plans = plansQuery.data ?? [];
  const selected = plans.find((p) => p.id === selectedId) ?? plans[0] ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Rate Plans</h1>
          <div className="text-xs text-textSecondary mt-0.5">
            Pricing strategies + per-day calendar
          </div>
        </div>
        <Can do="manage_rate_plans">
          <button onClick={() => setShowNew(true)} className="btn-primary inline-flex items-center gap-2">
            <Plus className="w-4 h-4" /> New rate plan
          </button>
        </Can>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
        {/* Plans list */}
        <div className="card !p-0 overflow-hidden">
          {plansQuery.isLoading ? (
            <Loader label="Loading…" />
          ) : plans.length === 0 ? (
            <div className="p-6 text-center text-sm text-textSecondary">No rate plans yet.</div>
          ) : (
            <ul className="divide-y divide-borderc">
              {plans.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => setSelectedId(p.id)}
                    className={`w-full text-left px-3 py-3 hover:bg-bg ${selected?.id === p.id ? "bg-brand-soft/40" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-accentBlue">{p.code}</span>
                      {p.isDefault && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-brass">
                          <Star className="w-3 h-3 fill-brass" /> default
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-medium text-brand-dark">{p.name}</div>
                    <div className="text-[11px] text-textSecondary">
                      ×{Number(p.baseModifier).toFixed(2)} {!p.isActive && "· inactive"}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Calendar editor for the selected plan */}
        <div>
          {selected ? (
            <RateCalendarEditor plan={selected} canManage={canManage} onChanged={() => qc.invalidateQueries({ queryKey: ["rate-plans"] })} />
          ) : (
            <div className="card grid place-items-center min-h-[300px] text-sm text-textSecondary">
              <div className="text-center">
                <Tags className="w-10 h-10 mx-auto mb-2 opacity-40" />
                Select a rate plan.
              </div>
            </div>
          )}
        </div>
      </div>

      {showNew && (
        <NewRatePlanModal
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            void qc.invalidateQueries({ queryKey: ["rate-plans"] });
          }}
        />
      )}
    </div>
  );
}

function RateCalendarEditor({
  plan,
  canManage,
  onChanged,
}: {
  plan: RatePlan;
  canManage: boolean;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [anchor, setAnchor] = useState(() => new Date());
  const windowDays = 14;
  const start = format(anchor, "yyyy-MM-dd");
  const end = format(addDays(anchor, windowDays - 1), "yyyy-MM-dd");

  const roomTypesQuery = useQuery({
    queryKey: ["room-types-list"],
    queryFn: () => api.get<{ slug: string; label: string }[]>("/settings/room-types"),
  });
  const roomTypes = roomTypesQuery.data ?? [];

  const calQuery = useQuery({
    queryKey: ["rate-calendar", plan.id, start, end],
    queryFn: () => api.get<CalEntry[]>(`/rate-plans/${plan.id}/calendar`, { start, end }),
  });

  const days = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < windowDays; i++) out.push(format(addDays(anchor, i), "yyyy-MM-dd"));
    return out;
  }, [anchor]);

  // Index calendar entries by `${roomType}|${date}`.
  const byCell = useMemo(() => {
    const m = new Map<string, CalEntry>();
    for (const e of calQuery.data ?? []) m.set(`${e.roomType}|${e.date}`, e);
    return m;
  }, [calQuery.data]);

  const [bulk, setBulk] = useState<{ roomType: string; rate: string } | null>(null);

  const bulkMutation = useMutation({
    mutationFn: (vars: { roomType: string; rate: number }) =>
      api.post(`/rate-plans/${plan.id}/calendar/bulk-set`, {
        ratePlanId: plan.id,
        startDate: start,
        endDate: end,
        roomTypes: [vars.roomType],
        patch: { rateOverride: vars.rate },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["rate-calendar", plan.id] });
      setBulk(null);
      toast("Rates updated for the window", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  return (
    <div className="card space-y-3">
      <header className="flex items-center justify-between gap-3 flex-wrap border-b border-borderc pb-2">
        <div>
          <h2 className="font-semibold text-brand-dark">
            {plan.name} <span className="text-textSecondary font-normal">· ×{Number(plan.baseModifier).toFixed(2)}</span>
          </h2>
          <div className="text-xs text-textSecondary">
            {start} → {end}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setAnchor((d) => addDays(d, -windowDays))} className="btn-secondary !h-8 text-xs">
            ← Prev
          </button>
          <button onClick={() => setAnchor(new Date())} className="btn-secondary !h-8 text-xs">
            Today
          </button>
          <button onClick={() => setAnchor((d) => addDays(d, windowDays))} className="btn-secondary !h-8 text-xs">
            Next →
          </button>
        </div>
      </header>

      {calQuery.isLoading || roomTypesQuery.isLoading ? (
        <Loader label="Loading calendar…" />
      ) : roomTypes.length === 0 ? (
        <div className="text-sm text-textSecondary py-4 text-center">
          No room types defined. Add some in Settings → Room Types.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 bg-surface px-2 py-1 text-left font-semibold text-brand-dark border-b border-borderc min-w-[140px]">
                  Room type
                </th>
                {days.map((d) => {
                  const dt = new Date(d + "T00:00:00");
                  return (
                    <th key={d} className="px-1 py-1 text-center text-textSecondary border-b border-borderc whitespace-nowrap">
                      <div>{format(dt, "EEE")}</div>
                      <div className="font-semibold text-brand-dark">{format(dt, "d")}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {roomTypes.map((rt) => (
                <tr key={rt.slug}>
                  <td className="sticky left-0 bg-surface px-2 py-1 font-medium text-brand-dark border-b border-borderc/60">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{rt.label}</span>
                      {canManage && (
                        <button
                          onClick={() => setBulk({ roomType: rt.slug, rate: "" })}
                          className="text-[10px] text-accentBlue hover:underline shrink-0"
                          title="Set a rate for every day in this window"
                        >
                          set all
                        </button>
                      )}
                    </div>
                  </td>
                  {days.map((d) => {
                    const cell = byCell.get(`${rt.slug}|${d}`);
                    const override = cell?.rateOverride ? Number(cell.rateOverride) : null;
                    return (
                      <td key={d} className="px-1 py-1 text-center border-b border-borderc/60">
                        {override !== null ? (
                          <span className="font-mono text-brand-dark">{inr(override)}</span>
                        ) : (
                          <span className="text-textSecondary/50">—</span>
                        )}
                        {cell?.closedToArrival && (
                          <span className="block text-[9px] text-danger" title="Closed to arrival">
                            CTA
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-textSecondary">
        "—" means the plan's base modifier (×{Number(plan.baseModifier).toFixed(2)}) applies to each
        room's base rate. Set an explicit override per row with "set all".
      </p>

      {bulk && (
        <div className="fixed inset-0 z-50 bg-brand-dark/40 grid place-items-center p-4" onClick={() => setBulk(null)}>
          <div className="bg-surface rounded-md border border-borderc w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <header className="flex items-center justify-between px-4 py-3 border-b border-borderc">
              <h3 className="font-semibold text-brand-dark text-sm">Set rate for the window</h3>
              <button onClick={() => setBulk(null)} className="p-1 hover:bg-bg rounded">
                <X className="w-4 h-4" />
              </button>
            </header>
            <div className="p-4 space-y-2">
              <div className="text-xs text-textSecondary">
                {start} → {end} · {roomTypes.find((r) => r.slug === bulk.roomType)?.label}
              </div>
              <label className="text-xs font-medium text-textSecondary">Rate per night (₹)</label>
              <input
                type="number"
                value={bulk.rate}
                onChange={(e) => setBulk({ ...bulk, rate: e.target.value })}
                className="input w-full"
                placeholder="e.g. 2500"
                autoFocus
              />
            </div>
            <footer className="flex justify-end gap-2 px-4 py-3 border-t border-borderc">
              <button onClick={() => setBulk(null)} className="btn-secondary">
                Cancel
              </button>
              <button
                disabled={!bulk.rate || bulkMutation.isPending}
                onClick={() => bulkMutation.mutate({ roomType: bulk.roomType, rate: Number(bulk.rate) })}
                className="btn-primary"
              >
                {bulkMutation.isPending ? "Saving…" : "Apply to window"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

function NewRatePlanModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [modifier, setModifier] = useState("1.00");

  const createMutation = useMutation({
    mutationFn: () =>
      api.post("/rate-plans", {
        code: code.toUpperCase(),
        name,
        baseModifier: Number(modifier),
      }),
    onSuccess: () => {
      onCreated();
      toast("Rate plan created", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  return (
    <div className="fixed inset-0 z-50 bg-brand-dark/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-md border border-borderc w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between px-4 py-3 border-b border-borderc">
          <h2 className="font-semibold text-brand-dark">New rate plan</h2>
          <button onClick={onClose} className="p-1 hover:bg-bg rounded">
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-textSecondary">Code (uppercase)</label>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="input mt-1 w-full" placeholder="OTA" autoFocus />
          </div>
          <div>
            <label className="text-xs font-medium text-textSecondary">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input mt-1 w-full" placeholder="OTA Rate" />
          </div>
          <div>
            <label className="text-xs font-medium text-textSecondary">Base modifier</label>
            <input
              type="number"
              step="0.05"
              value={modifier}
              onChange={(e) => setModifier(e.target.value)}
              className="input mt-1 w-full"
            />
            <p className="text-[11px] text-textSecondary mt-1">
              1.00 = same as room base rate · 1.20 = +20% · 0.85 = −15%
            </p>
          </div>
        </div>
        <footer className="flex justify-end gap-2 px-4 py-3 border-t border-borderc">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            disabled={code.length < 2 || name.length < 2 || createMutation.isPending}
            onClick={() => createMutation.mutate()}
            className="btn-primary"
          >
            {createMutation.isPending ? "Creating…" : "Create"}
          </button>
        </footer>
      </div>
    </div>
  );
}
