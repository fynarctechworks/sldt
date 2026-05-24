// Companies page — corporate accounts directory.
// Two-pane layout: searchable list on the left, detail with outstanding
// + credit policy on the right. New-company modal sits on top.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, X } from "lucide-react";
import { useState } from "react";
import { Can } from "@/auth/Can";
import { useAuth } from "@/auth/AuthContext";
import { Loader } from "@/components/Loader";
import { useToast } from "@/components/Toast";
import { api, getList } from "@/lib/api";
import { inr } from "@/lib/utils";

interface CompanyRow {
  id: string;
  code: string;
  name: string;
  gstin: string | null;
  contactPhone: string | null;
  creditLimit: string | null;
  paymentTermsDays: number;
  isActive: boolean;
}

interface CompanyDetail extends CompanyRow {
  legalName: string | null;
  pan: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  contactName: string | null;
  contactEmail: string | null;
  defaultDiscountPct: string | null;
  notes: string | null;
  outstanding: number;
  invoiceCount: number;
  reservationCount: number;
}

export default function CompaniesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);

  const listQuery = useQuery({
    queryKey: ["companies", { search, includeArchived }],
    queryFn: () =>
      getList<CompanyRow>("/companies", {
        search: search.trim() || undefined,
        includeArchived: includeArchived ? "true" : "false",
        per_page: 100,
      }),
    refetchInterval: 60_000,
  });
  const rows = listQuery.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Companies</h1>
          <div className="text-xs text-textSecondary mt-0.5">
            {rows.length} {includeArchived ? "total" : "active"} corporate account
            {rows.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-textSecondary">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />
            Include archived
          </label>
          <Can do="manage_companies">
            <button
              onClick={() => setShowNew(true)}
              className="btn-primary inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> New company
            </button>
          </Can>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4">
        <div className="card !p-0 overflow-hidden">
          <div className="p-3 border-b border-borderc">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, code, GSTIN, phone…"
              className="input w-full text-sm"
            />
          </div>
          {listQuery.isLoading ? (
            <Loader label="Loading…" />
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-textSecondary">No companies yet.</div>
          ) : (
            <ul className="divide-y divide-borderc max-h-[70vh] overflow-y-auto">
              {rows.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setSelectedId(c.id)}
                    className={`w-full text-left px-3 py-3 hover:bg-bg ${selectedId === c.id ? "bg-brand-soft/40" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-accentBlue">{c.code}</span>
                      {!c.isActive && (
                        <span className="text-[10px] text-textSecondary bg-bg border border-borderc px-1.5 py-0.5 rounded">
                          archived
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-medium text-brand-dark truncate">{c.name}</div>
                    <div className="text-[11px] text-textSecondary mt-0.5">
                      {c.gstin && <span>GSTIN {c.gstin}</span>}
                      {c.contactPhone && <span className="ml-2">{c.contactPhone}</span>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          {selectedId ? (
            <CompanyDetailPanel
              companyId={selectedId}
              canEdit={can("manage_companies")}
              onChanged={() => {
                void qc.invalidateQueries({ queryKey: ["companies"] });
                void qc.invalidateQueries({ queryKey: ["company", selectedId] });
              }}
            />
          ) : (
            <div className="card h-full grid place-items-center text-sm text-textSecondary min-h-[300px]">
              <div className="text-center">
                <Building2 className="w-10 h-10 mx-auto mb-2 opacity-40" />
                Select a company.
              </div>
            </div>
          )}
        </div>
      </div>

      {showNew && (
        <NewCompanyModal
          onClose={() => setShowNew(false)}
          onCreated={(id) => {
            setShowNew(false);
            setSelectedId(id);
            void qc.invalidateQueries({ queryKey: ["companies"] });
          }}
        />
      )}
    </div>
  );
}

function CompanyDetailPanel({
  companyId,
  canEdit,
  onChanged,
}: {
  companyId: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ["company", companyId],
    queryFn: () => api.get<CompanyDetail>(`/companies/${companyId}`),
  });

  const archiveMutation = useMutation({
    mutationFn: () => api.del(`/companies/${companyId}`),
    onSuccess: () => {
      toast("Company archived", "success");
      onChanged();
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  if (isLoading || !data) return <Loader label="Loading…" />;
  const overLimit =
    data.creditLimit && data.outstanding > Number(data.creditLimit);

  return (
    <div className="card space-y-4">
      <header className="flex items-start justify-between gap-3 border-b border-borderc pb-3">
        <div>
          <div className="font-mono text-xs text-accentBlue">{data.code}</div>
          <h2 className="text-lg font-bold text-brand-dark">{data.name}</h2>
          {data.legalName && (
            <div className="text-xs text-textSecondary">{data.legalName}</div>
          )}
        </div>
        {canEdit && data.isActive && (
          <button
            onClick={() => {
              if (confirm(`Archive ${data.name}? It can be restored later.`)) {
                archiveMutation.mutate();
              }
            }}
            className="text-xs text-danger hover:underline"
          >
            Archive
          </button>
        )}
      </header>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <Field label="GSTIN" value={data.gstin} />
        <Field label="PAN" value={data.pan} />
        <Field label="Contact" value={data.contactName} />
        <Field label="Phone" value={data.contactPhone} />
        <Field label="Email" value={data.contactEmail} />
        <Field label="City" value={data.city} />
      </div>
      {data.address && (
        <div className="text-xs">
          <div className="text-textSecondary">Address</div>
          <div className="whitespace-pre-wrap">{data.address}</div>
        </div>
      )}

      {/* Credit policy + outstanding */}
      <div className="border-t border-borderc pt-3">
        <h3 className="text-sm font-semibold text-brand-dark mb-2">Credit policy</h3>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Field
            label="Credit limit"
            value={data.creditLimit != null ? inr(Number(data.creditLimit)) : "Unlimited"}
          />
          <Field label="Payment terms" value={`${data.paymentTermsDays} days`} />
          <Field
            label="Default discount"
            value={
              data.defaultDiscountPct ? `${Number(data.defaultDiscountPct).toFixed(2)}%` : "—"
            }
          />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className={`p-3 rounded border ${overLimit ? "border-danger bg-danger/5" : "border-borderc bg-bg"}`}>
            <div className="text-[10px] uppercase tracking-wider text-textSecondary">Outstanding</div>
            <div className={`text-lg font-bold ${overLimit ? "text-danger" : "text-brand-dark"}`}>
              {inr(data.outstanding)}
            </div>
            {overLimit && (
              <div className="text-[10px] text-danger mt-1">Over credit limit</div>
            )}
          </div>
          <div className="p-3 rounded border border-borderc bg-bg">
            <div className="text-[10px] uppercase tracking-wider text-textSecondary">Invoices</div>
            <div className="text-lg font-bold text-brand-dark">{data.invoiceCount}</div>
          </div>
          <div className="p-3 rounded border border-borderc bg-bg">
            <div className="text-[10px] uppercase tracking-wider text-textSecondary">Reservations</div>
            <div className="text-lg font-bold text-brand-dark">{data.reservationCount}</div>
          </div>
        </div>
      </div>

      {data.notes && (
        <div className="text-xs border-t border-borderc pt-3">
          <div className="text-textSecondary">Notes</div>
          <div className="whitespace-pre-wrap">{data.notes}</div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-textSecondary">{label}</div>
      <div className="text-sm text-brand-dark">{value || <span className="text-textSecondary/60">—</span>}</div>
    </div>
  );
}

function NewCompanyModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    code: "",
    name: "",
    gstin: "",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    creditLimit: "",
    paymentTermsDays: "0",
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>("/companies", {
        code: form.code.toUpperCase(),
        name: form.name,
        gstin: form.gstin || null,
        contactName: form.contactName || null,
        contactPhone: form.contactPhone || null,
        contactEmail: form.contactEmail || null,
        creditLimit: form.creditLimit ? Number(form.creditLimit) : null,
        paymentTermsDays: Number(form.paymentTermsDays || 0),
      }),
    onSuccess: (row) => onCreated(row.id),
    onError: (e: Error) => toast(e.message, "error"),
  });

  return (
    <div className="fixed inset-0 z-50 bg-brand-dark/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-md border border-borderc w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between px-4 py-3 border-b border-borderc">
          <h2 className="font-semibold text-brand-dark">New company</h2>
          <button onClick={onClose} className="p-1 hover:bg-bg rounded">
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-textSecondary">Code</label>
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                className="input mt-1 w-full"
                placeholder="ACME"
                autoFocus
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-textSecondary">Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="input mt-1 w-full"
                placeholder="Acme Corp"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-textSecondary">GSTIN (optional)</label>
            <input
              value={form.gstin}
              onChange={(e) => setForm({ ...form, gstin: e.target.value })}
              className="input mt-1 w-full"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-textSecondary">Contact</label>
              <input
                value={form.contactName}
                onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                className="input mt-1 w-full"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-textSecondary">Phone</label>
              <input
                value={form.contactPhone}
                onChange={(e) =>
                  setForm({ ...form, contactPhone: e.target.value.replace(/\D/g, "").slice(0, 10) })
                }
                className="input mt-1 w-full"
                type="tel"
                inputMode="numeric"
                maxLength={10}
                placeholder="9876543210"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-textSecondary">Email</label>
              <input
                value={form.contactEmail}
                onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                className="input mt-1 w-full"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-textSecondary">Credit limit (₹)</label>
              <input
                type="number"
                value={form.creditLimit}
                onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
                className="input mt-1 w-full"
                placeholder="Unlimited"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-textSecondary">Payment terms (days)</label>
              <input
                type="number"
                value={form.paymentTermsDays}
                onChange={(e) => setForm({ ...form, paymentTermsDays: e.target.value })}
                className="input mt-1 w-full"
              />
            </div>
          </div>
        </div>
        <footer className="flex justify-end gap-2 px-4 py-3 border-t border-borderc">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            disabled={form.code.length < 2 || form.name.length < 2 || createMutation.isPending}
            onClick={() => createMutation.mutate()}
            className="btn-primary"
          >
            {createMutation.isPending ? "Creating…" : "Create"}
          </button>
        </footer>
      </div>
    </div>
  );
}
