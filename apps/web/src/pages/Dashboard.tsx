import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BedDouble,
  CalendarPlus,
  CheckCircle2,
  LineChart,
  LogIn,
  LogOut,
  Receipt,
  TrendingUp,
  UserPlus,
  Wallet,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Can } from "@/auth/Can";
import { Loader } from "@/components/Loader";
import { RoomActionPopover } from "@/components/RoomActionPopover";
import { api } from "@/lib/api";
import { inr } from "@/lib/utils";

interface TodayRow {
  id: string;
  reservationNumber: string;
  guestName: string;
  status: string;
  roomNumbers: string;
}

interface DashboardData {
  occupancy: { occupied: number; total: number; percentage: number };
  today_checkins: { count: number; reservations: TodayRow[] };
  today_checkouts: { count: number; reservations: TodayRow[] };
  overdue?: {
    count: number;
    reservations: {
      id: string;
      reservationNumber: string;
      guestName: string;
      status: string;
      checkOutDate: string;
      daysOverdue: number;
    }[];
  };
  // Omitted by the API for users without `view_revenue`. We still render
  // the Dashboard, just without the Revenue Today tile.
  revenue_today?: { total_collected: number };
  revenue_kpis?: {
    mtd_collected: number;
    mtd_room_revenue: number;
    mtd_room_nights: number;
    adr: number;
    revpar: number;
  };
  // Forecast is always present (occupancy-only, no money).
  forecast: {
    total_rooms: number;
    days: { day: string; occupied: number; arrivals: number }[];
  };
  room_grid: { id: string; room_number: string; room_type: string; status: string; guest_name: string | null; reservation_id: string | null }[];
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardData>("/dashboard"),
    refetchInterval: 30_000,
  });

  if (isLoading || !data) return <Loader label="Loading dashboard…" size="lg" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-brand-dark">Dashboard</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("/reservations/new?mode=booking")}
            className="btn-secondary inline-flex items-center gap-2"
          >
            <CalendarPlus className="w-4 h-4" /> Pre-booking
          </button>
          <button
            onClick={() => navigate("/reservations/new?mode=walkin")}
            className="btn-primary inline-flex items-center gap-2"
          >
            <UserPlus className="w-4 h-4" /> Walk-in
          </button>
        </div>
      </div>

      {/* Overdue check-out alert now lives in the app-wide sticky
          CheckoutAlerts bar (rendered in AppShell), so it follows
          staff to every page instead of only the Dashboard. The
          duplicate card that used to live here was removed to keep a
          single source of truth. */}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={<BedDouble className="w-5 h-5" />}
          label="Occupancy"
          value={`${data.occupancy.percentage}%`}
          sub={`${data.occupancy.occupied} / ${data.occupancy.total} rooms`}
        />
        <StatCard
          icon={<LogIn className="w-5 h-5" />}
          label="Today's Check-ins"
          value={String(data.today_checkins.count)}
          sub={`${
            data.today_checkins.reservations.filter((r) => r.status === "confirmed").length
          } pending`}
        />
        <StatCard
          icon={<LogOut className="w-5 h-5" />}
          label="Today's Check-outs"
          value={String(data.today_checkouts.count)}
          sub={`${
            data.today_checkouts.reservations.filter((r) => r.status === "checked_in").length
          } pending`}
        />
        <Can do="view_revenue">
          <StatCard
            icon={<Wallet className="w-5 h-5" />}
            label="Revenue Today"
            value={inr(data.revenue_today?.total_collected ?? 0)}
            sub="collected"
          />
        </Can>
      </div>

      {/* Commercial KPIs. Three rupee numbers in a row only make sense
          for users authorised to see money — gated behind view_revenue.
          ADR and RevPAR are the standard hotel-industry benchmarks; we
          surface both so operators can compare against industry data
          (HVS / STR / Hotelivate quarterly reports). */}
      {data.revenue_kpis && (
        <Can do="view_revenue">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              icon={<Receipt className="w-5 h-5" />}
              label="Revenue MTD"
              value={inr(data.revenue_kpis.mtd_collected)}
              sub="collected this month"
            />
            <StatCard
              icon={<LineChart className="w-5 h-5" />}
              label="ADR"
              value={inr(data.revenue_kpis.adr)}
              sub={`${data.revenue_kpis.mtd_room_nights} room-night${data.revenue_kpis.mtd_room_nights === 1 ? "" : "s"}`}
            />
            <StatCard
              icon={<TrendingUp className="w-5 h-5" />}
              label="RevPAR"
              value={inr(data.revenue_kpis.revpar)}
              sub="revenue per available room"
            />
            <StatCard
              icon={<Wallet className="w-5 h-5" />}
              label="Room Revenue MTD"
              value={inr(data.revenue_kpis.mtd_room_revenue)}
              sub="rooms only, ex-extras"
            />
          </div>
        </Can>
      )}

      {/* 7-day forecast strip. Bars sized to occupancy percentage; the
          top of each cell shows the predicted-occupied count out of
          total rooms. Arrivals are inset as a small badge so the desk
          can see "we have 11 in-house tomorrow, of whom 4 are new
          arrivals". Visible to everyone — no money on this widget. */}
      {data.forecast.days.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-brand-dark">Next 7 Days · Forecast</h2>
            <span className="text-xs text-textSecondary">
              {data.forecast.total_rooms} room{data.forecast.total_rooms === 1 ? "" : "s"} total
            </span>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-2">
            {data.forecast.days.map((d, i) => {
              const pct =
                data.forecast.total_rooms > 0
                  ? Math.round((d.occupied / data.forecast.total_rooms) * 100)
                  : 0;
              const dt = new Date(d.day + "T00:00:00");
              return (
                <div
                  key={d.day}
                  className="border border-borderc rounded-md p-2 bg-surface flex flex-col gap-1"
                  title={`${d.occupied} occupied · ${d.arrivals} arriving · ${pct}%`}
                >
                  <div className="text-[10px] uppercase tracking-wider text-textSecondary leading-none">
                    {i === 0
                      ? "Today"
                      : dt.toLocaleDateString("en-IN", { weekday: "short" })}
                  </div>
                  <div className="text-xs font-mono text-brand-dark leading-none">
                    {dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-borderc/40 overflow-hidden">
                    <div
                      className={`h-full ${pct >= 80 ? "bg-danger" : pct >= 50 ? "bg-brass" : "bg-brand-dark"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-semibold text-brand-dark">{pct}%</span>
                    {d.arrivals > 0 && (
                      <span className="text-[10px] text-brass bg-brass/15 px-1.5 py-0.5 rounded-sm font-semibold">
                        +{d.arrivals}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="font-semibold text-brand-dark mb-4">Availability by Room Type</h2>
        <div className="grid grid-cols-1 gap-4">
          {groupByType(data.room_grid).map((g) => {
            const pct = g.total > 0 ? Math.round((g.available / g.total) * 100) : 0;
            const availPct = g.total > 0 ? (g.available / g.total) * 100 : 0;
            const occPct = g.total > 0 ? (g.occupied / g.total) * 100 : 0;
            const resPct = g.total > 0 ? (g.reserved / g.total) * 100 : 0;
            const dirtyPct = g.total > 0 ? (g.dirty / g.total) * 100 : 0;
            const cleanPct = g.total > 0 ? (g.clean / g.total) * 100 : 0;
            const inspPct = g.total > 0 ? (g.inspected / g.total) * 100 : 0;
            const maintPct = g.total > 0 ? (g.maintenance / g.total) * 100 : 0;

            // Always-visible primary chips, then conditional housekeeping chips
            const chips: { label: string; count: number; bgTint: string; dot: string }[] = [
              { label: "Available", count: g.available, bgTint: "bg-[#E6B800]/15", dot: "bg-[#E6B800]" },
              { label: "Occupied", count: g.occupied, bgTint: "bg-[#0F3D2E]/10", dot: "bg-[#0F3D2E]" },
              { label: "Reserved", count: g.reserved, bgTint: "bg-[#B08A4A]/15", dot: "bg-[#B08A4A]" },
            ];
            if (g.dirty > 0) chips.push({ label: "Dirty", count: g.dirty, bgTint: "bg-[#D9A441]/15", dot: "bg-[#D9A441]" });
            if (g.clean > 0) chips.push({ label: "Clean", count: g.clean, bgTint: "bg-[#5B8BAF]/10", dot: "bg-[#5B8BAF]" });
            if (g.inspected > 0) chips.push({ label: "Inspected", count: g.inspected, bgTint: "bg-[#3F7D4F]/15", dot: "bg-[#3F7D4F]" });
            if (g.maintenance > 0) chips.push({ label: "Maintenance", count: g.maintenance, bgTint: "bg-[#2A2A2A]/10", dot: "bg-[#2A2A2A]" });

            return (
              <div key={g.type} className="border border-borderc rounded-md p-4 bg-surface">
                <div className="flex justify-between items-baseline mb-3">
                  <div className="font-semibold text-brand-dark capitalize">{g.type.replace(/_/g, " ")}</div>
                  <div className="text-xs text-textSecondary">{g.total} total</div>
                </div>

                <div className="flex items-baseline gap-2">
                  <div className="text-3xl font-bold text-brand">{g.available}</div>
                  <div className="text-xs text-textSecondary">available · {pct}%</div>
                </div>

                <div className="flex h-3 mt-3 rounded-full overflow-hidden bg-borderc/40 ring-1 ring-borderc">
                  {availPct > 0 && <div className="bg-[#E6B800]" style={{ width: `${availPct}%` }} title={`Available ${g.available}`} />}
                  {occPct > 0 && <div className="bg-[#0F3D2E]" style={{ width: `${occPct}%` }} title={`Occupied ${g.occupied}`} />}
                  {resPct > 0 && <div className="bg-[#B08A4A]" style={{ width: `${resPct}%` }} title={`Reserved ${g.reserved}`} />}
                  {dirtyPct > 0 && <div className="bg-[#D9A441]" style={{ width: `${dirtyPct}%` }} title={`Dirty ${g.dirty}`} />}
                  {cleanPct > 0 && <div className="bg-[#5B8BAF]" style={{ width: `${cleanPct}%` }} title={`Clean ${g.clean}`} />}
                  {inspPct > 0 && <div className="bg-[#3F7D4F]" style={{ width: `${inspPct}%` }} title={`Inspected ${g.inspected}`} />}
                  {maintPct > 0 && <div className="bg-[#2A2A2A]" style={{ width: `${maintPct}%` }} title={`Maintenance ${g.maintenance}`} />}
                </div>

                <div className="grid grid-cols-3 gap-2 mt-3">
                  {chips.map((c) => (
                    <div key={c.label} className={`flex items-center gap-2 px-2 py-1.5 rounded ${c.bgTint}`}>
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${c.dot}`} />
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-wide text-textSecondary leading-none">{c.label}</div>
                        <div className="text-sm font-semibold text-brand-dark leading-tight">{c.count}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2 mt-4">
                  {g.rooms.map((r) => {
                    const isHousekeeping =
                      r.status === "dirty" ||
                      r.status === "clean" ||
                      r.status === "inspected" ||
                      r.status === "maintenance";

                    const tile = (
                      <span
                        className={`min-w-[84px] sm:min-w-[112px] px-3 sm:px-4 py-2 sm:py-3 rounded-lg font-mono shadow-sm border-2 hover:scale-105 hover:shadow-md transition-all flex flex-col items-center leading-tight cursor-pointer ${gridColor(r.status)}`}
                      >
                        <span className="text-2xl font-bold tracking-wide">{r.room_number}</span>
                        <span className="text-[11px] uppercase tracking-[0.1em] font-semibold opacity-90 mt-1">
                          {r.status.replace(/_/g, " ")}
                        </span>
                      </span>
                    );

                    if (isHousekeeping) {
                      return (
                        <RoomActionPopover
                          key={r.id}
                          roomId={r.id}
                          roomNumber={r.room_number}
                          status={r.status as "dirty" | "clean" | "inspected" | "maintenance"}
                          trigger={tile}
                        />
                      );
                    }

                    const tip =
                      r.status === "available"
                        ? `Walk-in check-in for room ${r.room_number}`
                        : (r.status === "occupied" || r.status === "reserved") && r.reservation_id
                          ? `Open reservation${r.guest_name ? " — " + r.guest_name : ""}`
                          : `Open room ${r.room_number}`;

                    return (
                      <button
                        key={r.id}
                        onClick={() => {
                          if (r.status === "available") {
                            navigate(`/reservations/new?mode=walkin&room=${r.id}`);
                          } else if (
                            (r.status === "occupied" || r.status === "reserved") &&
                            r.reservation_id
                          ) {
                            navigate(`/reservations/${r.reservation_id}`);
                          } else {
                            navigate(`/rooms/${r.id}`);
                          }
                        }}
                        className={`min-w-[84px] sm:min-w-[112px] px-3 sm:px-4 py-2 sm:py-3 rounded-lg font-mono shadow-sm border-2 hover:scale-105 hover:shadow-md transition-all flex flex-col items-center leading-tight ${gridColor(r.status)}`}
                        title={tip}
                      >
                        <span className="text-2xl font-bold tracking-wide">{r.room_number}</span>
                        <span className="text-[11px] uppercase tracking-[0.1em] font-semibold opacity-90 mt-1">
                          {r.status.replace(/_/g, " ")}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TodayPanel
          kind="arrivals"
          title="Today's Check-ins"
          rows={data.today_checkins.reservations}
          emptyMessage="No arrivals today."
          onOpen={(id) => navigate(`/reservations/${id}`)}
        />
        <TodayPanel
          kind="departures"
          title="Today's Check-outs"
          rows={data.today_checkouts.reservations}
          emptyMessage="No departures today."
          onOpen={(id) => navigate(`/reservations/${id}`)}
        />
      </div>

    </div>
  );
}

type TodayKind = "arrivals" | "departures";

function TodayPanel({
  kind,
  title,
  rows,
  emptyMessage,
  onOpen,
}: {
  kind: TodayKind;
  title: string;
  rows: TodayRow[];
  emptyMessage: string;
  onOpen: (id: string) => void;
}) {
  // Pending = the row still needs an action. For arrivals it's "confirmed",
  // for departures it's "checked_in".
  const pendingStatus = kind === "arrivals" ? "confirmed" : "checked_in";
  const pending = rows.filter((r) => r.status === pendingStatus);
  const done = rows.filter((r) => r.status !== pendingStatus);

  const HeaderIcon = kind === "arrivals" ? LogIn : LogOut;

  return (
    <div className="card !p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-borderc flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <HeaderIcon className="w-4 h-4 text-brand" />
          <strong className="text-brand-dark">{title}</strong>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-semibold">
          {pending.length > 0 && (
            <span className="px-2 py-0.5 rounded-sm bg-warning/15 text-warning">
              {pending.length} pending
            </span>
          )}
          {done.length > 0 && (
            <span className="px-2 py-0.5 rounded-sm bg-success/15 text-success">
              {done.length} done
            </span>
          )}
          {rows.length === 0 && (
            <span className="text-textSecondary">0 today</span>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-6 text-textSecondary text-sm">{emptyMessage}</div>
      ) : (
        <ul className="divide-y divide-borderc">
          {/* Pending first so they're visually prioritised, then the done rows. */}
          {[...pending, ...done].map((r) => (
            <TodayRowItem key={r.id} kind={kind} row={r} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TodayRowItem({
  kind,
  row,
  onOpen,
}: {
  kind: TodayKind;
  row: TodayRow;
  onOpen: (id: string) => void;
}) {
  const isArrivalPending = kind === "arrivals" && row.status === "confirmed";
  const isDeparturePending = kind === "departures" && row.status === "checked_in";
  const isArrivalDone = kind === "arrivals" && row.status === "checked_in";
  const isDepartureDone = kind === "departures" && row.status === "checked_out";

  // Smart action — see chat thread; all routes deep-link to the reservation
  // page because both check-in and check-out require their own multi-step
  // modals that already live there.
  let actionLabel = "View";
  let ActionIcon = ArrowRight;
  let actionTone: "primary" | "secondary" = "secondary";
  if (isArrivalPending) {
    actionLabel = "Start check-in";
    ActionIcon = LogIn;
    actionTone = "primary";
  } else if (isDeparturePending) {
    actionLabel = "Start check-out";
    ActionIcon = LogOut;
    actionTone = "primary";
  } else if (isDepartureDone || isArrivalDone) {
    actionLabel = "Open";
    ActionIcon = ArrowRight;
    actionTone = "secondary";
  }

  // Status pill colouring — derive from the row's literal status.
  const statusPill = (() => {
    if (row.status === "confirmed") {
      return { label: "Confirmed", cls: "bg-brand-soft text-brand-dark" };
    }
    if (row.status === "checked_in") {
      return { label: "Checked in", cls: "bg-success/15 text-success" };
    }
    if (row.status === "checked_out") {
      return { label: "Checked out", cls: "bg-textSecondary/15 text-textSecondary" };
    }
    return { label: row.status, cls: "bg-bg text-textSecondary" };
  })();

  const PillIcon =
    row.status === "checked_in" || row.status === "checked_out"
      ? CheckCircle2
      : Receipt;

  const rooms = row.roomNumbers
    ? row.roomNumbers.split(",").filter(Boolean)
    : [];

  return (
    <li className="flex items-center gap-3 px-4 py-3 hover:bg-brand-soft/30 transition-colors">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-brand-dark truncate">{row.guestName}</span>
          {rooms.map((rm) => (
            <span
              key={rm}
              className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded-sm bg-bg border border-borderc text-brand-dark"
            >
              Room {rm}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="font-mono text-[11px] text-accentBlue">{row.reservationNumber}</span>
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-semibold ${statusPill.cls}`}
          >
            <PillIcon className="w-2.5 h-2.5" />
            {statusPill.label}
          </span>
        </div>
      </div>

      <button
        onClick={() => onOpen(row.id)}
        className={`inline-flex items-center gap-1.5 px-2.5 h-8 text-xs font-semibold rounded-sm border transition-colors shrink-0 ${
          actionTone === "primary"
            ? "bg-brand text-cream border-brand hover:bg-brand-dark"
            : "bg-surface text-textSecondary border-borderc hover:border-brand hover:text-brand"
        }`}
      >
        <ActionIcon className="w-3.5 h-3.5" />
        {actionLabel}
      </button>
    </li>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <div className="text-textSecondary text-xs uppercase tracking-wide">{label}</div>
        <div className="text-accentBlue">{icon}</div>
      </div>
      <div className="text-2xl font-bold text-navy mt-2">{value}</div>
      <div className="text-xs text-textSecondary mt-1">{sub}</div>
    </div>
  );
}

interface RoomGridRow {
  reservation_id: string | null;
  id: string;
  room_number: string;
  room_type: string;
  status: string;
  guest_name: string | null;
}

function groupByType(rooms: RoomGridRow[]) {
  const map = new Map<
    string,
    {
      type: string;
      total: number;
      available: number;
      occupied: number;
      reserved: number;
      dirty: number;
      clean: number;
      inspected: number;
      maintenance: number;
      rooms: RoomGridRow[];
    }
  >();
  for (const r of rooms) {
    const key = r.room_type || "untyped";
    if (!map.has(key)) {
      map.set(key, {
        type: key,
        total: 0,
        available: 0,
        occupied: 0,
        reserved: 0,
        dirty: 0,
        clean: 0,
        inspected: 0,
        maintenance: 0,
        rooms: [],
      });
    }
    const g = map.get(key)!;
    g.total++;
    g.rooms.push(r);
    if (r.status === "available") g.available++;
    else if (r.status === "occupied") g.occupied++;
    else if (r.status === "reserved") g.reserved++;
    else if (r.status === "dirty") g.dirty++;
    else if (r.status === "clean") g.clean++;
    else if (r.status === "inspected") g.inspected++;
    else if (r.status === "maintenance") g.maintenance++;
  }
  return Array.from(map.values())
    .map((g) => ({ ...g, rooms: g.rooms.sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true })) }))
    .sort((a, b) => a.type.localeCompare(b.type));
}

function gridColor(status: string): string {
  switch (status) {
    case "available":
      return "bg-[#E6B800] text-[#3A2A0A] border-[#E6B800] hover:opacity-90";
    case "occupied":
      return "bg-[#0F3D2E] text-white border-[#0F3D2E] hover:opacity-90";
    case "reserved":
      return "bg-[#B08A4A] text-white border-[#B08A4A] hover:opacity-90";
    case "dirty":
      return "bg-white text-[#A87724] border-[#D9A441] hover:bg-[#FFF7E2]";
    case "clean":
      return "bg-white text-[#3F6B8C] border-[#5B8BAF] hover:bg-[#EAF2F8]";
    case "inspected":
      return "bg-[#3F7D4F] text-white border-[#3F7D4F] hover:opacity-90";
    case "maintenance":
      return "bg-[#2A2A2A] text-white border-[#2A2A2A] hover:opacity-90";
    default:
      return "bg-white text-textSecondary border-borderc";
  }
}
