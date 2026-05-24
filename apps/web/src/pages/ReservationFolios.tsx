// Multi-folio billing panel for a single reservation.
//
// One reservation can have multiple folios — typically "guest" + "company"
// for a corporate stay. The DB triggers keep totals in sync, so the UI
// just renders state and exposes the three primary actions:
//   1. Create a new folio with a chosen payer.
//   2. Add a charge to a folio.
//   3. Move a charge from one folio to another (split-bill mechanic).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Plus, X } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Can } from "@/auth/Can";
import { Loader } from "@/components/Loader";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api";
import { inr } from "@/lib/utils";

interface Folio {
  id: string;
  folioNumber: number;
  label: string;
  payerType: string;
  payerName: string | null;
  isPrimary: boolean;
  chargesTotal: string;
  paidTotal: string;
  balanceDue: string;
  status: string;
}

interface FolioCharge {
  id: string;
  source: string;
  description: string;
  quantity: string;
  rate: string;
  amount: string;
  gstAmount: string;
  chargeDate: string;
  voided: boolean;
}

interface FolioDetail extends Folio {
  charges: FolioCharge[];
}

interface ResMin {
  id: string;
  reservationNumber: string;
}

export default function ReservationFoliosPage() {
  const { id: reservationId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [selectedFolioId, setSelectedFolioId] = useState<string | null>(null);
  const [showAddCharge, setShowAddCharge] = useState(false);
  const [moveDialog, setMoveDialog] = useState<{ chargeId: string; fromFolioId: string } | null>(
    null,
  );

  // Load the reservation header so we can show the user where they are
  // even before the folio list arrives.
  const resQuery = useQuery({
    queryKey: ["reservation-min", reservationId],
    queryFn: () => api.get<ResMin>(`/reservations/${reservationId}`),
    enabled: !!reservationId,
  });

  const foliosQuery = useQuery({
    queryKey: ["folios", reservationId],
    queryFn: () => api.get<Folio[]>(`/reservations/${reservationId}/folios`),
    enabled: !!reservationId,
    refetchInterval: 20_000,
  });
  const folios = foliosQuery.data ?? [];
  const selected = folios.find((f) => f.id === selectedFolioId) ?? folios[0] ?? null;
  const otherFolios = folios.filter((f) => f.id !== selected?.id);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <button
            onClick={() => navigate(`/reservations/${reservationId}`)}
            className="text-xs text-textSecondary hover:underline"
          >
            ← Back to reservation
          </button>
          <h1 className="text-2xl font-bold text-brand-dark">Folios</h1>
          <div className="text-xs text-textSecondary mt-0.5 font-mono">
            {resQuery.data?.reservationNumber ?? "Loading…"}
          </div>
        </div>
        <Can do="split_folios">
          <button
            onClick={() => setShowNew(true)}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> New folio
          </button>
        </Can>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* Folio list */}
        <div className="card !p-0 overflow-hidden">
          {foliosQuery.isLoading ? (
            <Loader label="Loading folios…" />
          ) : folios.length === 0 ? (
            <div className="p-6 text-center text-sm text-textSecondary">
              No folios on this reservation yet. Create one to split the bill.
            </div>
          ) : (
            <ul className="divide-y divide-borderc">
              {folios.map((f) => (
                <li key={f.id}>
                  <button
                    onClick={() => setSelectedFolioId(f.id)}
                    className={`w-full text-left px-3 py-3 hover:bg-bg ${selected?.id === f.id ? "bg-brand-soft/40" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-accentBlue">Folio {f.folioNumber}</span>
                      {f.isPrimary && (
                        <span className="text-[10px] text-brass">primary</span>
                      )}
                    </div>
                    <div className="text-sm font-medium text-brand-dark truncate">{f.label}</div>
                    <div className="text-[11px] text-textSecondary mt-0.5">
                      {f.payerType} · balance {inr(Number(f.balanceDue))}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Selected folio detail */}
        <div>
          {selected ? (
            <FolioDetailPanel
              folioId={selected.id}
              status={selected.status}
              onAddCharge={() => setShowAddCharge(true)}
              onMoveCharge={(chargeId) =>
                setMoveDialog({ chargeId, fromFolioId: selected.id })
              }
              onChanged={() => {
                void qc.invalidateQueries({ queryKey: ["folios"] });
                void qc.invalidateQueries({ queryKey: ["folio", selected.id] });
              }}
            />
          ) : (
            <div className="card grid place-items-center text-sm text-textSecondary min-h-[300px]">
              Select a folio to view its charges.
            </div>
          )}
        </div>
      </div>

      {showNew && reservationId && (
        <NewFolioModal
          reservationId={reservationId}
          onClose={() => setShowNew(false)}
          onCreated={(id) => {
            setShowNew(false);
            setSelectedFolioId(id);
            void qc.invalidateQueries({ queryKey: ["folios", reservationId] });
          }}
        />
      )}

      {showAddCharge && selected && (
        <AddChargeModal
          folioId={selected.id}
          onClose={() => setShowAddCharge(false)}
          onAdded={() => {
            setShowAddCharge(false);
            void qc.invalidateQueries({ queryKey: ["folios"] });
            void qc.invalidateQueries({ queryKey: ["folio", selected.id] });
          }}
        />
      )}

      {moveDialog && (
        <MoveChargeModal
          chargeId={moveDialog.chargeId}
          fromFolioId={moveDialog.fromFolioId}
          targets={otherFolios}
          onClose={() => setMoveDialog(null)}
          onMoved={() => {
            setMoveDialog(null);
            void qc.invalidateQueries({ queryKey: ["folios"] });
            void qc.invalidateQueries({ queryKey: ["folio"] });
          }}
        />
      )}
    </div>
  );
}

function FolioDetailPanel({
  folioId,
  status,
  onAddCharge,
  onMoveCharge,
  onChanged,
}: {
  folioId: string;
  status: string;
  onAddCharge: () => void;
  onMoveCharge: (chargeId: string) => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ["folio", folioId],
    queryFn: () => api.get<FolioDetail>(`/folios/${folioId}`),
  });

  const settleMutation = useMutation({
    mutationFn: () => api.post(`/folios/${folioId}/settle`),
    onSuccess: () => {
      toast("Folio settled", "success");
      onChanged();
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  if (isLoading || !data) return <Loader label="Loading…" />;

  return (
    <div className="card space-y-3">
      <header className="flex items-start justify-between gap-3 border-b border-borderc pb-3">
        <div>
          <div className="text-xs text-textSecondary">Folio {data.folioNumber}</div>
          <h2 className="text-lg font-bold text-brand-dark">{data.label}</h2>
          <div className="text-xs text-textSecondary mt-0.5">
            Payer: {data.payerType}
            {data.payerName ? ` · ${data.payerName}` : ""}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-textSecondary">Balance</div>
          <div className="text-xl font-bold text-brand-dark">{inr(Number(data.balanceDue))}</div>
          <div className="text-[10px] text-textSecondary mt-0.5">
            {inr(Number(data.chargesTotal))} charges · {inr(Number(data.paidTotal))} paid
          </div>
        </div>
      </header>

      <Can do="split_folios">
        <div className="flex items-center gap-2">
          {status === "open" && (
            <>
              <button onClick={onAddCharge} className="btn-secondary !h-8 text-xs">
                + Add charge
              </button>
              {Number(data.balanceDue) <= 0.009 && (
                <button
                  onClick={() => settleMutation.mutate()}
                  className="btn-primary !h-8 text-xs"
                  disabled={settleMutation.isPending}
                >
                  Settle
                </button>
              )}
            </>
          )}
          {status !== "open" && (
            <span className="text-xs text-textSecondary">Folio is {status}</span>
          )}
        </div>
      </Can>

      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-textSecondary text-left">
            <th className="px-2 py-1">Date</th>
            <th className="px-2 py-1">Description</th>
            <th className="px-2 py-1 text-right">Qty</th>
            <th className="px-2 py-1 text-right">Rate</th>
            <th className="px-2 py-1 text-right">Amount</th>
            <th className="px-2 py-1 text-right">GST</th>
            <th className="px-2 py-1" />
          </tr>
        </thead>
        <tbody>
          {data.charges.length === 0 ? (
            <tr>
              <td colSpan={7} className="text-textSecondary text-center py-4">
                No charges yet.
              </td>
            </tr>
          ) : (
            data.charges.map((c) => (
              <tr
                key={c.id}
                className={`border-t border-borderc/60 ${c.voided ? "opacity-50 line-through" : ""}`}
              >
                <td className="px-2 py-1">{c.chargeDate}</td>
                <td className="px-2 py-1">
                  {c.description}
                  {c.source === "discount" && (
                    <span className="ml-1 text-[10px] text-success">discount</span>
                  )}
                </td>
                <td className="px-2 py-1 text-right">{Number(c.quantity).toFixed(2)}</td>
                <td className="px-2 py-1 text-right">{inr(Number(c.rate))}</td>
                <td className="px-2 py-1 text-right">{inr(Number(c.amount))}</td>
                <td className="px-2 py-1 text-right">{inr(Number(c.gstAmount))}</td>
                <td className="px-2 py-1 text-right">
                  {!c.voided && status === "open" && (
                    <button
                      onClick={() => onMoveCharge(c.id)}
                      className="text-accentBlue hover:underline"
                      title="Move to another folio"
                    >
                      <ArrowLeftRight className="w-3.5 h-3.5 inline" />
                    </button>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function NewFolioModal({
  reservationId,
  onClose,
  onCreated,
}: {
  reservationId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { toast } = useToast();
  const [label, setLabel] = useState("Incidentals");
  const [payerType, setPayerType] = useState<"guest" | "company" | "agent" | "other">("guest");
  const [payerCompanyId, setPayerCompanyId] = useState("");
  const [payerName, setPayerName] = useState("");

  // Need the reservation's primary guest for default payer_guest_id.
  const resQuery = useQuery({
    queryKey: ["reservation-min", reservationId],
    queryFn: () => api.get<{ guest: { id: string; fullName: string } }>(`/reservations/${reservationId}`),
  });
  const companiesQuery = useQuery({
    queryKey: ["companies-min"],
    queryFn: () => api.get<{ data?: { id: string; code: string; name: string }[] } | { id: string; code: string; name: string }[]>(`/companies`),
  });
  const companies = Array.isArray(companiesQuery.data)
    ? companiesQuery.data
    : companiesQuery.data?.data ?? [];

  const createMutation = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { label, payerType };
      if (payerType === "guest") body.payerGuestId = resQuery.data?.guest?.id;
      if (payerType === "company" || payerType === "agent") body.payerCompanyId = payerCompanyId;
      if (payerType === "other") body.payerName = payerName;
      return api.post<{ id: string }>(`/reservations/${reservationId}/folios`, body);
    },
    onSuccess: (row) => onCreated(row.id),
    onError: (e: Error) => toast(e.message, "error"),
  });

  const disabled =
    !label ||
    (payerType === "guest" && !resQuery.data?.guest?.id) ||
    ((payerType === "company" || payerType === "agent") && !payerCompanyId) ||
    (payerType === "other" && !payerName) ||
    createMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 bg-brand-dark/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-md border border-borderc w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between px-4 py-3 border-b border-borderc">
          <h2 className="font-semibold text-brand-dark">New folio</h2>
          <button onClick={onClose} className="p-1 hover:bg-bg rounded">
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-textSecondary">Label</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} className="input mt-1 w-full" />
          </div>
          <div>
            <label className="text-xs font-medium text-textSecondary">Payer</label>
            <select
              value={payerType}
              onChange={(e) => setPayerType(e.target.value as typeof payerType)}
              className="input mt-1 w-full"
            >
              <option value="guest">Guest ({resQuery.data?.guest?.fullName ?? "loading…"})</option>
              <option value="company">Company</option>
              <option value="agent">Agent</option>
              <option value="other">Other (free text)</option>
            </select>
          </div>
          {(payerType === "company" || payerType === "agent") && (
            <div>
              <label className="text-xs font-medium text-textSecondary">Pick company</label>
              <select
                value={payerCompanyId}
                onChange={(e) => setPayerCompanyId(e.target.value)}
                className="input mt-1 w-full"
              >
                <option value="">— select —</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {payerType === "other" && (
            <div>
              <label className="text-xs font-medium text-textSecondary">Payer name</label>
              <input
                value={payerName}
                onChange={(e) => setPayerName(e.target.value)}
                className="input mt-1 w-full"
              />
            </div>
          )}
        </div>
        <footer className="flex justify-end gap-2 px-4 py-3 border-t border-borderc">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button disabled={disabled} onClick={() => createMutation.mutate()} className="btn-primary">
            {createMutation.isPending ? "Creating…" : "Create"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function AddChargeModal({
  folioId,
  onClose,
  onAdded,
}: {
  folioId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    description: "",
    quantity: "1",
    rate: "",
    gstRate: "0",
    source: "manual",
  });
  const addMutation = useMutation({
    mutationFn: () =>
      api.post(`/folios/${folioId}/charges`, {
        description: form.description,
        quantity: Number(form.quantity || 1),
        rate: Number(form.rate || 0),
        gstRate: Number(form.gstRate || 0),
        source: form.source,
      }),
    onSuccess: () => onAdded(),
    onError: (e: Error) => toast(e.message, "error"),
  });
  return (
    <div className="fixed inset-0 z-50 bg-brand-dark/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-md border border-borderc w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between px-4 py-3 border-b border-borderc">
          <h2 className="font-semibold text-brand-dark">Add charge to folio</h2>
          <button onClick={onClose} className="p-1 hover:bg-bg rounded">
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-textSecondary">Description</label>
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="input mt-1 w-full"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-textSecondary">Qty</label>
              <input
                type="number"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                className="input mt-1 w-full"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-textSecondary">Rate (₹)</label>
              <input
                type="number"
                value={form.rate}
                onChange={(e) => setForm({ ...form, rate: e.target.value })}
                className="input mt-1 w-full"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-textSecondary">GST %</label>
              <input
                type="number"
                value={form.gstRate}
                onChange={(e) => setForm({ ...form, gstRate: e.target.value })}
                className="input mt-1 w-full"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-textSecondary">Type</label>
            <select
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
              className="input mt-1 w-full"
            >
              <option value="manual">Manual charge</option>
              <option value="additional">Additional service</option>
              <option value="discount">Discount (negates)</option>
            </select>
          </div>
        </div>
        <footer className="flex justify-end gap-2 px-4 py-3 border-t border-borderc">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            disabled={!form.description || !form.rate || addMutation.isPending}
            onClick={() => addMutation.mutate()}
            className="btn-primary"
          >
            {addMutation.isPending ? "Adding…" : "Add charge"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function MoveChargeModal({
  chargeId,
  fromFolioId,
  targets,
  onClose,
  onMoved,
}: {
  chargeId: string;
  fromFolioId: string;
  targets: Folio[];
  onClose: () => void;
  onMoved: () => void;
}) {
  const { toast } = useToast();
  const [toFolioId, setToFolioId] = useState(targets[0]?.id ?? "");
  const moveMutation = useMutation({
    mutationFn: () =>
      api.patch(`/folios/${fromFolioId}/charges/${chargeId}/move`, { toFolioId }),
    onSuccess: () => onMoved(),
    onError: (e: Error) => toast(e.message, "error"),
  });
  return (
    <div className="fixed inset-0 z-50 bg-brand-dark/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-md border border-borderc w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between px-4 py-3 border-b border-borderc">
          <h2 className="font-semibold text-brand-dark text-sm">Move charge</h2>
          <button onClick={onClose} className="p-1 hover:bg-bg rounded">
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="p-4 space-y-2">
          {targets.length === 0 ? (
            <div className="text-sm text-textSecondary">
              Create another folio first to move this charge.
            </div>
          ) : (
            <>
              <label className="text-xs font-medium text-textSecondary">Move to folio</label>
              <select
                value={toFolioId}
                onChange={(e) => setToFolioId(e.target.value)}
                className="input w-full"
              >
                {targets.map((f) => (
                  <option key={f.id} value={f.id}>
                    Folio {f.folioNumber} · {f.label}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
        <footer className="flex justify-end gap-2 px-4 py-3 border-t border-borderc">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            disabled={!toFolioId || moveMutation.isPending}
            onClick={() => moveMutation.mutate()}
            className="btn-primary"
          >
            {moveMutation.isPending ? "Moving…" : "Move"}
          </button>
        </footer>
      </div>
    </div>
  );
}
