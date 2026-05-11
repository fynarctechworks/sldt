import { useQuery } from "@tanstack/react-query";
import { BedDouble, CalendarPlus, LogIn, LogOut, UserPlus, Wallet } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Loader } from "@/components/Loader";
import { RoomActionPopover } from "@/components/RoomActionPopover";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/api";
import { inr } from "@/lib/utils";

interface DashboardData {
  occupancy: { occupied: number; total: number; percentage: number };
  today_checkins: { count: number; reservations: { id: string; reservationNumber: string; guestName: string; status: string }[] };
  today_checkouts: { count: number; reservations: { id: string; reservationNumber: string; guestName: string; status: string }[] };
  revenue_today: { total_collected: number };
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
          sub="confirmed reservations"
        />
        <StatCard
          icon={<LogOut className="w-5 h-5" />}
          label="Today's Check-outs"
          value={String(data.today_checkouts.count)}
          sub="checking out today"
        />
        <StatCard
          icon={<Wallet className="w-5 h-5" />}
          label="Revenue Today"
          value={inr(data.revenue_today.total_collected)}
          sub="collected"
        />
      </div>

      <div className="card">
        <h2 className="font-semibold text-brand-dark mb-4">Availability by Room Type</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
              { label: "Available", count: g.available, bgTint: "bg-brand/10", dot: "bg-brand" },
              { label: "Occupied", count: g.occupied, bgTint: "bg-[#B23A2E]/10", dot: "bg-[#B23A2E]" },
              { label: "Reserved", count: g.reserved, bgTint: "bg-[#E6A532]/15", dot: "bg-[#E6A532]" },
            ];
            if (g.dirty > 0) chips.push({ label: "Dirty", count: g.dirty, bgTint: "bg-warning/10", dot: "bg-warning" });
            if (g.clean > 0) chips.push({ label: "Clean", count: g.clean, bgTint: "bg-cream", dot: "bg-brass" });
            if (g.inspected > 0) chips.push({ label: "Inspected", count: g.inspected, bgTint: "bg-brand-mid/15", dot: "bg-brand-mid" });
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
                  {availPct > 0 && <div className="bg-brand" style={{ width: `${availPct}%` }} title={`Available ${g.available}`} />}
                  {occPct > 0 && <div className="bg-[#B23A2E]" style={{ width: `${occPct}%` }} title={`Occupied ${g.occupied}`} />}
                  {resPct > 0 && <div className="bg-[#E6A532]" style={{ width: `${resPct}%` }} title={`Reserved ${g.reserved}`} />}
                  {dirtyPct > 0 && <div className="bg-warning" style={{ width: `${dirtyPct}%` }} title={`Dirty ${g.dirty}`} />}
                  {cleanPct > 0 && <div className="bg-brass" style={{ width: `${cleanPct}%` }} title={`Clean ${g.clean}`} />}
                  {inspPct > 0 && <div className="bg-brand-mid" style={{ width: `${inspPct}%` }} title={`Inspected ${g.inspected}`} />}
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
                        className={`min-w-[72px] px-2.5 py-1.5 rounded-md font-mono shadow-sm border-2 hover:scale-105 hover:shadow-md transition-all flex flex-col items-center leading-tight cursor-pointer ${gridColor(r.status)}`}
                      >
                        <span className="text-base font-bold tracking-wide">{r.room_number}</span>
                        <span className="text-[9px] uppercase tracking-[0.1em] font-semibold opacity-90 mt-0.5">
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
                        className={`min-w-[72px] px-2.5 py-1.5 rounded-md font-mono shadow-sm border-2 hover:scale-105 hover:shadow-md transition-all flex flex-col items-center leading-tight ${gridColor(r.status)}`}
                        title={tip}
                      >
                        <span className="text-base font-bold tracking-wide">{r.room_number}</span>
                        <span className="text-[9px] uppercase tracking-[0.1em] font-semibold opacity-90 mt-0.5">
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
        <div className="card p-0">
          <div className="px-4 py-3 border-b flex justify-between items-center">
            <strong>Today's Check-ins</strong>
            <span className="text-xs text-textSecondary">{data.today_checkins.count}</span>
          </div>
          {data.today_checkins.reservations.length === 0 ? (
            <div className="p-4 text-textSecondary text-sm">No check-ins scheduled.</div>
          ) : (
            <table className="table-base">
              <tbody>
                {data.today_checkins.reservations.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/reservations/${r.id}`)}
                  >
                    <td className="font-mono text-accentBlue">{r.reservationNumber}</td>
                    <td>{r.guestName}</td>
                    <td><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card p-0">
          <div className="px-4 py-3 border-b flex justify-between items-center">
            <strong>Today's Check-outs</strong>
            <span className="text-xs text-textSecondary">{data.today_checkouts.count}</span>
          </div>
          {data.today_checkouts.reservations.length === 0 ? (
            <div className="p-4 text-textSecondary text-sm">No check-outs scheduled.</div>
          ) : (
            <table className="table-base">
              <tbody>
                {data.today_checkouts.reservations.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/reservations/${r.id}`)}
                  >
                    <td className="font-mono text-accentBlue">{r.reservationNumber}</td>
                    <td>{r.guestName}</td>
                    <td><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

    </div>
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
      return "bg-white text-brand-dark border-brand hover:bg-brand-soft";
    case "occupied":
      return "bg-[#B23A2E] text-white border-[#B23A2E] hover:opacity-90";
    case "reserved":
      return "bg-[#E6A532] text-[#3A2A0A] border-[#E6A532] hover:opacity-90";
    case "dirty":
      return "bg-white text-[#C77A2C] border-[#C77A2C] hover:bg-[#FFF4E6]";
    case "clean":
      return "bg-white text-brand border-brand/60 hover:bg-brand-soft";
    case "inspected":
      return "bg-brand text-white border-brand hover:bg-brand-dark";
    case "maintenance":
      return "bg-[#2A2A2A] text-white border-[#2A2A2A] hover:opacity-90";
    default:
      return "bg-white text-textSecondary border-borderc";
  }
}
