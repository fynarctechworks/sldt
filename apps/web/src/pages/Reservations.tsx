import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  CalendarPlus,
  ChevronRight,
  Clock,
  DoorOpen,
  Search,
  UserPlus,
  Users,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader } from "@/components/Loader";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/api";
import { inr } from "@/lib/utils";

interface Reservation {
  id: string;
  reservationNumber: string;
  guestId: string;
  guestName: string;
  guestPhone?: string;
  // Signed URL for the guest's customer photo from KYC. Null until KYC is
  // captured — the card falls back to a coloured-initials avatar.
  guestPhotoUrl?: string | null;
  checkInDate: string;
  checkOutDate: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  numNights: number;
  // Day-use bookings: stayType='short_stay' + durationHours. The card shows
  // "Day use · Nh" instead of the night count.
  stayType?: "overnight" | "short_stay";
  durationHours?: string | null;
  // Late-checkout grant in hours, accumulates with each grant. Used to
  // compute the effective overnight check-out time on the card.
  lateCheckoutHours?: string | null;
  // Comma-joined room numbers from the API list endpoint subquery.
  roomNumbers?: string;
  grandTotal: string;
  balanceDue: string;
  status: string;
  createdAt: string;
}

interface PublicSettings {
  checkInTime: string;
  checkOutTime: string;
}

// Renders an "HH:MM" hotel time like "12:00" as "12:00 PM" without a date
// dependency. Used as the fallback when we don't have a real checkedInAt
// timestamp yet.
function formatHotelTime(hhmm: string | undefined | null): string {
  if (!hhmm) return "";
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr);
  const m = mStr ?? "00";
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m.padStart(2, "0")} ${period}`;
}

const STATUS_OPTIONS = [
  "confirmed",
  "checked_in",
  "checked_out",
  "cancelled",
  "no_show",
];

export default function Reservations() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data = [], isLoading } = useQuery({
    queryKey: ["reservations", { status, q, dateFrom, dateTo }],
    queryFn: () =>
      api.get<Reservation[]>("/reservations", {
        status: status || undefined,
        q: q || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      }),
  });

  // Hotel-policy times. We fall back to these when a reservation hasn't been
  // checked in yet (so we can't show the real timestamp).
  const settingsQ = useQuery({
    queryKey: ["settings-public"],
    queryFn: () => api.get<PublicSettings>("/settings/public"),
    staleTime: 5 * 60_000,
  });
  const hotelCheckInTime = settingsQ.data?.checkInTime ?? "12:00";
  const hotelCheckOutTime = settingsQ.data?.checkOutTime ?? "11:00";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Reservations</h1>
          <p className="text-xs text-textSecondary mt-0.5">
            {data.length} reservation{data.length === 1 ? "" : "s"}
          </p>
        </div>
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

      <div className="card flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="label block mb-1">Search (Res # / Guest)</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-textSecondary" />
            <input
              className="input pl-9"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="RES-… or name"
            />
          </div>
        </div>
        <div>
          <label className="label block mb-1">Status</label>
          <select
            className="input w-40"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label block mb-1">Check-in From</label>
          <input
            className="input w-40"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="label block mb-1">Check-in To</label>
          <input
            className="input w-40"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <Loader />
      ) : data.length === 0 ? (
        <div className="card text-textSecondary text-center py-10">
          No reservations match these filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {data.map((r) => (
            <ReservationCard
              key={r.id}
              r={r}
              hotelCheckInTime={hotelCheckInTime}
              hotelCheckOutTime={hotelCheckOutTime}
              onOpen={() => navigate(`/reservations/${r.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Two-char initials from a guest's full name. Same look as Guests page.
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// Stable color tone hashed off the seed, so the same guest always gets the
// same avatar shade across pages.
function avatarTone(seed: string): string {
  const tones = [
    "bg-[#6FAE94] text-white",
    "bg-[#B08A4A] text-white",
    "bg-[#3F6B8C] text-white",
    "bg-brand text-cream",
    "bg-[#A33A30] text-white",
    "bg-[#2F6E55] text-white",
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return tones[h % tones.length]!;
}

function ReservationCard({
  r,
  hotelCheckInTime,
  hotelCheckOutTime,
  onOpen,
}: {
  r: Reservation;
  hotelCheckInTime: string;
  hotelCheckOutTime: string;
  onOpen: () => void;
}) {
  const isShort = r.stayType === "short_stay";
  const dur = Number(r.durationHours ?? 0);
  const bal = Number(r.balanceDue);
  const hasBalance = bal > 0.009;
  const rooms = r.roomNumbers ? r.roomNumbers.split(",").filter(Boolean) : [];

  // Check-in time: real checkedInAt when the guest has arrived; otherwise the
  // hotel's policy time. We render only the time string here since the date
  // sits right above it on the card.
  const checkInTimeLabel = r.checkedInAt
    ? format(new Date(r.checkedInAt), "h:mm a")
    : formatHotelTime(hotelCheckInTime);

  // Check-out time:
  //   - already checked out → use checkedOutAt
  //   - short_stay, checked in → checkedInAt + durationHours
  //   - overnight, checked in → hotel checkOutTime + lateCheckoutHours grant
  //   - confirmed only → policy time (with grant if any)
  const checkOutTimeLabel = (() => {
    if (r.checkedOutAt) return format(new Date(r.checkedOutAt), "h:mm a");
    if (isShort && r.checkedInAt && dur > 0) {
      return format(
        new Date(new Date(r.checkedInAt).getTime() + Math.round(dur * 3600 * 1000)),
        "h:mm a",
      );
    }
    const grantHours = Number(r.lateCheckoutHours ?? 0);
    if (grantHours <= 0) return formatHotelTime(hotelCheckOutTime);
    // Build a Date for the policy time on checkOutDate, add grant hours, render.
    const [hh, mm] = hotelCheckOutTime.split(":");
    const base = new Date(
      `${r.checkOutDate}T${(hh ?? "11").padStart(2, "0")}:${(mm ?? "00").padStart(2, "0")}:00`,
    );
    return format(new Date(base.getTime() + Math.round(grantHours * 3600 * 1000)), "h:mm a");
  })();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group card !p-4 cursor-pointer transition border border-borderc hover:border-brand/50 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
    >
      <div className="flex items-start gap-3">
        {r.guestPhotoUrl ? (
          <img
            src={r.guestPhotoUrl}
            alt={r.guestName}
            className="w-10 h-10 rounded-full object-cover shrink-0 ring-1 ring-borderc bg-bg"
          />
        ) : (
          <div
            className={`w-10 h-10 rounded-full grid place-items-center font-semibold text-sm shrink-0 ${avatarTone(r.guestName)}`}
            aria-hidden="true"
          >
            {initialsOf(r.guestName)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[12px] font-semibold text-accentBlue">
              {r.reservationNumber}
            </span>
            <StatusBadge status={r.status} />
            {isShort && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-semibold bg-brand/10 text-brand-dark border border-brand/30">
                <Clock className="w-3 h-3" /> Day use · {dur}h
              </span>
            )}
          </div>
          <div className="mt-1 text-base font-semibold text-brand-dark truncate">
            {r.guestName}
          </div>
          {r.guestPhone && (
            <div className="text-xs text-textSecondary font-mono">{r.guestPhone}</div>
          )}
        </div>
        <ChevronRight className="w-5 h-5 text-textSecondary/50 group-hover:text-brand shrink-0 mt-1" />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-textSecondary font-semibold">
            Check-in
          </div>
          <div className="text-brand-dark font-medium mt-0.5">
            {format(new Date(r.checkInDate), "dd MMM")}
          </div>
          <div className="text-[11px] text-textSecondary font-mono mt-0.5">
            {r.checkedInAt ? checkInTimeLabel : `from ${checkInTimeLabel}`}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-textSecondary font-semibold">
            Check-out
          </div>
          <div className="text-brand-dark font-medium mt-0.5">
            {format(new Date(r.checkOutDate), "dd MMM")}
          </div>
          <div className="text-[11px] text-textSecondary font-mono mt-0.5">
            {r.checkedOutAt ? checkOutTimeLabel : `by ${checkOutTimeLabel}`}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-textSecondary font-semibold">
            {isShort ? "Duration" : "Nights"}
          </div>
          <div className="text-brand-dark font-medium mt-0.5">
            {isShort ? `${dur} hrs` : r.numNights}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 flex-wrap pt-3 border-t border-borderc">
        <div className="flex items-center gap-2 text-xs text-textSecondary">
          {rooms.length > 0 ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <DoorOpen className="w-3.5 h-3.5" />
              {rooms.map((rm) => (
                <span
                  key={rm}
                  className="font-mono font-semibold text-brand-dark bg-bg px-1.5 py-0.5 rounded border border-borderc"
                >
                  {rm}
                </span>
              ))}
            </div>
          ) : (
            <span className="inline-flex items-center gap-1 text-textSecondary/70">
              <Users className="w-3.5 h-3.5" /> No rooms
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-3">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-textSecondary font-semibold">
              Total
            </div>
            <div className="text-sm font-mono font-bold text-brand-dark">{inr(r.grandTotal)}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-textSecondary font-semibold">
              Balance
            </div>
            <div
              className={`text-sm font-mono font-bold ${
                hasBalance ? "text-danger" : "text-success"
              }`}
            >
              {hasBalance ? inr(r.balanceDue) : "Paid"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
