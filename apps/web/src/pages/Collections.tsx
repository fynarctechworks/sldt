import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CheckCircle2, MessageCircle, Phone, Wallet } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useDialog } from "@/components/Dialog";
import { Loader } from "@/components/Loader";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api";
import { inr } from "@/lib/utils";

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

function ageBucket(days: number): "fresh" | "warm" | "old" {
  if (days <= 7) return "fresh";
  if (days <= 30) return "warm";
  return "old";
}

const ageStyles: Record<"fresh" | "warm" | "old", string> = {
  fresh: "bg-success/10 text-success",
  warm: "bg-warning/15 text-warning",
  old: "bg-danger/10 text-danger",
};

export default function Collections() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const dialog = useDialog();

  const { data } = useQuery({
    queryKey: ["collections"],
    queryFn: () => api.get<OutstandingResp>("/reports/outstanding"),
    refetchInterval: 30_000,
  });

  const remind = useMutation({
    mutationFn: (guestId: string) =>
      api.post<{ sent: boolean; balance: number; provider: string; to: string; messageId: string | null }>(
        `/reports/outstanding/remind/${guestId}`,
      ),
    onSuccess: (r) => {
      if (r.provider === "stub") {
        toast(`Stub mode — message logged, not sent to ${r.to}`, "info");
      } else if (r.provider === "twilio_whatsapp") {
        toast(
          `WhatsApp queued to ${r.to}. If using Twilio sandbox, the recipient must first send "join <keyword>" to +14155238886.`,
          "success",
        );
      } else {
        toast(`Reminder sent to ${r.to}`, "success");
      }
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const markReceived = useMutation({
    mutationFn: ({ id, method }: { id: string; method: string }) =>
      api.post(`/payments/${id}/mark-received`, { paymentMethod: method }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collections"] });
      qc.invalidateQueries({ queryKey: ["outstanding"] });
      qc.invalidateQueries({ queryKey: ["rpt-out"] });
      toast("Marked as received", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  if (!data) return <Loader label="Loading collections…" />;

  const { byGuest, pendingPayments, invoices, totalOutstanding } = data;

  // Aging buckets
  const ageCounts = byGuest.reduce(
    (acc, g) => {
      const b = ageBucket(daysSince(g.oldest));
      acc[b] += g.balance;
      acc[`${b}_count`] = (acc[`${b}_count` as never] as number) + 1;
      return acc;
    },
    { fresh: 0, warm: 0, old: 0, fresh_count: 0, warm_count: 0, old_count: 0 } as Record<string, number>,
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Collections</h1>
          <p className="text-sm text-textSecondary mt-0.5">
            Money due from guests. Send reminders, mark payments as received.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card">
          <div className="label">Total Outstanding</div>
          <div className="text-2xl font-bold text-danger font-mono mt-1">
            {inr(totalOutstanding)}
          </div>
        </div>
        <div className="card">
          <div className="label">Within 7 days</div>
          <div className="text-2xl font-bold text-success font-mono mt-1">{inr(ageCounts.fresh)}</div>
          <div className="text-xs text-textSecondary mt-0.5">{ageCounts.fresh_count} guest(s)</div>
        </div>
        <div className="card">
          <div className="label">8–30 days</div>
          <div className="text-2xl font-bold text-warning font-mono mt-1">{inr(ageCounts.warm)}</div>
          <div className="text-xs text-textSecondary mt-0.5">{ageCounts.warm_count} guest(s)</div>
        </div>
        <div className="card">
          <div className="label">Over 30 days</div>
          <div className="text-2xl font-bold text-danger font-mono mt-1">{inr(ageCounts.old)}</div>
          <div className="text-xs text-textSecondary mt-0.5">{ageCounts.old_count} guest(s)</div>
        </div>
      </div>

      {byGuest.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 text-center text-textSecondary">
          <Wallet className="w-10 h-10 mb-3 opacity-40" />
          <div className="text-sm">No outstanding balances. Everyone's paid up.</div>
        </div>
      ) : (
        <section>
          <div className="text-xs uppercase tracking-wider text-textSecondary font-semibold mb-2">
            By Guest · oldest first
          </div>
          <div className="card p-0">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Guest</th>
                  <th>Phone</th>
                  <th>Oldest</th>
                  <th>Age</th>
                  <th className="text-right">Balance</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {[...byGuest]
                  .sort((a, b) => new Date(a.oldest).getTime() - new Date(b.oldest).getTime())
                  .map((g) => {
                    const days = daysSince(g.oldest);
                    const bucket = ageBucket(days);
                    return (
                      <tr key={g.guestId}>
                        <td>
                          <button
                            className="font-medium text-brand-dark hover:underline text-left"
                            onClick={() => navigate(`/guests/${g.guestId}`)}
                          >
                            {g.guestName}
                          </button>
                        </td>
                        <td className="font-mono text-textSecondary">{g.guestPhone}</td>
                        <td>{format(new Date(g.oldest), "dd MMM yyyy")}</td>
                        <td>
                          <span
                            className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold ${ageStyles[bucket]}`}
                          >
                            {days}d
                          </span>
                        </td>
                        <td className="text-right font-mono text-danger font-semibold">
                          {inr(g.balance)}
                        </td>
                        <td className="text-right">
                          <div className="inline-flex gap-1">
                            <a
                              href={`tel:${g.guestPhone}`}
                              className="btn-secondary !h-7 !px-2 inline-flex items-center gap-1 text-xs"
                              title="Call"
                            >
                              <Phone className="w-3.5 h-3.5" />
                            </a>
                            <button
                              className="!h-7 !px-2 text-xs font-semibold rounded-sm bg-brand text-cream border-2 border-brand hover:bg-brand-dark inline-flex items-center gap-1"
                              onClick={() => remind.mutate(g.guestId)}
                              disabled={remind.isPending}
                              title="Send WhatsApp reminder"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              Remind
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {pendingPayments.length > 0 && (
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
                {pendingPayments.map((p) => (
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
                      {inr(p.amount)}
                    </td>
                    <td className="text-right">
                      <button
                        className="!h-7 !px-2 text-xs font-semibold rounded-sm bg-success text-white border-2 border-success hover:opacity-90 inline-flex items-center gap-1"
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

      {invoices.length > 0 && (
        <section>
          <div className="text-xs uppercase tracking-wider text-textSecondary font-semibold mb-2">
            All Unpaid Invoices
          </div>
          <div className="card p-0">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Reservation</th>
                  <th>Guest</th>
                  <th>Issued</th>
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
                      <span className="text-xs text-textSecondary">· {daysSince(r.issuedAt)}d</span>
                    </td>
                    <td className="text-right font-mono">{inr(r.grandTotal)}</td>
                    <td className="text-right font-mono text-danger font-semibold">
                      {inr(r.balanceDue)}
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
