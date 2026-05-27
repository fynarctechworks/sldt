import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  endOfMonth,
  endOfWeek,
  endOfYear,
  format,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from "date-fns";
import {
  AlertTriangle,
  BedDouble,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Coins,
  Download,
  Gift,
  Hourglass,
  Inbox,
  Percent,
  Receipt,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import Papa from "papaparse";
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useDialog } from "@/components/Dialog";
import { Loader } from "@/components/Loader";
import { useToast } from "@/components/Toast";
import { api, getList } from "@/lib/api";
import { inr } from "@/lib/utils";

type Tab =
  | "occupancy"
  | "revenue"
  | "invoices"
  | "collections"
  | "gst"
  | "outstanding"
  | "rooms"
  | "guests"
  | "credit";

interface TabDef {
  id: Tab;
  label: string;
  caption: string;
  Icon: typeof Percent;
}

const TABS: TabDef[] = [
  { id: "occupancy", label: "Occupancy", caption: "Daily room fill rate", Icon: Percent },
  { id: "revenue", label: "Revenue", caption: "Earnings + room-type mix", Icon: TrendingUp },
  { id: "invoices", label: "Invoices", caption: "Every tax invoice on the property", Icon: Receipt },
  { id: "collections", label: "Collections", caption: "Money received by method", Icon: Coins },
  { id: "gst", label: "GST", caption: "CGST / SGST summary", Icon: Receipt },
  { id: "outstanding", label: "Outstanding", caption: "Unpaid invoices & promises", Icon: AlertTriangle },
  { id: "rooms", label: "Rooms", caption: "Per-room bookings & revenue", Icon: BedDouble },
  { id: "guests", label: "Top Guests", caption: "Most-frequent stayers", Icon: Users },
  { id: "credit", label: "Complimentary", caption: "Comp & credit bookings", Icon: Gift },
];

// ============================================================
// Date presets
// ============================================================

type PresetKey = "week" | "month" | "year" | "custom";

interface Preset {
  key: PresetKey;
  label: string;
  range: () => { from: Date; to: Date };
}

const PRESETS: Preset[] = [
  {
    key: "week",
    label: "Week",
    range: () => ({
      from: startOfWeek(new Date(), { weekStartsOn: 1 }),
      to: endOfWeek(new Date(), { weekStartsOn: 1 }),
    }),
  },
  {
    key: "month",
    label: "Month",
    range: () => ({ from: startOfMonth(new Date()), to: endOfMonth(new Date()) }),
  },
  {
    key: "year",
    label: "Year",
    range: () => ({ from: startOfYear(new Date()), to: endOfYear(new Date()) }),
  },
];

function fmtDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export default function Reports() {
  const [tab, setTab] = useState<Tab>("occupancy");

  const initial = PRESETS.find((p) => p.key === "month")!.range();
  const [from, setFrom] = useState(fmtDate(initial.from));
  const [to, setTo] = useState(fmtDate(initial.to));
  const [preset, setPreset] = useState<PresetKey>("month");
  const [showCustom, setShowCustom] = useState(false);

  function applyPreset(p: Preset) {
    const r = p.range();
    setFrom(fmtDate(r.from));
    setTo(fmtDate(r.to));
    setPreset(p.key);
    setShowCustom(false);
  }

  const rangeLabel = useMemo(() => {
    const f = format(new Date(from), "dd MMM yyyy");
    const t = format(new Date(to), "dd MMM yyyy");
    return f === t ? f : `${f} → ${t}`;
  }, [from, to]);

  const activeTab = TABS.find((t) => t.id === tab)!;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-navy">Reports</h1>
          <p className="text-xs text-textSecondary mt-0.5">
            {activeTab.caption} · <span className="font-medium">{rangeLabel}</span>
          </p>
        </div>
      </div>

      <DateToolbar
        from={from}
        to={to}
        preset={preset}
        showCustom={showCustom}
        onPreset={(p) => applyPreset(p)}
        onCustom={() => {
          setShowCustom((v) => !v);
          setPreset("custom");
        }}
        onFromChange={(v) => {
          setFrom(v);
          setPreset("custom");
        }}
        onToChange={(v) => {
          setTo(v);
          setPreset("custom");
        }}
      />

      <TabBar tabs={TABS} active={tab} onChange={setTab} />

      {tab === "occupancy" && <OccupancyTab from={from} to={to} />}
      {tab === "revenue" && <RevenueTab from={from} to={to} />}
      {tab === "invoices" && <InvoicesTab from={from} to={to} />}
      {tab === "collections" && <CollectionsTab from={from} to={to} />}
      {tab === "gst" && <GstTab from={from} to={to} />}
      {tab === "outstanding" && <OutstandingTab />}
      {tab === "rooms" && <RoomsTab from={from} to={to} />}
      {tab === "guests" && <GuestsTab from={from} to={to} />}
      {tab === "credit" && <CreditTab from={from} to={to} />}
    </div>
  );
}

// ============================================================
// Toolbar + tabs
// ============================================================

function DateToolbar({
  from,
  to,
  preset,
  showCustom,
  onPreset,
  onCustom,
  onFromChange,
  onToChange,
}: {
  from: string;
  to: string;
  preset: PresetKey;
  showCustom: boolean;
  onPreset: (p: Preset) => void;
  onCustom: () => void;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
}) {
  return (
    <div className="card !p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <CalendarDays className="w-4 h-4 text-brand shrink-0" />
        <div className="flex items-center gap-1 flex-wrap">
          {PRESETS.map((p) => {
            const active = preset === p.key;
            return (
              <button
                key={p.key}
                onClick={() => onPreset(p)}
                className={`px-3 h-8 text-xs font-semibold rounded-sm border transition-colors ${
                  active
                    ? "bg-brand text-cream border-brand"
                    : "bg-surface text-textSecondary border-borderc hover:border-brand hover:text-brand"
                }`}
              >
                {p.label}
              </button>
            );
          })}
          <button
            onClick={onCustom}
            className={`px-3 h-8 text-xs font-semibold rounded-sm border transition-colors inline-flex items-center gap-1 ${
              preset === "custom"
                ? "bg-brand text-cream border-brand"
                : "bg-surface text-textSecondary border-borderc hover:border-brand hover:text-brand"
            }`}
          >
            Custom
            <ChevronDown
              className={`w-3 h-3 transition-transform ${showCustom ? "rotate-180" : ""}`}
            />
          </button>
        </div>
      </div>

      {showCustom && (
        <div className="flex flex-wrap items-end gap-3 mt-3 pt-3 border-t border-borderc">
          <div>
            <label className="label block mb-1">From</label>
            <input
              className="input w-44"
              type="date"
              value={from}
              max={to}
              onChange={(e) => onFromChange(e.target.value)}
            />
          </div>
          <div>
            <label className="label block mb-1">To</label>
            <input
              className="input w-44"
              type="date"
              value={to}
              min={from}
              onChange={(e) => onToChange(e.target.value)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDef[];
  active: Tab;
  onChange: (t: Tab) => void;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            title={t.caption}
            className={`inline-flex items-center gap-1.5 px-3 h-9 text-sm font-medium rounded-sm border transition-colors ${
              on
                ? "bg-brand text-cream border-brand"
                : "bg-surface text-textSecondary border-borderc hover:border-brand hover:text-brand"
            }`}
          >
            <t.Icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
// Shared chrome: KPI card, section header, export, empty state
// ============================================================

function Kpi({
  label,
  value,
  Icon,
  tone = "default",
  hint,
}: {
  label: string;
  value: ReactNode;
  Icon: typeof Percent;
  tone?: "default" | "danger" | "warning" | "success";
  hint?: string;
}) {
  const toneClasses: Record<typeof tone, string> = {
    default: "text-brand-dark",
    danger: "text-danger",
    warning: "text-warning",
    success: "text-success",
  };
  const iconBg: Record<typeof tone, string> = {
    default: "bg-brand-soft text-brand",
    danger: "bg-danger/10 text-danger",
    warning: "bg-warning/10 text-warning",
    success: "bg-success/10 text-success",
  };
  return (
    <div className="card flex items-start gap-3 !p-4">
      <div className={`w-10 h-10 rounded-sm grid place-items-center shrink-0 ${iconBg[tone]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="label">{label}</div>
        <div className={`text-2xl font-bold font-mono tabular-nums mt-0.5 ${toneClasses[tone]}`}>
          {value}
        </div>
        {hint && <div className="text-[11px] text-textSecondary mt-0.5">{hint}</div>}
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3 mb-2">
      <div>
        <div className="text-xs uppercase tracking-[0.12em] text-textSecondary font-semibold">
          {title}
        </div>
        {subtitle && <div className="text-[11px] text-textSecondary mt-0.5">{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

function exportCsv(filename: string, rows: Record<string, unknown>[]) {
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function ExportBtn({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold rounded-sm border border-borderc bg-surface text-textSecondary hover:border-brand hover:text-brand transition-colors disabled:opacity-40 disabled:hover:border-borderc disabled:hover:text-textSecondary"
      onClick={onClick}
      disabled={disabled}
    >
      <Download className="w-3.5 h-3.5" /> Export CSV
    </button>
  );
}

function EmptyState({
  Icon,
  title,
  hint,
}: {
  Icon: typeof Percent;
  title: string;
  hint?: string;
}) {
  return (
    <div className="p-10 text-center">
      <div className="w-12 h-12 mx-auto rounded-full bg-brand-soft/60 grid place-items-center mb-3">
        <Icon className="w-5 h-5 text-brand" />
      </div>
      <div className="text-sm font-semibold text-brand-dark">{title}</div>
      {hint && <div className="text-xs text-textSecondary mt-1">{hint}</div>}
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
  height = 280,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  height?: number;
}) {
  return (
    <div className="card">
      <SectionHeader title={title} subtitle={subtitle} />
      <div style={{ width: "100%", height }}>{children}</div>
    </div>
  );
}

// ============================================================
// Tabs
// ============================================================

function OccupancyTab({ from, to }: { from: string; to: string }) {
  const { data } = useQuery({
    queryKey: ["rpt-occ", from, to],
    queryFn: () =>
      api.get<{
        totalRooms: number;
        avgOccupancy: number;
        daily: { day: string; occupied: number; total: number; percentage: number }[];
      }>("/reports/occupancy", { date_from: from, date_to: to }),
  });
  if (!data) return <Loader />;

  const peak = data.daily.reduce((m, d) => (d.percentage > m ? d.percentage : m), 0);
  const low = data.daily.reduce(
    (m, d) => (d.percentage < m || m === -1 ? d.percentage : m),
    -1,
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Kpi
          label="Average occupancy"
          value={`${data.avgOccupancy}%`}
          Icon={Percent}
          hint={`${data.totalRooms} rooms total`}
        />
        <Kpi
          label="Peak day"
          value={`${peak}%`}
          Icon={TrendingUp}
          tone="success"
        />
        <Kpi
          label="Lowest day"
          value={low < 0 ? "—" : `${low}%`}
          Icon={Hourglass}
          tone="warning"
        />
      </div>

      <ChartCard
        title="Daily occupancy"
        subtitle="Percentage of rooms occupied each night in the selected range"
        height={300}
      >
        <ResponsiveContainer>
          <LineChart data={data.daily}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2DCCD" />
            <XAxis dataKey="day" fontSize={11} stroke="#6B6358" />
            <YAxis domain={[0, 100]} fontSize={11} stroke="#6B6358" unit="%" />
            <Tooltip
              formatter={(v: number) => [`${v}%`, "Occupancy"]}
              contentStyle={{ borderRadius: 4, border: "1px solid #E2DCCD", fontSize: 12 }}
            />
            <Line
              type="monotone"
              dataKey="percentage"
              stroke="#0F3D2E"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="flex justify-end">
        <ExportBtn onClick={() => exportCsv(`occupancy-${from}-${to}.csv`, data.daily)} />
      </div>
    </div>
  );
}

function RevenueTab({ from, to }: { from: string; to: string }) {
  const { data } = useQuery({
    queryKey: ["rpt-rev", from, to],
    queryFn: () =>
      api.get<{
        totalRevenue: number;
        daily: { day: string; total: string; count: number }[];
        byRoomType: { roomType: string; total: string }[];
        byStayType?: { stayType: string; bookings: number; total: string }[];
      }>("/reports/revenue", { date_from: from, date_to: to }),
  });
  if (!data) return <Loader />;

  const dailyChart = data.daily.map((d) => ({
    day: d.day,
    total: Number(d.total),
    count: d.count,
  }));
  const typeChart = data.byRoomType.map((t) => ({ ...t, total: Number(t.total) }));
  const totalBookings = data.daily.reduce((s, d) => s + d.count, 0);
  const avgPerBooking = totalBookings ? data.totalRevenue / totalBookings : 0;
  const stayTypeRows = (data.byStayType ?? []).map((s) => ({
    stayType: s.stayType,
    bookings: s.bookings,
    revenue: Number(s.total),
  }));
  const overnight = stayTypeRows.find((s) => s.stayType === "overnight");
  const shortStay = stayTypeRows.find((s) => s.stayType === "short_stay");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Kpi
          label="Total revenue"
          value={inr(data.totalRevenue)}
          Icon={TrendingUp}
        />
        <Kpi
          label="Bookings"
          value={totalBookings}
          Icon={CheckCircle2}
          hint="Reservations that contributed to revenue"
        />
        <Kpi
          label="Avg per booking"
          value={inr(avgPerBooking)}
          Icon={Wallet}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ChartCard title="Daily revenue" subtitle="Earnings per day in the selected range">
          <ResponsiveContainer>
            <BarChart data={dailyChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2DCCD" />
              <XAxis dataKey="day" fontSize={11} stroke="#6B6358" />
              <YAxis fontSize={11} stroke="#6B6358" />
              <Tooltip
                formatter={(v: number) => [inr(v), "Revenue"]}
                contentStyle={{ borderRadius: 4, border: "1px solid #E2DCCD", fontSize: 12 }}
              />
              <Bar dataKey="total" fill="#B08A4A" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="By room type" subtitle="Which categories are pulling the weight">
          <ResponsiveContainer>
            <BarChart data={typeChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2DCCD" />
              <XAxis dataKey="roomType" fontSize={11} stroke="#6B6358" />
              <YAxis fontSize={11} stroke="#6B6358" />
              <Tooltip
                formatter={(v: number) => [inr(v), "Revenue"]}
                contentStyle={{ borderRadius: 4, border: "1px solid #E2DCCD", fontSize: 12 }}
              />
              <Bar dataKey="total" fill="#1F5C44" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {stayTypeRows.length > 0 && (
        <div className="card">
          <div className="text-sm font-semibold text-navy mb-2">Booking types</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-textSecondary border-b border-borderc">
                <th className="py-2 font-medium">Type</th>
                <th className="py-2 font-medium text-right">Bookings</th>
                <th className="py-2 font-medium text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-borderc/60">
                <td className="py-2">Overnight</td>
                <td className="py-2 text-right font-mono tabular-nums">
                  {overnight?.bookings ?? 0}
                </td>
                <td className="py-2 text-right font-mono tabular-nums">
                  {inr(overnight?.revenue ?? 0)}
                </td>
              </tr>
              <tr>
                <td className="py-2">Day use (short stay)</td>
                <td className="py-2 text-right font-mono tabular-nums">
                  {shortStay?.bookings ?? 0}
                </td>
                <td className="py-2 text-right font-mono tabular-nums">
                  {inr(shortStay?.revenue ?? 0)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-end">
        <ExportBtn onClick={() => exportCsv(`revenue-${from}-${to}.csv`, data.daily)} />
      </div>
    </div>
  );
}

// Full invoice ledger — every tax invoice on the property within the
// active date range, plus per-status / per-scope filters and a free-text
// search that hits invoice #, guest name, GSTIN, and reservation #.
// Rows link to the reservation detail page so staff can drill in.
type InvoiceStatusFilter = "all" | "issued" | "partial" | "paid" | "voided";
type InvoiceScopeFilter = "all" | "room" | "combined" | "partial";

interface InvoiceListRow {
  id: string;
  invoiceNumber: string;
  reservationId: string;
  reservationNumber: string | null;
  guestId: string;
  guestName: string;
  guestGstin: string | null;
  subtotal: string;
  grandTotal: string;
  totalPaid: string;
  balanceDue: string;
  status: "issued" | "partial" | "paid" | "voided";
  scope: "room" | "combined" | "partial";
  scopeRoomIds: string[] | null;
  createdAt: string;
}

function InvoicesTab({ from, to }: { from: string; to: string }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<InvoiceStatusFilter>("all");
  const [scope, setScope] = useState<InvoiceScopeFilter>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  // Reset to page 1 whenever any filter changes — otherwise we'd land on
  // an empty page after narrowing the result set.
  useMemo(() => setPage(1), [status, scope, q, from, to]);

  const { data, isLoading } = useQuery({
    queryKey: ["rpt-invoices", from, to, status, scope, q, page],
    queryFn: () =>
      getList<InvoiceListRow>("/invoices", {
        date_from: from,
        date_to: to,
        ...(status !== "all" ? { status } : {}),
        ...(scope !== "all" ? { scope } : {}),
        ...(q.trim() ? { q: q.trim() } : {}),
        page,
        per_page: 50,
      }).then((d) => ({ rows: d.data, meta: d.meta })),
  });

  const rows = data?.rows ?? [];
  const total = data?.meta?.total ?? 0;
  const perPage = data?.meta?.per_page ?? 50;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  // Summary tiles. Cheap aggregation over the current page — for property-
  // wide totals across all pages, point staff at the Revenue tab.
  const sums = rows.reduce(
    (acc, r) => {
      acc.gross += Number(r.grandTotal);
      acc.paid += Number(r.totalPaid);
      acc.owing += Number(r.balanceDue);
      return acc;
    },
    { gross: 0, paid: 0, owing: 0 },
  );

  function exportCurrentPage() {
    const data = rows.map((r) => ({
      invoice_number: r.invoiceNumber,
      issued_on: format(new Date(r.createdAt), "yyyy-MM-dd HH:mm"),
      reservation: r.reservationNumber ?? "",
      guest: r.guestName,
      gstin: r.guestGstin ?? "",
      scope: r.scope,
      status: r.status,
      grand_total: r.grandTotal,
      total_paid: r.totalPaid,
      balance_due: r.balanceDue,
    }));
    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoices-${from}-${to}-page-${page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Invoices on page" value={rows.length} Icon={Receipt} />
        <Kpi label="Gross billed" value={inr(sums.gross)} Icon={TrendingUp} />
        <Kpi label="Collected" value={inr(sums.paid)} Icon={Wallet} tone="success" />
        <Kpi
          label="Outstanding"
          value={inr(sums.owing)}
          Icon={AlertTriangle}
          tone={sums.owing > 0.009 ? "danger" : undefined}
        />
      </div>

      <div className="card !p-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {(["all", "issued", "partial", "paid", "voided"] as InvoiceStatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-2.5 h-8 text-xs font-semibold rounded-sm border transition-colors capitalize ${
                status === s
                  ? "bg-brand-dark text-cream border-brand-dark"
                  : "border-borderc text-textSecondary hover:border-brand hover:text-brand"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="h-6 w-px bg-borderc mx-1" />
        <div className="flex flex-wrap gap-1">
          {(
            [
              { id: "all", label: "All scopes" },
              { id: "combined", label: "Combined" },
              { id: "room", label: "Per room" },
              { id: "partial", label: "Partial" },
            ] as { id: InvoiceScopeFilter; label: string }[]
          ).map((s) => (
            <button
              key={s.id}
              onClick={() => setScope(s.id)}
              className={`px-2.5 h-8 text-xs font-semibold rounded-sm border transition-colors ${
                scope === s.id
                  ? "bg-brand-dark text-cream border-brand-dark"
                  : "border-borderc text-textSecondary hover:border-brand hover:text-brand"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-[180px]">
          <input
            className="input h-8 text-sm"
            placeholder="Search invoice #, guest, GSTIN, reservation #…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <ExportBtn onClick={exportCurrentPage} disabled={rows.length === 0} />
      </div>

      {isLoading ? (
        <Loader />
      ) : rows.length === 0 ? (
        <EmptyState
          Icon={Inbox}
          title="No invoices match these filters"
          hint="Try widening the date range or clearing the status / scope filter."
        />
      ) : (
        <div className="card !p-0 overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Issued</th>
                <th>Reservation · Guest</th>
                <th>Scope</th>
                <th>Status</th>
                <th className="!text-right">Grand Total</th>
                <th className="!text-right">Paid</th>
                <th className="!text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inv) => {
                const balance = Number(inv.balanceDue);
                return (
                  <tr
                    key={inv.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/reservations/${inv.reservationId}`)}
                  >
                    <td className="font-mono font-semibold text-brand-dark">
                      {inv.invoiceNumber}
                    </td>
                    <td className="text-xs text-textSecondary">
                      {format(new Date(inv.createdAt), "dd MMM yyyy · HH:mm")}
                    </td>
                    <td>
                      <div className="font-mono text-xs text-textSecondary">
                        {inv.reservationNumber ?? "—"}
                      </div>
                      <div className="text-sm font-medium text-brand-dark truncate max-w-[18ch]">
                        {inv.guestName}
                      </div>
                    </td>
                    <td>
                      <span
                        className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border ${
                          inv.scope === "room"
                            ? "bg-brand-soft text-brand-dark border-brand-dark/30"
                            : inv.scope === "combined"
                              ? "bg-accentBlue/10 text-accentBlue border-accentBlue/30"
                              : "bg-bg text-textSecondary border-borderc"
                        }`}
                      >
                        {inv.scope === "room" ? "Per room" : inv.scope}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${
                          inv.status === "paid"
                            ? "bg-success/10 text-success"
                            : inv.status === "partial"
                              ? "bg-warning/10 text-warning"
                              : inv.status === "voided"
                                ? "bg-textSecondary/15 text-textSecondary line-through"
                                : "bg-danger/10 text-danger"
                        }`}
                      >
                        {inv.status}
                      </span>
                    </td>
                    <td className="text-right font-mono tabular-nums">
                      {inr(inv.grandTotal)}
                    </td>
                    <td className="text-right font-mono tabular-nums text-success">
                      {inr(inv.totalPaid)}
                    </td>
                    <td
                      className={`text-right font-mono tabular-nums ${
                        balance > 0.009 ? "text-danger font-semibold" : "text-textSecondary"
                      }`}
                    >
                      {inr(balance)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {total > perPage && (
        <div className="flex items-center justify-between text-xs text-textSecondary">
          <span>
            Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} of {total}
          </span>
          <div className="flex gap-1">
            <button
              className="px-2.5 h-7 rounded-sm border border-borderc disabled:opacity-40"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </button>
            <button
              className="px-2.5 h-7 rounded-sm border border-borderc disabled:opacity-40"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CollectionsTab({ from, to }: { from: string; to: string }) {
  const { data } = useQuery({
    queryKey: ["rpt-col", from, to],
    queryFn: () =>
      api.get<{
        byMethod: { method: string; count: number; total: string }[];
        payments: { id: string; amount: string; paymentMethod: string; paymentDate: string }[];
      }>("/reports/collections", { date_from: from, date_to: to }),
  });
  if (!data) return <Loader />;

  const grand = data.byMethod.reduce((s, m) => s + Number(m.total), 0);
  const txns = data.byMethod.reduce((s, m) => s + m.count, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Kpi label="Total collected" value={inr(grand)} Icon={Coins} tone="success" />
        <Kpi label="Transactions" value={txns} Icon={Receipt} />
      </div>

      <div>
        <SectionHeader
          title="By payment method"
          subtitle="Cash, UPI, card, bank transfers — how the money came in"
          right={
            <ExportBtn
              onClick={() => exportCsv(`collections-${from}-${to}.csv`, data.payments)}
              disabled={!data.payments.length}
            />
          }
        />
        <div className="card !p-0 overflow-x-auto">
          {data.byMethod.length === 0 ? (
            <EmptyState
              Icon={Inbox}
              title="No payments collected"
              hint="Once you record a payment in this date range it'll show up here."
            />
          ) : (
            <table className="table-base">
              <thead>
                <tr>
                  <th>Method</th>
                  <th className="!text-right">Transactions</th>
                  <th className="!text-right">Total collected</th>
                  <th className="!text-right">Share</th>
                </tr>
              </thead>
              <tbody>
                {data.byMethod.map((m) => {
                  const share = grand > 0 ? (Number(m.total) / grand) * 100 : 0;
                  return (
                    <tr key={m.method}>
                      <td className="capitalize font-medium text-brand-dark">
                        {m.method.replace(/_/g, " ")}
                      </td>
                      <td className="text-right tabular-nums">{m.count}</td>
                      <td className="text-right font-mono tabular-nums">{inr(m.total)}</td>
                      <td className="text-right">
                        <div className="inline-flex items-center gap-2">
                          <div className="w-20 h-1.5 rounded-full bg-bg overflow-hidden">
                            <div
                              className="h-full bg-brand"
                              style={{ width: `${share}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-mono text-textSecondary w-10 text-right">
                            {share.toFixed(0)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-brand-soft/40">
                  <td className="font-semibold text-brand-dark">Total</td>
                  <td className="text-right font-semibold tabular-nums">{txns}</td>
                  <td className="text-right font-mono font-bold tabular-nums">{inr(grand)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function GstTab({ from, to }: { from: string; to: string }) {
  const { data } = useQuery({
    queryKey: ["rpt-gst", from, to],
    queryFn: () =>
      api.get<{
        month: string;
        byStatus: {
          status: string;
          subtotal: string;
          cgst: string;
          sgst: string;
          total: string;
          count: number;
        }[];
      }>("/reports/gst-summary", { date_from: from, date_to: to }),
  });
  if (!data) return <Loader />;

  const totals = data.byStatus.reduce(
    (acc, r) => ({
      subtotal: acc.subtotal + Number(r.subtotal),
      cgst: acc.cgst + Number(r.cgst),
      sgst: acc.sgst + Number(r.sgst),
      total: acc.total + Number(r.total),
      count: acc.count + r.count,
    }),
    { subtotal: 0, cgst: 0, sgst: 0, total: 0, count: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Invoices" value={totals.count} Icon={Receipt} />
        <Kpi label="Subtotal" value={inr(totals.subtotal)} Icon={Wallet} />
        <Kpi label="Tax (CGST + SGST)" value={inr(totals.cgst + totals.sgst)} Icon={Percent} />
        <Kpi label="Grand total" value={inr(totals.total)} Icon={TrendingUp} tone="success" />
      </div>

      <div>
        <SectionHeader
          title={`GST summary — ${data.month}`}
          subtitle="Driven by invoice issued-date. Adjust the range with the date picker."
          right={
            <ExportBtn
              onClick={() => exportCsv(`gst-${data.month}.csv`, data.byStatus)}
              disabled={!data.byStatus.length}
            />
          }
        />
        <div className="card !p-0 overflow-x-auto">
          {data.byStatus.length === 0 ? (
            <EmptyState
              Icon={Inbox}
              title="No invoices in this range"
              hint="Adjust the date picker above."
            />
          ) : (
            <table className="table-base">
              <thead>
                <tr>
                  <th>Status</th>
                  <th className="!text-right">Count</th>
                  <th className="!text-right">Subtotal</th>
                  <th className="!text-right">CGST</th>
                  <th className="!text-right">SGST</th>
                  <th className="!text-right">Grand total</th>
                </tr>
              </thead>
              <tbody>
                {data.byStatus.map((r) => (
                  <tr key={r.status}>
                    <td className="capitalize font-medium text-brand-dark">{r.status}</td>
                    <td className="text-right tabular-nums">{r.count}</td>
                    <td className="text-right font-mono tabular-nums">{inr(r.subtotal)}</td>
                    <td className="text-right font-mono tabular-nums">{inr(r.cgst)}</td>
                    <td className="text-right font-mono tabular-nums">{inr(r.sgst)}</td>
                    <td className="text-right font-mono font-bold tabular-nums">{inr(r.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-brand-soft/40">
                  <td className="font-semibold text-brand-dark">Total</td>
                  <td className="text-right font-semibold tabular-nums">{totals.count}</td>
                  <td className="text-right font-mono font-semibold tabular-nums">
                    {inr(totals.subtotal)}
                  </td>
                  <td className="text-right font-mono font-semibold tabular-nums">
                    {inr(totals.cgst)}
                  </td>
                  <td className="text-right font-mono font-semibold tabular-nums">
                    {inr(totals.sgst)}
                  </td>
                  <td className="text-right font-mono font-bold tabular-nums">
                    {inr(totals.total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

interface OutstandingResp {
  invoices: {
    invoiceId: string;
    invoiceNumber: string;
    reservationId: string;
    reservationNumber: string;
    guestId: string;
    guestName: string;
    guestPhone: string;
    grandTotal: string;
    totalPaid: string;
    balanceDue: string;
    status: string;
    issuedAt: string;
    checkedOutAt: string | null;
  }[];
  pendingPayments: {
    paymentId: string;
    invoiceId: string | null;
    reservationId: string;
    reservationNumber: string;
    guestId: string;
    guestName: string;
    guestPhone: string;
    amount: string;
    notes: string | null;
    promisedAt: string;
  }[];
  byGuest: {
    guestId: string;
    guestName: string;
    guestPhone: string;
    balance: number;
    oldest: string;
  }[];
  totalOutstanding: number;
}

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

function AgeBadge({ days }: { days: number }) {
  const tone =
    days >= 30
      ? "bg-danger/10 text-danger"
      : days >= 14
        ? "bg-warning/10 text-warning"
        : "bg-bg text-textSecondary";
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded-sm text-[10px] font-semibold ${tone}`}>
      {days}d
    </span>
  );
}

function OutstandingTab() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const dialog = useDialog();
  const { toast } = useToast();
  const { data } = useQuery({
    queryKey: ["rpt-out"],
    queryFn: () => api.get<OutstandingResp>("/reports/outstanding"),
    refetchInterval: 30_000,
  });

  const markReceived = useMutation({
    mutationFn: ({ id, method }: { id: string; method: string }) =>
      api.post(`/payments/${id}/mark-received`, { paymentMethod: method }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rpt-out"] });
      qc.invalidateQueries({ queryKey: ["outstanding"] });
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  if (!data) return <Loader />;
  const { invoices, pendingPayments, byGuest, totalOutstanding } = data;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Kpi
          label="Total outstanding"
          value={inr(totalOutstanding)}
          Icon={AlertTriangle}
          tone="danger"
        />
        <Kpi
          label="Guests with balance"
          value={byGuest.length}
          Icon={Users}
        />
        <Kpi
          label="Pending payments"
          value={pendingPayments.length}
          Icon={Hourglass}
          tone="warning"
          hint="Promised collections waiting to be marked received"
        />
      </div>

      {byGuest.length > 0 && (
        <section>
          <SectionHeader
            title="By guest"
            subtitle="Click a row to open the guest profile"
          />
          <div className="card !p-0 overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Guest</th>
                  <th>Phone</th>
                  <th>Oldest invoice</th>
                  <th className="!text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {byGuest.map((g) => (
                  <tr
                    key={g.guestId}
                    className="cursor-pointer"
                    onClick={() => navigate(`/guests/${g.guestId}`)}
                  >
                    <td className="font-medium text-brand-dark">{g.guestName}</td>
                    <td className="font-mono text-textSecondary text-xs">{g.guestPhone}</td>
                    <td>
                      <div className="inline-flex items-center gap-2">
                        <span>{format(new Date(g.oldest), "dd MMM yyyy")}</span>
                        <AgeBadge days={daysSince(g.oldest)} />
                      </div>
                    </td>
                    <td className="text-right font-mono text-danger font-semibold tabular-nums">
                      {inr(g.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {pendingPayments.length > 0 && (
        <section>
          <SectionHeader
            title="Pending payments"
            subtitle="Promised collections — mark them received once the money's in"
          />
          <div className="card !p-0 overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Reservation</th>
                  <th>Guest</th>
                  <th>Notes</th>
                  <th>Promised</th>
                  <th className="!text-right">Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pendingPayments.map((p) => (
                  <tr key={p.paymentId}>
                    <td className="font-mono text-xs">{p.reservationNumber}</td>
                    <td>
                      <div className="font-medium text-brand-dark">{p.guestName}</div>
                      <div className="text-[11px] text-textSecondary font-mono">
                        {p.guestPhone}
                      </div>
                    </td>
                    <td className="text-xs text-textSecondary">{p.notes ?? ""}</td>
                    <td>
                      <div className="inline-flex items-center gap-2">
                        <span>{format(new Date(p.promisedAt), "dd MMM yyyy")}</span>
                        <AgeBadge days={daysSince(p.promisedAt)} />
                      </div>
                    </td>
                    <td className="text-right font-mono text-danger font-semibold tabular-nums">
                      {inr(p.amount)}
                    </td>
                    <td className="text-right">
                      <button
                        className="!h-7 !px-2 text-xs font-semibold rounded-sm bg-success text-white border border-success hover:opacity-90 inline-flex items-center gap-1"
                        onClick={async () => {
                          const chosen = await dialog.prompt({
                            title: "Mark payment received",
                            message: `Confirm collection of ${inr(p.amount)} from ${p.guestName}.`,
                            okLabel: "Mark received",
                            tone: "success",
                            required: true,
                            defaultValue: "cash",
                            options: [
                              { value: "cash", label: "Cash" },
                              { value: "upi", label: "UPI" },
                              { value: "card", label: "Card" },
                              { value: "bank_transfer", label: "Bank transfer" },
                            ],
                          });
                          if (chosen) markReceived.mutate({ id: p.paymentId, method: chosen });
                        }}
                        disabled={markReceived.isPending}
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        Received
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <SectionHeader
          title="All unpaid invoices"
          subtitle="Sorted by oldest first — chase these"
          right={
            <ExportBtn
              onClick={() => exportCsv(`outstanding.csv`, invoices)}
              disabled={!invoices.length}
            />
          }
        />
        <div className="card !p-0 overflow-x-auto">
          {invoices.length === 0 ? (
            <EmptyState
              Icon={CheckCircle2}
              title="Nothing outstanding"
              hint="Every issued invoice has been paid. Nice."
            />
          ) : (
            <table className="table-base">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Reservation</th>
                  <th>Guest</th>
                  <th>Issued</th>
                  <th>Status</th>
                  <th className="!text-right">Total</th>
                  <th className="!text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((r) => (
                  <tr
                    key={r.invoiceId}
                    className="cursor-pointer"
                    onClick={() => navigate(`/reservations/${r.reservationId}`)}
                  >
                    <td className="font-mono text-xs">{r.invoiceNumber}</td>
                    <td className="font-mono text-textSecondary text-xs">
                      {r.reservationNumber}
                    </td>
                    <td className="font-medium text-brand-dark">{r.guestName}</td>
                    <td>
                      <div className="inline-flex items-center gap-2">
                        <span>{format(new Date(r.issuedAt), "dd MMM yyyy")}</span>
                        <AgeBadge days={daysSince(r.issuedAt)} />
                      </div>
                    </td>
                    <td className="capitalize">{r.status}</td>
                    <td className="text-right font-mono tabular-nums">{inr(r.grandTotal)}</td>
                    <td className="text-right font-mono text-danger font-semibold tabular-nums">
                      {inr(r.balanceDue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

function RoomsTab({ from, to }: { from: string; to: string }) {
  const { data = [] } = useQuery({
    queryKey: ["rpt-rooms", from, to],
    queryFn: () =>
      api.get<
        {
          roomId: string;
          roomNumber: string;
          roomType: string;
          baseRate: string;
          bookings: number;
          // Day-use vs overnight split per room (added 2026 day-use feature).
          // Optional so old API responses still type-check.
          overnightBookings?: number;
          shortStayBookings?: number;
          revenue: string;
        }[]
      >("/reports/room-performance", { date_from: from, date_to: to }),
  });

  const total = data.reduce((s, r) => s + Number(r.revenue), 0);
  const totalBookings = data.reduce((s, r) => s + r.bookings, 0);
  const top = [...data].sort((a, b) => Number(b.revenue) - Number(a.revenue))[0];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Kpi label="Active rooms" value={data.length} Icon={BedDouble} />
        <Kpi label="Total bookings" value={totalBookings} Icon={CheckCircle2} />
        <Kpi
          label="Top performer"
          value={top ? `Room ${top.roomNumber}` : "—"}
          Icon={TrendingUp}
          tone="success"
          hint={top ? inr(top.revenue) : undefined}
        />
      </div>

      <div>
        <SectionHeader
          title="Per-room performance"
          subtitle="Bookings and revenue for each room in the selected range"
          right={
            <ExportBtn
              onClick={() => exportCsv(`room-performance-${from}-${to}.csv`, data)}
              disabled={!data.length}
            />
          }
        />
        <div className="card !p-0 overflow-x-auto">
          {data.length === 0 ? (
            <EmptyState Icon={Inbox} title="No room activity in this range" />
          ) : (
            <table className="table-base">
              <thead>
                <tr>
                  <th>Room</th>
                  <th>Type</th>
                  <th className="!text-right">Base rate</th>
                  <th className="!text-right">Bookings</th>
                  <th className="!text-right">Day use</th>
                  <th className="!text-right">Revenue</th>
                  <th className="!text-right">Share</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => {
                  const share = total > 0 ? (Number(r.revenue) / total) * 100 : 0;
                  return (
                    <tr key={r.roomId}>
                      <td className="font-mono font-semibold text-brand-dark">{r.roomNumber}</td>
                      <td className="capitalize">{r.roomType}</td>
                      <td className="text-right font-mono tabular-nums">{inr(r.baseRate)}</td>
                      <td className="text-right tabular-nums">{r.bookings}</td>
                      <td className="text-right tabular-nums">{r.shortStayBookings ?? 0}</td>
                      <td className="text-right font-mono tabular-nums">{inr(r.revenue)}</td>
                      <td className="text-right">
                        <div className="inline-flex items-center gap-2">
                          <div className="w-16 h-1.5 rounded-full bg-bg overflow-hidden">
                            <div
                              className="h-full bg-brand"
                              style={{ width: `${share}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-mono text-textSecondary w-9 text-right">
                            {share.toFixed(0)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-brand-soft/40">
                  <td className="font-semibold text-brand-dark" colSpan={3}>
                    Total
                  </td>
                  <td className="text-right font-semibold tabular-nums">{totalBookings}</td>
                  <td className="text-right font-semibold tabular-nums">
                    {data.reduce((s, r) => s + (r.shortStayBookings ?? 0), 0)}
                  </td>
                  <td className="text-right font-mono font-bold tabular-nums">{inr(total)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function CreditTab({ from, to }: { from: string; to: string }) {
  const { data } = useQuery({
    queryKey: ["rpt-credit", from, to],
    queryFn: () =>
      api.get<{
        totals: {
          count: number;
          grandTotal: number;
          balanceDue: number;
          totalPaid: number;
          complimentary: number;
        };
        rows: {
          id: string;
          reservationNumber: string;
          guestName: string;
          guestPhone: string;
          bookingSource: string;
          checkInDate: string;
          checkOutDate: string;
          numNights: number;
          grandTotal: string;
          balanceDue: string;
          // Sum of received non-voided payments — money already collected
          // on this booking before/after it was reclassified as comp.
          totalPaid: string;
          status: string;
          creditNotes: string | null;
          createdAt: string;
        }[];
      }>("/reports/credit-bookings", { date_from: from, date_to: to }),
  });
  if (!data) return <Loader />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Total bookings" value={data.totals.count} Icon={Gift} />
        <Kpi
          label="Complimentary value"
          value={inr(data.totals.complimentary)}
          Icon={Wallet}
          hint="Total billed value of comped stays"
        />
        <Kpi
          label="Already paid"
          value={inr(data.totals.totalPaid)}
          Icon={CheckCircle2}
          tone="success"
          hint="Money collected before/after comping"
        />
        <Kpi
          label="Balance due"
          value={inr(data.totals.balanceDue)}
          Icon={AlertTriangle}
          tone="danger"
        />
      </div>

      <div>
        <SectionHeader
          title="Complimentary & credit bookings"
          subtitle="Bookings with credit notes or comp adjustments"
          right={
            <ExportBtn
              onClick={() =>
                exportCsv(
                  `credit-bookings-${from}-${to}.csv`,
                  data.rows as unknown as Record<string, unknown>[],
                )
              }
              disabled={!data.rows.length}
            />
          }
        />
        <div className="card !p-0 overflow-x-auto">
          {data.rows.length === 0 ? (
            <EmptyState
              Icon={Inbox}
              title="No credit bookings in this range"
              hint="Bookings marked as complimentary or carrying credit notes show up here."
            />
          ) : (
            <table className="table-base">
              <thead>
                <tr>
                  <th>Reservation</th>
                  <th>Guest</th>
                  <th>Source</th>
                  <th>Check-in</th>
                  <th>Check-out</th>
                  <th className="!text-right">Nights</th>
                  <th className="!text-right">Total</th>
                  <th className="!text-right">Paid</th>
                  <th className="!text-right">Balance</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono text-accentBlue text-xs">{r.reservationNumber}</td>
                    <td>
                      <div className="font-medium text-brand-dark">{r.guestName}</div>
                      <div className="text-[11px] text-textSecondary font-mono">
                        {r.guestPhone}
                      </div>
                    </td>
                    <td className="capitalize text-xs">
                      {r.bookingSource
                        .replace(/_/g, " ")
                        .replace("phone whatsapp", "Phone / WhatsApp")}
                    </td>
                    <td>{format(new Date(r.checkInDate), "dd MMM yyyy")}</td>
                    <td>{format(new Date(r.checkOutDate), "dd MMM yyyy")}</td>
                    <td className="text-right tabular-nums">{r.numNights}</td>
                    <td className="text-right font-mono tabular-nums">{inr(r.grandTotal)}</td>
                    <td className="text-right font-mono text-success tabular-nums">
                      {inr(r.totalPaid)}
                    </td>
                    <td className="text-right font-mono text-danger tabular-nums">
                      {inr(r.balanceDue)}
                    </td>
                    <td className="text-xs text-textSecondary">{r.creditNotes ?? "—"}</td>
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

function GuestsTab({ from, to }: { from: string; to: string }) {
  const { data = [] } = useQuery({
    queryKey: ["rpt-guests", from, to],
    queryFn: () =>
      api.get<
        {
          guestId: string;
          fullName: string;
          phone: string;
          stays: number;
          revenue: string;
        }[]
      >("/reports/guests", { date_from: from, date_to: to }),
  });

  const navigate = useNavigate();
  const top = data[0];
  const totalRevenue = data.reduce((s, g) => s + Number(g.revenue), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Kpi label="Guests" value={data.length} Icon={Users} />
        <Kpi
          label="Top guest"
          value={top?.fullName ?? "—"}
          Icon={TrendingUp}
          tone="success"
          hint={top ? `${top.stays} stays · ${inr(top.revenue)}` : undefined}
        />
        <Kpi label="Revenue from list" value={inr(totalRevenue)} Icon={Wallet} />
      </div>

      <div>
        <SectionHeader
          title="Top guests"
          subtitle="Most stays in the selected range. Click a row for the full profile."
          right={
            <ExportBtn
              onClick={() => exportCsv(`top-guests-${from}-${to}.csv`, data)}
              disabled={!data.length}
            />
          }
        />
        <div className="card !p-0 overflow-x-auto">
          {data.length === 0 ? (
            <EmptyState Icon={Inbox} title="No guests in this range yet" />
          ) : (
            <table className="table-base">
              <thead>
                <tr>
                  <th>Guest</th>
                  <th>Phone</th>
                  <th className="!text-right">Stays</th>
                  <th className="!text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.map((g) => (
                  <tr
                    key={g.guestId}
                    className="cursor-pointer"
                    onClick={() => navigate(`/guests/${g.guestId}`)}
                  >
                    <td className="font-medium text-brand-dark">{g.fullName}</td>
                    <td className="font-mono text-textSecondary text-xs">{g.phone}</td>
                    <td className="text-right tabular-nums">{g.stays}</td>
                    <td className="text-right font-mono tabular-nums">{inr(g.revenue)}</td>
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
