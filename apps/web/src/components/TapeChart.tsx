// Tape-chart calendar — the signature PMS screen. Rooms run down the
// Y axis, dates across the X axis, and every active reservation is a
// horizontal bar that spans its check-in → check-out cells. This is
// what hotel staff use to do allocation at a glance and what
// Cloudbeds / Mews / Opera all centre their UX around.
//
// Two notable mechanics:
//   - Day-use (short_stay) bookings have checkInDate === checkOutDate.
//     They render as a single-cell bar on that day with a distinct
//     diagonal-stripe pattern so they don't get confused with overnight.
//   - A reservation that runs OUT of the visible window clips to the
//     window edge; the bar gets a chevron hint on the cut side.
//
// Click a bar → open the reservation. Click an empty cell → start a
// walk-in pre-filled with that room + that arrival date.

import { differenceInCalendarDays, format, isToday, parseISO } from "date-fns";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

interface TapeRoom {
  id: string;
  roomNumber: string;
  floor: number;
  roomType: string;
  status: string;
}

interface TapeSegment {
  roomId: string;
  reservationId: string;
  reservationNumber: string;
  status:
    | "inquiry"
    | "hold"
    | "pending_payment"
    | "confirmed"
    | "checked_in"
    | "checked_out"
    | "cancelled"
    | "no_show";
  bookingSource: string | null;
  stayType: "overnight" | "short_stay" | null;
  durationHours: string | null;
  checkInDate: string;
  checkOutDate: string;
  guestName: string;
  isVip: boolean;
}

export interface TapeChartData {
  start: string;
  end: string;
  days: string[];
  rooms: TapeRoom[];
  segments: TapeSegment[];
}

// Status → bar appearance. Hold + pending_payment use the brass family
// to telegraph "tentative"; checked_in uses the strongest brand-dark
// so the front desk's eye snaps to in-house guests first.
const STATUS_BAR: Record<TapeSegment["status"], string> = {
  inquiry: "bg-textSecondary/20 border-textSecondary/40 text-textSecondary",
  hold: "bg-brass/20 border-brass text-brand-dark",
  pending_payment: "bg-warning/20 border-warning text-warning",
  confirmed: "bg-brass/30 border-brass text-brand-dark",
  checked_in: "bg-brand-dark border-brand-dark text-cream",
  checked_out: "bg-bg border-borderc text-textSecondary",
  cancelled: "bg-danger/10 border-danger/30 text-danger line-through",
  no_show: "bg-warning/20 border-warning text-warning",
};

// Column width is a CSS variable so we can shrink it on dense views.
// 64px is the sweet spot for "guest name fits, 14 days visible on a
// laptop" — enough for a front-desk monitor.
const COL_W = 64;
const ROW_H = 40;
const ROOM_COL_W = 96;

export function TapeChart({ data }: { data: TapeChartData }) {
  const navigate = useNavigate();

  // Index segments by room for O(rooms + segments) render rather than
  // O(rooms × segments).
  const segmentsByRoom = useMemo(() => {
    const m = new Map<string, TapeSegment[]>();
    for (const s of data.segments) {
      const arr = m.get(s.roomId) ?? [];
      arr.push(s);
      m.set(s.roomId, arr);
    }
    return m;
  }, [data.segments]);

  // Index for day → column. Days are sorted from the API so this is a
  // straight position lookup.
  const dayIndex = useMemo(() => {
    const m = new Map<string, number>();
    data.days.forEach((d, i) => m.set(d, i));
    return m;
  }, [data.days]);

  const gridWidth = ROOM_COL_W + data.days.length * COL_W;

  return (
    <div className="border border-borderc rounded-md bg-surface overflow-auto">
      <div style={{ width: gridWidth }} className="relative">
        {/* Header row: room column header + date columns. Sticky so the
            date strip stays visible as the user scrolls vertically. */}
        <div
          className="sticky top-0 z-20 grid bg-brand-soft/60 border-b border-borderc"
          style={{
            gridTemplateColumns: `${ROOM_COL_W}px repeat(${data.days.length}, ${COL_W}px)`,
          }}
        >
          <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-brand-dark border-r border-borderc bg-brand-soft sticky left-0 z-30">
            Room
          </div>
          {data.days.map((d) => {
            const dt = parseISO(d);
            const today = isToday(dt);
            return (
              <div
                key={d}
                className={`px-1 py-2 text-center text-[10px] border-r border-borderc/60 leading-tight ${
                  today ? "bg-brand-dark text-cream font-semibold" : "text-textSecondary"
                }`}
              >
                <div className="uppercase tracking-wider">{format(dt, "EEE")}</div>
                <div className={`text-base font-bold ${today ? "text-cream" : "text-brand-dark"}`}>
                  {format(dt, "d")}
                </div>
                <div className="opacity-70">{format(dt, "MMM")}</div>
              </div>
            );
          })}
        </div>

        {/* Room rows */}
        {data.rooms.map((room) => {
          const segs = segmentsByRoom.get(room.id) ?? [];
          return (
            <div
              key={room.id}
              className="relative grid border-b border-borderc/60"
              style={{
                gridTemplateColumns: `${ROOM_COL_W}px repeat(${data.days.length}, ${COL_W}px)`,
                minHeight: ROW_H,
              }}
            >
              {/* Sticky room label */}
              <button
                onClick={() => navigate(`/rooms/${room.roomNumber}`)}
                className="sticky left-0 z-10 bg-surface border-r border-borderc px-3 text-left flex flex-col justify-center hover:bg-bg"
                style={{ height: ROW_H }}
                title={`${room.roomType} · floor ${room.floor}`}
              >
                <div className="font-mono font-bold text-brand-dark text-sm">{room.roomNumber}</div>
                <div className="text-[10px] text-textSecondary truncate">
                  F{room.floor} · {room.roomType.replace(/_/g, " ")}
                </div>
              </button>

              {/* Empty cells — clickable to start a walk-in for that
                  room + that date. Rendered first so segment bars
                  layer on top via absolute positioning. */}
              {data.days.map((d) => (
                <button
                  key={d}
                  onClick={() =>
                    navigate(`/reservations/new?mode=walkin&room=${room.id}&date=${d}`)
                  }
                  className="border-r border-borderc/40 hover:bg-brand-soft/30"
                  style={{ height: ROW_H }}
                  title={`Walk-in: ${room.roomNumber} on ${d}`}
                  aria-label={`Book ${room.roomNumber} for ${d}`}
                />
              ))}

              {/* Reservation segments, absolutely positioned over the cells. */}
              {segs.map((seg) => {
                const startCol = Math.max(0, dayIndex.get(seg.checkInDate) ?? 0);
                const endIndex =
                  dayIndex.get(seg.checkOutDate) ??
                  (seg.checkOutDate > data.end ? data.days.length : 0);
                // Overnight: span = checkOut - checkIn (half-open, so last
                // visible day is checkOut - 1). Day-use: span = 1 cell.
                const isDayUse = seg.stayType === "short_stay";
                const rawSpan = isDayUse
                  ? 1
                  : Math.max(
                      1,
                      differenceInCalendarDays(
                        parseISO(seg.checkOutDate),
                        parseISO(seg.checkInDate),
                      ),
                    );
                const visibleSpan = Math.min(rawSpan, data.days.length - startCol);
                if (visibleSpan <= 0) return null;
                const left = ROOM_COL_W + startCol * COL_W + 2;
                const width = visibleSpan * COL_W - 4;

                const clippedLeft = seg.checkInDate < data.days[0]!;
                const clippedRight =
                  !isDayUse &&
                  parseISO(seg.checkOutDate) >
                    parseISO(data.days[data.days.length - 1]!);

                return (
                  <button
                    key={seg.reservationId + seg.roomId}
                    onClick={() => navigate(`/reservations/${seg.reservationNumber}`)}
                    className={`absolute rounded border text-left px-2 truncate text-[11px] font-medium leading-none flex items-center gap-1 shadow-sm hover:scale-[1.02] hover:shadow-md transition-transform ${STATUS_BAR[seg.status]} ${
                      isDayUse ? "bg-[repeating-linear-gradient(45deg,_transparent_0_3px,_rgba(0,0,0,0.06)_3px_6px)]" : ""
                    } ${clippedLeft ? "rounded-l-none" : ""} ${clippedRight ? "rounded-r-none" : ""}`}
                    style={{
                      top: 4,
                      height: ROW_H - 8,
                      left,
                      width,
                    }}
                    title={`${seg.reservationNumber} · ${seg.guestName} · ${seg.checkInDate} → ${seg.checkOutDate}${seg.isVip ? " · VIP" : ""}`}
                  >
                    {seg.isVip && <span className="shrink-0 text-[10px]">★</span>}
                    <span className="truncate">{seg.guestName}</span>
                    {isDayUse && seg.durationHours && (
                      <span className="ml-auto shrink-0 text-[10px] opacity-80">
                        {Number(seg.durationHours)}h
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}

        {data.rooms.length === 0 && (
          <div className="p-8 text-center text-sm text-textSecondary">
            No rooms to display for this filter.
          </div>
        )}
      </div>
    </div>
  );
}
