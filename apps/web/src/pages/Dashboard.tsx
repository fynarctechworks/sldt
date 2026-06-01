import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BedDouble,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  LogIn,
  LogOut,
  Receipt,
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
    outstanding_balance: number;
  };
  // Operations counters — visible to everyone (no money). Drives the
  // "morning work" cards on the dashboard.
  operations_kpis?: {
    pending_checkouts_today: number;
    rooms_out_of_service: number;
  };
  // Forecast is always present (occupancy-only, no money).
  forecast: {
    total_rooms: number;
    days: { day: string; occupied: number; arrivals: number }[];
  };
  room_grid: {
    id: string;
    room_number: string;
    room_type: string;
    status: string;
    guest_name: string | null;
    reservation_id: string | null;
    reservation_number: string | null;
    // Upcoming hold window when the room is sellable tonight but
    // booked for a future stay. Both ends are yyyy-MM-dd.
    held_from: string | null;
    held_to: string | null;
    // Same-day re-let: room currently held by a walk-in but a
    // confirmed booking is arriving within 24h.
    relet_pending: { nextGuestName: string; nextCheckIn: string } | null;
  }[];
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
          value={`${data.occupancy.occupied} / ${data.occupancy.total} rooms`}
          sub={`${data.occupancy.percentage}% occupied`}
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

      {/* Operating + financial KPIs. Mixed row:
          - Revenue MTD + Outstanding Balance gated behind view_revenue
            so only users with permission see money figures.
          - Pending Check-outs + Rooms Out of Service are operational
            counters (no rupee values) and visible to everyone — they're
            the morning work queue for housekeeping and the front desk. */}
      {(data.revenue_kpis || data.operations_kpis) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {data.revenue_kpis && (
            <Can do="view_revenue">
              <StatCard
                icon={<Receipt className="w-5 h-5" />}
                label="Revenue MTD"
                value={inr(data.revenue_kpis.mtd_collected)}
                sub="collected this month"
              />
            </Can>
          )}
          {data.revenue_kpis && (
            <Can do="view_revenue">
              <StatCard
                icon={<Wallet className="w-5 h-5" />}
                label="Outstanding Balance"
                value={inr(data.revenue_kpis.outstanding_balance)}
                sub="unpaid across all bookings"
              />
            </Can>
          )}
          {data.operations_kpis && (
            <StatCard
              icon={<LogOut className="w-5 h-5" />}
              label="Pending Check-outs"
              value={String(data.operations_kpis.pending_checkouts_today)}
              sub="due today, not yet processed"
            />
          )}
          {data.operations_kpis && (
            <StatCard
              icon={<BedDouble className="w-5 h-5" />}
              label="Rooms Out of Service"
              value={String(data.operations_kpis.rooms_out_of_service)}
              sub="maintenance + dirty"
            />
          )}
        </div>
      )}

      <div className="card">
        <h2 className="font-semibold text-brand-dark mb-4">Availability by Room Type</h2>
        <div className="grid grid-cols-1 gap-4">
          {groupByType(data.room_grid).map((g) => {
            // "Sellable tonight" = truly available + held-tonight-but-
            // -reserved-for-future. Drives the big headline number so
            // staff sees what they can actually book.
            const sellable = g.available + g.held;
            const pct = g.total > 0 ? Math.round((sellable / g.total) * 100) : 0;
            const availPct = g.total > 0 ? (g.available / g.total) * 100 : 0;
            const heldPct = g.total > 0 ? (g.held / g.total) * 100 : 0;
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
            if (g.held > 0) chips.push({ label: "Held", count: g.held, bgTint: "bg-warning/15", dot: "bg-warning" });
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
                  <div className="text-3xl font-bold text-brand">{sellable}</div>
                  <div className="text-xs text-textSecondary">
                    sellable tonight · {pct}%
                    {g.held > 0 && (
                      <span className="ml-1 text-warning font-semibold">
                        ({g.held} held)
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex h-3 mt-3 rounded-full overflow-hidden bg-borderc/40 ring-1 ring-borderc">
                  {availPct > 0 && <div className="bg-[#E6B800]" style={{ width: `${availPct}%` }} title={`Available ${g.available}`} />}
                  {heldPct > 0 && <div className="bg-warning" style={{ width: `${heldPct}%` }} title={`Held tonight ${g.held}`} />}
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

                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 gap-2.5 mt-4">
                  {g.rooms.map((r) => (
                    <RoomTile
                      key={r.id}
                      room={r}
                      onWalkIn={() =>
                        navigate(`/reservations/new?mode=walkin&room=${r.id}`)
                      }
                      onOpenReservation={() => {
                        // Prefer the human-readable SLDT-RES-NNNN — the
                        // API resolves either, but a shareable URL is
                        // the point of this work.
                        const handle = r.reservation_number ?? r.reservation_id;
                        if (handle) navigate(`/reservations/${handle}`);
                      }}
                      onOpenRoom={() => navigate(`/rooms/${r.room_number}`)}
                    />
                  ))}
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
        onClick={() => onOpen(row.reservationNumber || row.id)}
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

// Single-source tile component. Handles every room status with a
// consistent card frame so available/occupied/reserved/housekeeping
// rooms all use the same visual language. Held-tonight rooms get an
// extra footer band so the desk sees at a glance that the room is
// free now but locked for an upcoming arrival.
function RoomTile({
  room,
  onWalkIn,
  onOpenReservation,
  onOpenRoom,
}: {
  room: RoomGridRow;
  onWalkIn: () => void;
  onOpenReservation: () => void;
  onOpenRoom: () => void;
}) {
  const isHousekeeping =
    room.status === "dirty" ||
    room.status === "clean" ||
    room.status === "inspected" ||
    room.status === "maintenance";

  // Hold window: render both edges so staff sees the lock period at a
  // glance. Same-month windows compress to "02 → 03 Jun"; cross-month
  // windows show both labels "30 Jun → 02 Jul".
  const fmtDay = (d: string) =>
    new Date(d).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
    });
  const fmtDayOnly = (d: string) =>
    new Date(d).toLocaleDateString("en-IN", { day: "2-digit" });
  const heldFromShort = room.held_from ? fmtDay(room.held_from) : null;
  const heldRange = (() => {
    if (!room.held_from) return null;
    if (!room.held_to) return heldFromShort;
    const fromMonth = new Date(room.held_from).getMonth();
    const toMonth = new Date(room.held_to).getMonth();
    const sameMonth = fromMonth === toMonth;
    return sameMonth
      ? `${fmtDayOnly(room.held_from)} → ${fmtDay(room.held_to)}`
      : `${fmtDay(room.held_from)} → ${fmtDay(room.held_to)}`;
  })();
  const showHoldHint = !!room.held_from && room.status === "available";

  // Visual tokens per status. Keeping this in one map (rather than the
  // utility-class soup we had before) makes the colour story easy to
  // see at a glance.
  const STYLES: Record<
    string,
    { card: string; statusText: string; statusDot: string; label: string }
  > = {
    available: {
      card: "bg-success/5 border-success/40 text-success",
      statusText: "text-success",
      statusDot: "bg-success",
      label: "Available",
    },
    occupied: {
      card: "bg-brand-dark text-cream border-brand-dark",
      statusText: "text-cream/90",
      statusDot: "bg-cream",
      label: "Occupied",
    },
    reserved: {
      card: "bg-warning/10 border-warning/50 text-warning",
      statusText: "text-warning",
      statusDot: "bg-warning",
      label: "Reserved",
    },
    dirty: {
      card: "bg-[#FBEFD9] border-[#B45309]/40 text-[#B45309]",
      statusText: "text-[#B45309]",
      statusDot: "bg-[#B45309]",
      label: "Dirty",
    },
    clean: {
      card: "bg-yellow-50 border-yellow-300 text-yellow-800",
      statusText: "text-yellow-800",
      statusDot: "bg-yellow-500",
      label: "Clean",
    },
    inspected: {
      card: "bg-success/5 border-success/40 text-success",
      statusText: "text-success",
      statusDot: "bg-success",
      label: "Inspected",
    },
    maintenance: {
      card: "bg-danger/5 border-danger/40 text-danger",
      statusText: "text-danger",
      statusDot: "bg-danger",
      label: "Maintenance",
    },
  };
  const style = STYLES[room.status] ?? STYLES.available!;

  const tile = (
    <div
      className={`relative w-full rounded-lg border-2 overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer ${style.card}`}
      title={
        room.relet_pending
          ? `Same-day re-let: walk-in checks out today, ${room.relet_pending.nextGuestName} arrives ${room.relet_pending.nextCheckIn}`
          : showHoldHint
            ? `Free tonight. Booked for ${room.guest_name ?? "a guest"} from ${room.held_from}${
                room.held_to ? ` to ${room.held_to}` : ""
              }.`
            : room.guest_name
              ? room.guest_name
              : undefined
      }
    >
      {room.relet_pending && (
        <span
          className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-info ring-2 ring-cream animate-pulse"
          aria-label="Same-day re-let"
        />
      )}
      <div className="px-3 py-3 flex flex-col items-center gap-1">
        <span className="font-mono text-2xl font-bold tracking-wide">
          {room.room_number}
        </span>
        <span className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-bold ${style.statusText}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${style.statusDot}`} />
          {style.label}
        </span>
        {(room.status === "occupied" || room.status === "reserved") &&
          room.guest_name && (
            <span className="text-[10px] mt-0.5 truncate w-full text-center opacity-80">
              {room.guest_name.split(" ")[0]}
            </span>
          )}
      </div>
      {showHoldHint && heldRange && (
        <div className="flex items-center justify-center gap-1 px-2 py-1 bg-warning text-cream text-[9px] uppercase tracking-wider font-bold">
          <CalendarClock className="w-2.5 h-2.5" />
          Held {heldRange}
        </div>
      )}
    </div>
  );

  if (isHousekeeping) {
    return (
      <RoomActionPopover
        roomId={room.id}
        roomNumber={room.room_number}
        status={room.status as "dirty" | "clean" | "inspected" | "maintenance"}
        trigger={tile}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (room.status === "available") onWalkIn();
        else if (
          (room.status === "occupied" || room.status === "reserved") &&
          room.reservation_id
        )
          onOpenReservation();
        else onOpenRoom();
      }}
      className="text-left"
    >
      {tile}
    </button>
  );
}

interface RoomGridRow {
  reservation_id: string | null;
  reservation_number: string | null;
  id: string;
  room_number: string;
  room_type: string;
  status: string;
  guest_name: string | null;
  // Upcoming hold window. Both ends are yyyy-MM-dd. Used to render
  // "HELD 02 → 03 JUN" on the tile so the desk sees both edges of
  // the lock at a glance.
  held_from: string | null;
  held_to: string | null;
  relet_pending: { nextGuestName: string; nextCheckIn: string } | null;
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
      // Sellable tonight but locked for an upcoming arrival. Counted
      // separately so the strip stays accurate (a held room isn't
      // both "fully available" and "reserved" — it's neither).
      held: number;
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
        held: 0,
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
    // Tile-level effective_status drives the bucket. Available rooms
    // that have a future hold go to the dedicated 'held' bucket so
    // the strip stays exclusive (no room counted twice). True
    // 'reserved' (someone arriving today) keeps its own bucket.
    if (r.status === "available" && r.held_from) g.held++;
    else if (r.status === "available") g.available++;
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
