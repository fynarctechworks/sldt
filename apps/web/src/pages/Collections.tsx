import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CheckCircle2, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDialog } from "@/components/Dialog";
import { Loader } from "@/components/Loader";
import { Money, useMaskedInr } from "@/components/Money";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api";
import { invalidateReservationData } from "@/lib/invalidate";
import { inr } from "@/lib/utils";

interface OutstandingResp {
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
}

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

function ageBucket(days: number): "fresh" | "warm" | "old" {
  if (days <= 7) return "fresh";
  if (days <= 30) return "warm";
  return "old";
}

export default function Collections() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const dialog = useDialog();
  const maskedInr = useMaskedInr();
  const [search, setSearch] = useState("");

  const { data } = useQuery({
    queryKey: ["collections"],
    queryFn: () => api.get<OutstandingResp>("/reports/outstanding"),
    refetchInterval: 30_000,
  });

  const markReceived = useMutation({
    mutationFn: ({ id, method }: { id: string; method: string }) =>
      api.post(`/payments/${id}/mark-received`, { paymentMethod: method }),
    onSuccess: () => {
      invalidateReservationData(qc);
      toast("Marked as received", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const q = search.trim().toLowerCase();
  const matches = (name: string, phone: string) =>
    !q || name.toLowerCase().includes(q) || phone.toLowerCase().includes(q);

  const filteredPending = useMemo(
    () => (data?.pendingPayments ?? []).filter((p) => matches(p.guestName, p.guestPhone)),
    [data, q],
  );

  if (!data) return <Loader label="Loading collections…" />;

  const { pendingPayments } = data;

  // Totals from pending-payments only (the "collect later" IOUs)
  const totalPending = pendingPayments.reduce((s, p) => s + Number(p.amount), 0);
  const ageCounts = pendingPayments.reduce(
    (acc, p) => {
      const b = ageBucket(daysSince(p.promisedAt));
      acc[b] += Number(p.amount);
      acc[`${b}_count`] = (acc[`${b}_count` as never] as number) + 1;
      return acc;
    },
    { fresh: 0, warm: 0, old: 0, fresh_count: 0, warm_count: 0, old_count: 0 } as Record<string, number>,
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Collections</h1>
          <p className="text-sm text-textSecondary mt-0.5">
            Money due from guests. Send reminders, mark payments as received.
          </p>
        </div>
        <input
          className="input max-w-xs"
          placeholder="Search guest name or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card">
          <div className="label">Total to collect</div>
          <Money value={totalPending} className="block text-2xl font-bold text-danger font-mono mt-1" />
          <div className="text-xs text-textSecondary mt-0.5">
            {pendingPayments.length} pending payment(s)
          </div>
        </div>
        <div className="card">
          <div className="label">Within 7 days</div>
          <Money value={ageCounts.fresh} className="block text-2xl font-bold text-success font-mono mt-1" />
          <div className="text-xs text-textSecondary mt-0.5">{ageCounts.fresh_count} payment(s)</div>
        </div>
        <div className="card">
          <div className="label">8–30 days</div>
          <Money value={ageCounts.warm} className="block text-2xl font-bold text-warning font-mono mt-1" />
          <div className="text-xs text-textSecondary mt-0.5">{ageCounts.warm_count} payment(s)</div>
        </div>
        <div className="card">
          <div className="label">Over 30 days</div>
          <Money value={ageCounts.old} className="block text-2xl font-bold text-danger font-mono mt-1" />
          <div className="text-xs text-textSecondary mt-0.5">{ageCounts.old_count} payment(s)</div>
        </div>
      </div>

      {pendingPayments.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 text-center text-textSecondary">
          <Wallet className="w-10 h-10 mb-3 opacity-40" />
          <div className="text-sm">No pending collections. Everyone's paid up.</div>
        </div>
      ) : (
        <section>
          <div className="text-xs uppercase tracking-wider text-textSecondary font-semibold mb-2">
            Pending Payments · marked "collect later" at check-out
          </div>
          <div className="card p-0">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Reservation</th>
                  <th>Guest</th>
                  <th>Reason</th>
                  <th>Promised</th>
                  <th className="text-right">Amount</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredPending.map((p) => (
                  <tr key={p.paymentId}>
                    <td>
                      <button
                        className="font-mono text-brand hover:underline"
                        onClick={() => navigate(`/reservations/${p.reservationId}`)}
                      >
                        {p.reservationNumber}
                      </button>
                    </td>
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
                      <Money value={p.amount} />
                    </td>
                    <td className="text-right">
                      <button
                        className="!h-7 !px-2 text-xs font-semibold rounded-sm bg-success text-white border-2 border-success hover:opacity-90 inline-flex items-center gap-1"
                        onClick={async () => {
                          const chosen = await dialog.prompt({
                            title: "Mark payment received",
                            message: `Confirm collection of ${maskedInr(p.amount)} from ${p.guestName}.`,
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
                          if (!chosen) return;
                          markReceived.mutate({ id: p.paymentId, method: chosen });
                        }}
                        disabled={markReceived.isPending}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
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

    </div>
  );
}
