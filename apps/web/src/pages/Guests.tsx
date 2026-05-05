import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Plus, Search, Tag } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader } from "@/components/Loader";
import { getList, api } from "@/lib/api";
import { GUEST_TAGS, ID_PROOF_TYPES, type IdProofType } from "@hoteldesk/shared";

interface Guest {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  idProofType: IdProofType;
  idProofLast4: string;
  idProofMasked?: string;
  idProofNumberEncrypted?: string;
  city: string | null;
  tags: string[];
  createdAt: string;
}

export default function Guests() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState<string>("");
  const [hasFollowup, setHasFollowup] = useState(false);
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["guests", { search, tag, hasFollowup, page }],
    queryFn: () =>
      getList<Guest>("/guests", {
        search: search || undefined,
        tag: tag || undefined,
        has_followup: hasFollowup ? "true" : undefined,
        page,
        per_page: 25,
      }),
  });

  const guests = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy">Guests</h1>
        <button onClick={() => setShowAdd(true)} className="btn-primary inline-flex items-center gap-2">
          <Plus className="w-4 h-4" /> Add Guest
        </button>
      </div>

      <div className="card space-y-3">
        <div className="flex items-center gap-3">
          <Search className="w-4 h-4 text-textSecondary" />
          <input
            className="input flex-1 border-0 focus:ring-0"
            placeholder="Search by name, phone, ID last 4, email, company…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Tag className="w-4 h-4 text-textSecondary" />
          <button
            className={`px-2 py-1 rounded border ${!tag ? "bg-navy text-white border-navy" : "border-gray-300 hover:bg-gray-50"}`}
            onClick={() => {
              setTag("");
              setPage(1);
            }}
          >
            All
          </button>
          {GUEST_TAGS.map((t) => (
            <button
              key={t}
              className={`px-2 py-1 rounded border capitalize ${tag === t ? "bg-navy text-white border-navy" : "border-gray-300 hover:bg-gray-50"}`}
              onClick={() => {
                setTag(t);
                setPage(1);
              }}
            >
              {t.replace("_", " ")}
            </button>
          ))}
          <label className="ml-auto inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={hasFollowup}
              onChange={(e) => {
                setHasFollowup(e.target.checked);
                setPage(1);
              }}
            />
            <Bell className="w-3.5 h-3.5" /> Pending follow-up
          </label>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        {isLoading ? (
          <Loader />
        ) : guests.length === 0 ? (
          <div className="p-6 text-textSecondary">No guests found.</div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Tags</th>
                <th>Email</th>
                <th>ID Type</th>
                <th>ID</th>
                <th>City</th>
              </tr>
            </thead>
            <tbody>
              {guests.map((g) => (
                <tr
                  key={g.id}
                  className="cursor-pointer hover:bg-accentBlue/5"
                  onClick={() => navigate(`/guests/${g.id}`)}
                >
                  <td className="font-medium">{g.fullName}</td>
                  <td className="font-mono">{g.phone}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {(g.tags ?? []).map((t) => (
                        <span
                          key={t}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-accentBlue/10 text-navy capitalize"
                        >
                          {t.replace("_", " ")}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="text-textSecondary">{g.email ?? "-"}</td>
                  <td className="capitalize">{g.idProofType.replace("_", " ")}</td>
                  <td className="font-mono text-xs">{g.idProofMasked ?? `••••${g.idProofLast4}`}</td>
                  <td>{g.city ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between text-xs text-textSecondary">
          <div>{total} guests total</div>
          <div className="flex gap-2">
            <button
              className="btn-secondary h-8 text-xs"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Prev
            </button>
            <span className="self-center">
              {page} / {pages}
            </span>
            <button
              className="btn-secondary h-8 text-xs"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {showAdd && <AddGuestModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}

function AddGuestModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    email: "",
    idProofType: "aadhaar" as IdProofType,
    idProofNumber: "",
    address: "",
    city: "",
    state: "",
    nationality: "Indian",
    companyName: "",
    gstin: "",
    notes: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [dupWarning, setDupWarning] = useState<string | null>(null);

  async function checkDup() {
    if (!form.phone || form.phone.length < 10) return;
    try {
      const r = await api.get<{ duplicate: boolean; matches: { fullName: string }[] }>(
        "/guests/check-duplicate",
        { phone: form.phone },
      );
      if (r.duplicate) setDupWarning(`Phone matches existing guest: ${r.matches[0]?.fullName}`);
      else setDupWarning(null);
    } catch {}
  }

  const create = useMutation({
    mutationFn: () =>
      api.post("/guests", {
        ...form,
        email: form.email || undefined,
        gstin: form.gstin || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["guests"] });
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-md w-full max-w-2xl p-5 space-y-3 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-navy">Add Guest</h2>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Full Name *">
            <input
              className="input"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              required
            />
          </Field>
          <Field label="Phone (10-digit) *">
            <input
              className="input"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              onBlur={checkDup}
              required
            />
          </Field>
          <Field label="Email">
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="ID Proof Type *">
            <select
              className="input"
              value={form.idProofType}
              onChange={(e) => setForm({ ...form, idProofType: e.target.value as IdProofType })}
            >
              {ID_PROOF_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace("_", " ")}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ID Proof Number *">
            <input
              className="input"
              value={form.idProofNumber}
              onChange={(e) => setForm({ ...form, idProofNumber: e.target.value })}
              required
            />
          </Field>
          <Field label="Nationality">
            <input
              className="input"
              value={form.nationality}
              onChange={(e) => setForm({ ...form, nationality: e.target.value })}
            />
          </Field>
          <Field label="City">
            <input
              className="input"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
          </Field>
          <Field label="State">
            <input
              className="input"
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value })}
            />
          </Field>
          <div className="col-span-2">
            <Field label="Address">
              <input
                className="input"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Company">
            <input
              className="input"
              value={form.companyName}
              onChange={(e) => setForm({ ...form, companyName: e.target.value })}
            />
          </Field>
          <Field label="Company GSTIN">
            <input
              className="input"
              value={form.gstin}
              onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
            />
          </Field>
        </div>

        {dupWarning && (
          <div className="text-warning text-xs bg-warning/10 px-3 py-2 rounded-sm">{dupWarning}</div>
        )}
        {err && <div className="text-danger text-xs">{err}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={() => create.mutate()}
            disabled={create.isPending || !form.fullName || !form.phone || !form.idProofNumber}
          >
            {create.isPending ? "Saving…" : "Create Guest"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label block mb-1">{label}</label>
      {children}
    </div>
  );
}
