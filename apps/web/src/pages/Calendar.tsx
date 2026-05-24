import { useQuery } from "@tanstack/react-query";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, Gift, LayoutGrid } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader } from "@/components/Loader";
import { TapeChart, type TapeChartData } from "@/components/TapeChart";
import { api } from "@/lib/api";

interface CalendarBooking {
  id: string;
  reservationNumber: string;
  status:
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
  roomNumbers: string;
}

// Status → pill colour. Brand palette + standard semantic hints.
const STATUS_STYLES: Record<CalendarBooking["status"], string> = {
  confirmed: "bg-brass/15 text-brand-dark border-brass/40",
  checked_in: "bg-brand-dark text-cream border-brand-dark",
  checked_out: "bg-bg text-textSecondary border-borderc",
  cancelled: "bg-danger/10 text-danger border-danger/30 line-through",
  no_show: "bg-warning/15 text-warning border-warning/40",
};

const STATUS_LABELS: Record<CalendarBooking["status"], string> = {
  confirmed: "Confirmed",
  checked_in: "Checked-in",
  checked_out: "Checked-out",
  cancelled: "Cancelled",
  no_show: "No-show",
};

// Day-use bookings store the same date in checkInDate and checkOutDate; we
// still need them to render on that single day, so we accept inclusive
// overlap by checking <= and >=.
function bookingTouchesDay(b: CalendarBooking, day: Date): boolean {
  const dayStr = format(day, "yyyy-MM-dd");
  return b.checkInDate <= dayStr && b.checkOutDate >= dayStr;
}

type CalendarView = "month" | "tape";
// Tape-chart window presets. 14 fits comfortably on a laptop; 30 is the
// "monthly overview" managers want; 7 is for the front desk's weekly
// huddle. Stored in URL? No — view choice resets per visit; the user's
// last cursor sticks via state.
const TAPE_WINDOWS: { label: string; days: number }[] = [
  { label: "7", days: 7 },
  { label: "14", days: 14 },
  { label: "30", days: 30 },
];

export default function CalendarPage() {
  const navigate = useNavigate();
  const [view, setView] = useState<CalendarView>(
    () => (localStorage.getItem("hd:calendarView") as CalendarView | null) ?? "month",
  );
  function changeView(v: CalendarView) {
    setView(v);
    localStorage.setItem("hd:calendarView", v);
  }

  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date | null>(new Date());
  const [tapeAnchor, setTapeAnchor] = useState(() => new Date());
  const [tapeWindow, setTapeWindow] = useState(14);

  const monthParam = format(cursor, "yyyy-MM");

  const { data, isLoading } = useQuery({
    queryKey: ["calendar", monthParam],
    queryFn: () =>
      api.get<{
        month: string;
        firstDay: string;
        lastDay: string;
        bookings: CalendarBooking[];
      }>("/calendar", { month: monthParam }),
    refetchInterval: 60_000,
    enabled: view === "month",
  });

  // Tape-chart fetch — only when its view is active so we don't burn
  // a second query in the background.
  const tapeStart = format(tapeAnchor, "yyyy-MM-dd");
  const tapeEnd = format(addDays(tapeAnchor, tapeWindow - 1), "yyyy-MM-dd");
  const tapeQuery = useQuery({
    queryKey: ["calendar-tape", tapeStart, tapeEnd],
    queryFn: () =>
      api.get<TapeChartData>("/calendar/tape", { start: tapeStart, end: tapeEnd }),
    refetchInterval: 30_000,
    enabled: view === "tape",
  });

  const bookings = data?.bookings ?? [];

  // Grid is the displayed month padded out to whole weeks (Mon-start). So
  // April starts with a couple of greyed-out March days on the leading row.
  const days = useMemo(() => {
    const monthStart = startOfMonth(cursor);
    const monthEnd = endOfMonth(cursor);
    return eachDayOfInterval({
      start: startOfWeek(monthStart, { weekStartsOn: 1 }),
      end: endOfWeek(monthEnd, { weekStartsOn: 1 }),
    });
  }, [cursor]);

  // Build a per-day bucket once so each cell render is O(bookings_today),
  // not O(total_bookings).
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarBooking[]>();
    for (const day of days) {
      const key = format(day, "yyyy-MM-dd");
      m.set(
        key,
        bookings.filter((b) => bookingTouchesDay(b, day)),
      );
    }
    return m;
  }, [days, bookings]);

  // Counts under the month header — useful "is this a busy month" cue.
  const totals = useMemo(() => {
    const byStatus: Record<string, number> = {};
    for (const b of bookings) byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;
    return { total: bookings.length, byStatus };
  }, [bookings]);

  const selectedKey = selectedDay ? format(selectedDay, "yyyy-MM-dd") : null;
  const selectedBookings = selectedKey ? byDay.get(selectedKey) ?? [] : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy">Calendar</h1>
          <div className="text-xs text-textSecondary mt-0.5">
            {view === "month"
              ? `${totals.total} booking${totals.total === 1 ? "" : "s"} in ${format(cursor, "MMMM yyyy")}`
              : `Tape chart · ${tapeStart} → ${tapeEnd}`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle. Persisted to localStorage so each user sticks
              with their preferred default. */}
          <div className="inline-flex rounded-sm border border-borderc overflow-hidden">
            <button
              onClick={() => changeView("month")}
              className={`px-3 py-2 text-sm flex items-center gap-1.5 ${view === "month" ? "bg-brand-dark text-cream" : "bg-surface hover:bg-bg"}`}
              title="Month grid"
            >
              <CalendarDays className="w-4 h-4" /> Month
            </button>
            <button
              onClick={() => changeView("tape")}
              className={`px-3 py-2 text-sm flex items-center gap-1.5 border-l border-borderc ${view === "tape" ? "bg-brand-dark text-cream" : "bg-surface hover:bg-bg"}`}
              title="Tape chart (rooms x dates)"
            >
              <LayoutGrid className="w-4 h-4" /> Tape
            </button>
          </div>

          {view === "month" ? (
            <>
              <button
                onClick={() => setCursor((c) => subMonths(c, 1))}
                className="p-2 rounded-sm border border-borderc bg-surface hover:bg-bg"
                aria-label="Previous month"
                title="Previous month"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  const today = new Date();
                  setCursor(startOfMonth(today));
                  setSelectedDay(today);
                }}
                className="px-3 py-2 text-sm font-medium rounded-sm border border-borderc bg-surface hover:bg-bg"
              >
                Today
              </button>
              <button
                onClick={() => setCursor((c) => addMonths(c, 1))}
                className="p-2 rounded-sm border border-borderc bg-surface hover:bg-bg"
                aria-label="Next month"
                title="Next month"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <input
                type="month"
                className="input !h-9 text-sm"
                value={monthParam}
                onChange={(e) => {
                  if (!e.target.value) return;
                  setCursor(parseISO(`${e.target.value}-01`));
                }}
              />
            </>
          ) : (
            <>
              <button
                onClick={() => setTapeAnchor((d) => subDays(d, tapeWindow))}
                className="p-2 rounded-sm border border-borderc bg-surface hover:bg-bg"
                aria-label="Previous window"
                title={`Back ${tapeWindow} days`}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setTapeAnchor(new Date())}
                className="px-3 py-2 text-sm font-medium rounded-sm border border-borderc bg-surface hover:bg-bg"
              >
                Today
              </button>
              <button
                onClick={() => setTapeAnchor((d) => addDays(d, tapeWindow))}
                className="p-2 rounded-sm border border-borderc bg-surface hover:bg-bg"
                aria-label="Next window"
                title={`Forward ${tapeWindow} days`}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <div className="inline-flex rounded-sm border border-borderc overflow-hidden text-xs">
                {TAPE_WINDOWS.map((w) => (
                  <button
                    key={w.days}
                    onClick={() => setTapeWindow(w.days)}
                    className={`px-2.5 py-2 ${tapeWindow === w.days ? "bg-brand-dark text-cream" : "bg-surface hover:bg-bg"} ${w.days !== TAPE_WINDOWS[0]!.days ? "border-l border-borderc" : ""}`}
                  >
                    {w.label}d
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Tape-chart view branch. Keeping it inline (not a sub-component)
          so the toolbar above can swap controls without prop drilling. */}
      {view === "tape" && (
        <>
          {tapeQuery.isLoading ? (
            <Loader label="Loading tape chart…" />
          ) : tapeQuery.data ? (
            <TapeChart data={tapeQuery.data} />
          ) : (
            <div className="card text-sm text-textSecondary">Tape chart unavailable.</div>
          )}
        </>
      )}

      {view === "month" && (
      <>
      <div className="flex flex-wrap items-center gap-3 text-[11px]">
        {(["confirmed", "checked_in", "checked_out", "cancelled", "no_show"] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={`inline-block w-3 h-3 rounded border ${STATUS_STYLES[s]}`} />
            <span className="text-textSecondary">
              {STATUS_LABELS[s]}
              {totals.byStatus[s] ? ` · ${totals.byStatus[s]}` : ""}
            </span>
          </span>
        ))}
      </div>

      {isLoading ? (
        <Loader label="Loading calendar…" />
      ) : (
        <div className="card !p-0 overflow-hidden">
          {/* Weekday header. Monday-start matches Indian hospitality norm. */}
          <div className="grid grid-cols-7 bg-brand-soft/40 border-b border-borderc">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div
                key={d}
                className="text-[11px] tracking-wider uppercase text-textSecondary px-2 py-2 text-center font-semibold"
              >
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {days.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const inMonth = isSameMonth(day, cursor);
              const isSelected = selectedDay && isSameDay(day, selectedDay);
              const dayBookings = byDay.get(key) ?? [];
              const visible = dayBookings.slice(0, 3);
              const overflow = dayBookings.length - visible.length;
              return (
                <button
                  key={key}
                  onClick={() => setSelectedDay(day)}
                  className={`group relative text-left min-h-[72px] sm:min-h-[110px] p-1 sm:p-1.5 border-r border-b border-borderc last:border-r-0 flex flex-col gap-0.5 sm:gap-1 transition-colors ${
                    inMonth ? "bg-surface" : "bg-bg/60"
                  } ${isSelected ? "ring-2 ring-brand-dark ring-inset" : ""} hover:bg-brand-soft/30`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-xs font-semibold ${
                        isToday(day)
                          ? "bg-brand-dark text-cream rounded-full w-6 h-6 grid place-items-center"
                          : inMonth
                          ? "text-brand-dark"
                          : "text-textSecondary/60"
                      }`}
                    >
                      {format(day, "d")}
                    </span>
                    {dayBookings.length > 0 && (
                      <span className="text-[10px] font-mono text-textSecondary">
                        {dayBookings.length}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5 overflow-hidden">
                    {visible.map((b) => (
                      <span
                        key={b.id}
                        className={`text-[10px] leading-tight px-1.5 py-0.5 rounded border truncate ${STATUS_STYLES[b.status]}`}
                        title={`${b.reservationNumber} · ${b.guestName}${b.roomNumbers ? ` · Room ${b.roomNumbers}` : ""}`}
                      >
                        {b.bookingSource === "complimentary" && (
                          <Gift className="inline-block w-2.5 h-2.5 mr-0.5 -mt-px" />
                        )}
                        {b.roomNumbers ? `${b.roomNumbers} ` : ""}
                        {b.guestName}
                      </span>
                    ))}
                    {overflow > 0 && (
                      <span className="text-[10px] text-textSecondary pl-1">
                        +{overflow} more
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Per-day detail panel. Always visible so a day click does something
          even when there are no bookings on it. */}
      {selectedDay && (
        <div className="card">
          <header className="flex items-baseline justify-between gap-3 border-b border-borderc pb-2 mb-3">
            <h2 className="font-semibold text-brand-dark">
              {format(selectedDay, "EEEE, d MMMM yyyy")}
            </h2>
            <span className="text-xs text-textSecondary">
              {selectedBookings.length} booking{selectedBookings.length === 1 ? "" : "s"}
            </span>
          </header>
          {selectedBookings.length === 0 ? (
            <div className="text-sm text-textSecondary py-4 text-center">
              No bookings on this day.
            </div>
          ) : (
            <ul className="divide-y divide-borderc">
              {selectedBookings.map((b) => {
                const sameDay = b.checkInDate === b.checkOutDate;
                const isDayUse = b.stayType === "short_stay";
                const stayLabel = isDayUse
                  ? `Day use${b.durationHours ? ` · ${Number(b.durationHours)}h` : ""}`
                  : sameDay
                  ? "1 day"
                  : `${b.checkInDate} → ${b.checkOutDate}`;
                return (
                  <li
                    key={b.id}
                    onClick={() => navigate(`/reservations/${b.id}`)}
                    className="py-2.5 flex items-center gap-3 cursor-pointer hover:bg-bg -mx-2 px-2 rounded-sm"
                  >
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${STATUS_STYLES[b.status]}`}
                    >
                      {STATUS_LABELS[b.status]}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-navy flex items-center gap-1.5">
                        {b.guestName}
                        {b.bookingSource === "complimentary" && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-brass">
                            <Gift className="w-3 h-3" /> Comp
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-textSecondary font-mono">
                        {b.reservationNumber}
                        {b.roomNumbers ? ` · Room ${b.roomNumbers}` : ""}
                      </div>
                    </div>
                    <div className="text-xs text-textSecondary text-right shrink-0">
                      {stayLabel}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {/* end view === "month" */}
      </>
      )}
    </div>
  );
}
