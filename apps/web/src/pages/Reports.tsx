import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { endOfMonth, format, startOfMonth } from "date-fns";
import { Download } from "lucide-react";
import Papa from "papaparse";
import { useState } from "react";
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
import { api } from "@/lib/api";
import { inr } from "@/lib/utils";

type Tab = "occupancy" | "revenue" | "collections" | "gst" | "outstanding" | "rooms" | "guests" | "credit";

const TABS: { id: Tab; label: string }[] = [
  { id: "occupancy", label: "Occupancy" },
  { id: "revenue", label: "Revenue" },
  { id: "collections", label: "Collections" },
  { id: "gst", label: "GST Summary" },
  { id: "outstanding", label: "Outstanding" },
  { id: "rooms", label: "Room Performance" },
  { id: "guests", label: "Top Guests" },
  { id: "credit", label: "Complimentary" },
];

export default function Reports() {
  const [tab, setTab] = useState<Tab>("occupancy");
  const [from, setFrom] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(endOfMonth(new Date()), "yyyy-MM-dd"));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-navy">Reports</h1>

      <div className="card flex flex-wrap gap-3 items-end">
        <div>
          <label className="label block mb-1">From</label>
          <input className="input w-40" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label block mb-1">To</label>
          <input className="input w-40" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      <div className="flex gap-1 flex-wrap border-b border-borderc">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              tab === t.id
                ? "border-gold text-navy"
                : "border-transparent text-textSecondary hover:text-navy"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "occupancy" && <OccupancyTab from={from} to={to} />}
      {tab === "revenue" && <RevenueTab from={from} to={to} />}
      {tab === "collections" && <CollectionsTab from={from} to={to} />}
      {tab === "gst" && <GstTab from={from} />}
      {tab === "outstanding" && <OutstandingTab />}
      {tab === "rooms" && <RoomsTab from={from} to={to} />}
      {tab === "guests" && <GuestsTab from={from} to={to} />}
      {tab === "credit" && <CreditTab from={from} to={to} />}
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

function ExportBtn({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn-secondary inline-flex items-center gap-2 !h-9" onClick={onClick}>
      <Download className="w-4 h-4" /> CSV
    </button>
  );
}

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

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="card flex-1 mr-2">
          <div className="label">Average Occupancy</div>
          <div className="text-3xl font-bold text-navy">{data.avgOccupancy}%</div>
          <div className="text-xs text-textSecondary">{data.totalRooms} rooms total</div>
        </div>
        <ExportBtn onClick={() => exportCsv(`occupancy-${from}-${to}.csv`, data.daily)} />
      </div>
      <div className="card">
        <div style={{ width: "100%", height: 300 }}>
          <ResponsiveContainer>
            <LineChart data={data.daily}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" fontSize={11} />
              <YAxis domain={[0, 100]} fontSize={11} />
              <Tooltip />
              <Line type="monotone" dataKey="percentage" stroke="#1B2A4A" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
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
      }>("/reports/revenue", { date_from: from, date_to: to }),
  });
  if (!data) return <Loader />;

  const dailyChart = data.daily.map((d) => ({ day: d.day, total: Number(d.total) }));
  const typeChart = data.byRoomType.map((t) => ({ ...t, total: Number(t.total) }));

  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <div className="card flex-1 mr-2">
          <div className="label">Total Revenue</div>
          <div className="text-3xl font-bold text-navy">{inr(data.totalRevenue)}</div>
        </div>
        <ExportBtn onClick={() => exportCsv(`revenue-${from}-${to}.csv`, data.daily)} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="font-semibold mb-3 text-navy">Daily Revenue</h3>
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={dailyChart}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip formatter={(v) => inr(Number(v))} />
                <Bar dataKey="total" fill="#D4A843" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <h3 className="font-semibold mb-3 text-navy">By Room Type</h3>
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={typeChart}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="roomType" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip formatter={(v) => inr(Number(v))} />
                <Bar dataKey="total" fill="#2E75B6" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
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

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportBtn onClick={() => exportCsv(`collections-${from}-${to}.csv`, data.payments)} />
      </div>
      <div className="card p-0">
        <div className="px-4 py-3 border-b"><strong>By Payment Method</strong></div>
        <table className="table-base">
          <thead>
            <tr>
              <th>Method</th>
              <th>Count</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.byMethod.map((m) => (
              <tr key={m.method}>
                <td className="capitalize">{m.method.replace("_", " ")}</td>
                <td>{m.count}</td>
                <td className="text-right font-mono">{inr(m.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GstTab({ from }: { from: string }) {
  const month = from.slice(0, 7);
  const { data } = useQuery({
    queryKey: ["rpt-gst", month],
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
      }>("/reports/gst-summary", { month }),
  });
  if (!data) return <Loader />;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="text-sm">
          Month: <strong>{data.month}</strong>
        </div>
        <ExportBtn onClick={() => exportCsv(`gst-${data.month}.csv`, data.byStatus)} />
      </div>
      <div className="card p-0">
        <table className="table-base">
          <thead>
            <tr>
              <th>Status</th>
              <th>Count</th>
              <th className="text-right">Subtotal</th>
              <th className="text-right">CGST</th>
              <th className="text-right">SGST</th>
              <th className="text-right">Grand Total</th>
            </tr>
          </thead>
          <tbody>
            {data.byStatus.map((r) => (
              <tr key={r.status}>
                <td className="capitalize">{r.status}</td>
                <td>{r.count}</td>
                <td className="text-right font-mono">{inr(r.subtotal)}</td>
                <td className="text-right font-mono">{inr(r.cgst)}</td>
                <td className="text-right font-mono">{inr(r.sgst)}</td>
                <td className="text-right font-mono font-bold">{inr(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
        <div className="card">
          <div className="label">Total Outstanding</div>
          <div className="text-2xl font-bold text-danger font-mono">{inr(totalOutstanding)}</div>
        </div>
        <div className="card">
          <div className="label">Guests with balance</div>
          <div className="text-2xl font-bold text-brand-dark">{byGuest.length}</div>
        </div>
        <div className="card">
          <div className="label">Pending payments</div>
          <div className="text-2xl font-bold text-warning">{pendingPayments.length}</div>
        </div>
      </div>

      {byGuest.length > 0 && (
        <section>
          <div className="text-xs uppercase tracking-wider text-textSecondary font-semibold mb-2">
            By Guest
          </div>
          <div className="card p-0">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Guest</th>
                  <th>Phone</th>
                  <th>Oldest invoice</th>
                  <th className="text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {byGuest.map((g) => (
                  <tr
                    key={g.guestId}
                    className="cursor-pointer hover:bg-bg"
                    onClick={() => navigate(`/guests/${g.guestId}`)}
                  >
                    <td className="font-medium">{g.guestName}</td>
                    <td className="font-mono text-textSecondary">{g.guestPhone}</td>
                    <td>
                      {format(new Date(g.oldest), "dd MMM yyyy")}{" "}
                      <span className="text-xs text-textSecondary">
                        · {daysSince(g.oldest)}d ago
                      </span>
                    </td>
                    <td className="text-right font-mono text-danger font-semibold">
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
          <div className="text-xs uppercase tracking-wider text-textSecondary font-semibold mb-2">
            Pending Payments (collect later)
          </div>
          <div className="card p-0">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Reservation</th>
                  <th>Guest</th>
                  <th>Notes</th>
                  <th>Promised</th>
                  <th className="text-right">Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pendingPayments.map((p) => (
                  <tr key={p.paymentId}>
                    <td className="font-mono">{p.reservationNumber}</td>
                    <td>
                      <div>{p.guestName}</div>
                      <div className="text-xs text-textSecondary font-mono">{p.guestPhone}</div>
                    </td>
                    <td className="text-xs text-textSecondary">{p.notes ?? ""}</td>
                    <td>
                      {format(new Date(p.promisedAt), "dd MMM yyyy")}{" "}
                      <span className="text-xs text-textSecondary">
                        · {daysSince(p.promisedAt)}d ago
                      </span>
                    </td>
                    <td className="text-right font-mono text-danger font-semibold">
                      {inr(p.amount)}
                    </td>
                    <td className="text-right">
                      <button
                        className="!h-7 !px-2 text-xs font-semibold rounded-sm bg-success text-white border-2 border-success hover:opacity-90"
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
                        Mark Received
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
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs uppercase tracking-wider text-textSecondary font-semibold">
            All Unpaid Invoices
          </div>
          <ExportBtn onClick={() => exportCsv(`outstanding.csv`, invoices)} />
        </div>
        <div className="card p-0">
          <table className="table-base">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Reservation</th>
                <th>Guest</th>
                <th>Issued</th>
                <th>Status</th>
                <th className="text-right">Total</th>
                <th className="text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((r) => (
                <tr
                  key={r.invoiceId}
                  className="cursor-pointer hover:bg-bg"
                  onClick={() => navigate(`/reservations/${r.reservationId}`)}
                >
                  <td className="font-mono">{r.invoiceNumber}</td>
                  <td className="font-mono text-textSecondary">{r.reservationNumber}</td>
                  <td>{r.guestName}</td>
                  <td>
                    {format(new Date(r.issuedAt), "dd MMM yyyy")}{" "}
                    <span className="text-xs text-textSecondary">
                      · {daysSince(r.issuedAt)}d
                    </span>
                  </td>
                  <td className="capitalize">{r.status}</td>
                  <td className="text-right font-mono">{inr(r.grandTotal)}</td>
                  <td className="text-right font-mono text-danger font-semibold">
                    {inr(r.balanceDue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {invoices.length === 0 && (
            <div className="p-6 text-textSecondary text-sm">Nothing outstanding.</div>
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
          revenue: string;
        }[]
      >("/reports/room-performance", { date_from: from, date_to: to }),
  });
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportBtn onClick={() => exportCsv(`room-performance-${from}-${to}.csv`, data)} />
      </div>
      <div className="card p-0">
        <table className="table-base">
          <thead>
            <tr>
              <th>Room</th>
              <th>Type</th>
              <th className="text-right">Base Rate</th>
              <th className="text-right">Bookings</th>
              <th className="text-right">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.roomId}>
                <td className="font-mono">{r.roomNumber}</td>
                <td className="capitalize">{r.roomType}</td>
                <td className="text-right font-mono">{inr(r.baseRate)}</td>
                <td className="text-right">{r.bookings}</td>
                <td className="text-right font-mono">{inr(r.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
          status: string;
          creditNotes: string | null;
          createdAt: string;
        }[];
      }>("/reports/credit-bookings", { date_from: from, date_to: to }),
  });
  if (!data) return <Loader />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="card">
          <div className="label">Total Bookings</div>
          <div className="text-2xl font-bold text-brand-dark">{data.totals.count}</div>
        </div>
        <div className="card">
          <div className="label">Complimentary Value</div>
          <div className="text-2xl font-bold text-brand-dark font-mono">{inr(data.totals.complimentary)}</div>
        </div>
        <div className="card">
          <div className="label">Balance Due</div>
          <div className="text-2xl font-bold text-danger font-mono">{inr(data.totals.balanceDue)}</div>
        </div>
      </div>
      <div className="flex justify-end">
        <ExportBtn
          onClick={() =>
            exportCsv(`credit-bookings-${from}-${to}.csv`, data.rows as unknown as Record<string, unknown>[])
          }
        />
      </div>
      <div className="card p-0">
        <table className="table-base">
          <thead>
            <tr>
              <th>Reservation</th>
              <th>Guest</th>
              <th>Source</th>
              <th>Check-in</th>
              <th>Check-out</th>
              <th className="text-right">Nights</th>
              <th className="text-right">Total</th>
              <th className="text-right">Balance</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td className="font-mono text-accentBlue">{r.reservationNumber}</td>
                <td>
                  <div>{r.guestName}</div>
                  <div className="text-xs text-textSecondary">{r.guestPhone}</div>
                </td>
                <td className="capitalize">{r.bookingSource.replace(/_/g, " ").replace("phone whatsapp", "Phone / WhatsApp")}</td>
                <td>{format(new Date(r.checkInDate), "dd MMM yyyy")}</td>
                <td>{format(new Date(r.checkOutDate), "dd MMM yyyy")}</td>
                <td className="text-right">{r.numNights}</td>
                <td className="text-right font-mono">{inr(r.grandTotal)}</td>
                <td className="text-right font-mono text-danger">{inr(r.balanceDue)}</td>
                <td className="text-xs text-textSecondary">{r.creditNotes ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.rows.length === 0 && (
          <div className="p-6 text-textSecondary text-sm">No credit bookings in this range.</div>
        )}
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
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportBtn onClick={() => exportCsv(`top-guests-${from}-${to}.csv`, data)} />
      </div>
      <div className="card p-0">
        <table className="table-base">
          <thead>
            <tr>
              <th>Guest</th>
              <th>Phone</th>
              <th className="text-right">Stays</th>
              <th className="text-right">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {data.map((g) => (
              <tr key={g.guestId}>
                <td>{g.fullName}</td>
                <td>{g.phone}</td>
                <td className="text-right">{g.stays}</td>
                <td className="text-right font-mono">{inr(g.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
