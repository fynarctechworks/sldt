import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarPlus, Search, UserPlus } from "lucide-react";
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
  checkInDate: string;
  checkOutDate: string;
  numNights: number;
  grandTotal: string;
  balanceDue: string;
  status: string;
  createdAt: string;
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-dark">Reservations</h1>
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

      <div className="card p-0 overflow-hidden">
        {isLoading ? (
          <Loader />
        ) : data.length === 0 ? (
          <div className="p-6 text-textSecondary">No reservations match these filters.</div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Res #</th>
                <th>Guest</th>
                <th>Check-in</th>
                <th>Check-out</th>
                <th>Nights</th>
                <th className="text-right">Total</th>
                <th className="text-right">Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/reservations/${r.id}`)}
                >
                  <td className="font-mono font-medium text-accentBlue">
                    {r.reservationNumber}
                  </td>
                  <td>{r.guestName}</td>
                  <td>{format(new Date(r.checkInDate), "dd MMM yyyy")}</td>
                  <td>{format(new Date(r.checkOutDate), "dd MMM yyyy")}</td>
                  <td>{r.numNights}</td>
                  <td className="text-right font-mono">{inr(r.grandTotal)}</td>
                  <td className="text-right font-mono">
                    <span
                      className={
                        Number(r.balanceDue) > 0.009 ? "text-danger font-semibold" : "text-success"
                      }
                    >
                      {inr(r.balanceDue)}
                    </span>
                  </td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
