// Operations dashboard — pace + pickup + night audit, in one screen.
//
// Three tabs:
//   1. Pace        — booking curves at 0/7/14/30 days lead time
//   2. Pickup      — net room-nights added in last 7d / 30d per stay-date
//   3. Night audit — past audit runs + Run-now button

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, endOfMonth, format, startOfMonth } from "date-fns";
import { Activity, BarChart3, ListChecks } from "lucide-react";
import { useState } from "react";
import { Can } from "@/auth/Can";
import { Loader } from "@/components/Loader";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api";
import { inr } from "@/lib/utils";

type Tab = "pace" | "pickup" | "audit";

export default function OperationsPage() {
  const [tab, setTab] = useState<Tab>("pace");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-brand-dark">Operations</h1>
        <div className="text-xs text-textSecondary mt-0.5">
          Pace · Pickup · Night audit
        </div>
      </div>

      <div className="inline-flex rounded-sm border border-borderc overflow-hidden text-sm max-w-full overflow-x-auto no-scrollbar">
        {(
          [
            { id: "pace" as const, label: "Pace", icon: BarChart3 },
            { id: "pickup" as const, label: "Pickup", icon: Activity },
            { id: "audit" as const, label: "Night Audit", icon: ListChecks },
          ]
        ).map((t, i) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 inline-flex items-center gap-1.5 ${tab === t.id ? "bg-brand-dark text-cream" : "bg-surface hover:bg-bg"} ${i > 0 ? "border-l border-borderc" : ""}`}
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "pace" && <PaceTab />}
      {tab === "pickup" && <PickupTab />}
      {tab === "audit" && <NightAuditTab />}
    </div>
  );
}

function defaultRange() {
  const now = new Date();
  return { from: startOfMonth(now), to: endOfMonth(now) };
}

function PaceTab() {
  const [{ from, to }, setRange] = useState(defaultRange);
  const start = format(from, "yyyy-MM-dd");
  const end = format(to, "yyyy-MM-dd");

  const q = useQuery({
    queryKey: ["pace", start, end],
    queryFn: () =>
      api.get<{ stay_dates: string[]; curves: Record<string, number[]> }>(
        "/reports/pace",
        { date_from: start, date_to: end },
      ),
  });

  // Find max across all curves for the bar scale.
  const maxValue = q.data
    ? Math.max(1, ...Object.values(q.data.curves).flat())
    : 1;

  return (
    <div className="card space-y-3">
      <RangeBar from={from} to={to} onChange={(f, t) => setRange({ from: f, to: t })} />
      {q.isLoading ? (
        <Loader label="Loading pace…" />
      ) : !q.data ? (
        <div className="text-sm text-textSecondary">No data.</div>
      ) : (
        <>
          <p className="text-xs text-textSecondary">
            For each stay date, how many room-nights were on the books at lead
            times of 0 / 7 / 14 / 30 days before that date.
          </p>
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse">
              <thead>
                <tr className="text-textSecondary">
                  <th className="px-2 py-1 text-left">Stay date</th>
                  {Object.keys(q.data.curves).map((lead) => (
                    <th key={lead} className="px-2 py-1 text-right whitespace-nowrap">
                      {lead === "0" ? "Today" : `${lead}d out`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {q.data.stay_dates.map((d, i) => (
                  <tr key={d} className="border-t border-borderc/60">
                    <td className="px-2 py-1 font-mono">{d}</td>
                    {Object.entries(q.data!.curves).map(([lead, vals]) => {
                      const v = vals[i] ?? 0;
                      const pct = (v / maxValue) * 100;
                      return (
                        <td key={lead} className="px-2 py-1 text-right relative">
                          <div className="relative w-full bg-borderc/30 rounded-full h-1.5 overflow-hidden mb-1">
                            <div
                              className="absolute inset-y-0 left-0 bg-brand-dark"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="font-mono">{v}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function PickupTab() {
  const [{ from, to }, setRange] = useState(defaultRange);
  const start = format(from, "yyyy-MM-dd");
  const end = format(to, "yyyy-MM-dd");

  const q = useQuery({
    queryKey: ["pickup", start, end],
    queryFn: () =>
      api.get<{
        rows: { stay_date: string; picked_up_last_7d: number; picked_up_last_30d: number }[];
      }>("/reports/pickup", { date_from: start, date_to: end }),
  });

  return (
    <div className="card space-y-3">
      <RangeBar from={from} to={to} onChange={(f, t) => setRange({ from: f, to: t })} />
      {q.isLoading ? (
        <Loader label="Loading pickup…" />
      ) : !q.data ? (
        <div className="text-sm text-textSecondary">No data.</div>
      ) : (
        <>
          <p className="text-xs text-textSecondary">
            Net room-nights ADDED in the last 7 / 30 days for each upcoming
            stay-date. Positive numbers = booking velocity is healthy.
          </p>
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse w-full">
              <thead>
                <tr className="text-textSecondary text-left">
                  <th className="px-2 py-1">Stay date</th>
                  <th className="px-2 py-1 text-right">Last 7 days</th>
                  <th className="px-2 py-1 text-right">Last 30 days</th>
                </tr>
              </thead>
              <tbody>
                {q.data.rows.map((r) => (
                  <tr key={r.stay_date} className="border-t border-borderc/60">
                    <td className="px-2 py-1 font-mono">{r.stay_date}</td>
                    <td className="px-2 py-1 text-right font-mono">+{r.picked_up_last_7d}</td>
                    <td className="px-2 py-1 text-right font-mono">+{r.picked_up_last_30d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

interface AuditRow {
  id: string;
  businessDate: string;
  roomsSold: number;
  roomsAvailable: number;
  occupancyPct: string;
  totalRevenue: string;
  adr: string;
  revpar: string;
  arrivals: number;
  departures: number;
  noShows: number;
  walkIns: number;
  status: string;
}

function NightAuditTab() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const listQuery = useQuery({
    queryKey: ["night-audit"],
    queryFn: () =>
      api.get<{ data?: AuditRow[] } | AuditRow[]>("/night-audit", { limit: 30 }),
    refetchInterval: 60_000,
  });
  const rows: AuditRow[] = Array.isArray(listQuery.data)
    ? listQuery.data
    : listQuery.data?.data ?? [];

  const runMutation = useMutation({
    mutationFn: (force: boolean) => api.post("/night-audit/run", { force }),
    onSuccess: () => {
      toast("Night audit ran", "success");
      void qc.invalidateQueries({ queryKey: ["night-audit"] });
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-brand-dark text-sm">
            Past audit runs (last 30 days)
          </h3>
          <p className="text-[11px] text-textSecondary mt-0.5">
            Frozen daily snapshots. Idempotent per business date.
          </p>
        </div>
        <Can do="run_night_audit">
          <div className="flex items-center gap-2">
            <button
              onClick={() => runMutation.mutate(false)}
              disabled={runMutation.isPending}
              className="btn-primary !h-9 text-sm"
            >
              {runMutation.isPending ? "Running…" : "Run for yesterday"}
            </button>
            <button
              onClick={() => {
                if (confirm("Force-rerun overwrites yesterday's snapshot. Continue?")) {
                  runMutation.mutate(true);
                }
              }}
              disabled={runMutation.isPending}
              className="btn-secondary !h-9 text-sm"
            >
              Force re-run
            </button>
          </div>
        </Can>
      </div>

      {listQuery.isLoading ? (
        <Loader label="Loading runs…" />
      ) : rows.length === 0 ? (
        <div className="text-sm text-textSecondary py-6 text-center">
          No audit runs yet. Hit "Run for yesterday" to create the first one.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse w-full">
            <thead>
              <tr className="text-textSecondary text-left">
                <th className="px-2 py-1">Date</th>
                <th className="px-2 py-1 text-right">Sold</th>
                <th className="px-2 py-1 text-right">Occ %</th>
                <th className="px-2 py-1 text-right">Revenue</th>
                <th className="px-2 py-1 text-right">ADR</th>
                <th className="px-2 py-1 text-right">RevPAR</th>
                <th className="px-2 py-1 text-right">Arrivals</th>
                <th className="px-2 py-1 text-right">Departures</th>
                <th className="px-2 py-1 text-right">Walk-ins</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-borderc/60">
                  <td className="px-2 py-1 font-mono">{r.businessDate}</td>
                  <td className="px-2 py-1 text-right">{r.roomsSold} / {r.roomsAvailable}</td>
                  <td className="px-2 py-1 text-right">{Number(r.occupancyPct).toFixed(1)}%</td>
                  <td className="px-2 py-1 text-right font-mono">{inr(Number(r.totalRevenue))}</td>
                  <td className="px-2 py-1 text-right font-mono">{inr(Number(r.adr))}</td>
                  <td className="px-2 py-1 text-right font-mono">{inr(Number(r.revpar))}</td>
                  <td className="px-2 py-1 text-right">{r.arrivals}</td>
                  <td className="px-2 py-1 text-right">{r.departures}</td>
                  <td className="px-2 py-1 text-right">{r.walkIns}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RangeBar({
  from,
  to,
  onChange,
}: {
  from: Date;
  to: Date;
  onChange: (from: Date, to: Date) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <label className="text-xs text-textSecondary">From</label>
      <input
        type="date"
        value={format(from, "yyyy-MM-dd")}
        onChange={(e) => onChange(new Date(e.target.value), to)}
        className="input !h-8 text-xs"
      />
      <label className="text-xs text-textSecondary">to</label>
      <input
        type="date"
        value={format(to, "yyyy-MM-dd")}
        onChange={(e) => onChange(from, new Date(e.target.value))}
        className="input !h-8 text-xs"
      />
      <button
        onClick={() => onChange(startOfMonth(new Date()), endOfMonth(new Date()))}
        className="btn-secondary !h-8 text-xs"
      >
        This month
      </button>
      <button
        onClick={() => {
          const today = new Date();
          onChange(today, addDays(today, 30));
        }}
        className="btn-secondary !h-8 text-xs"
      >
        Next 30
      </button>
    </div>
  );
}
