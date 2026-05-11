import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Bell, CalendarPlus, CheckCircle2, ExternalLink, FileImage, Pencil, Plus, ShieldCheck, Tag as TagIcon, Trash2, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { KycModal } from "@/components/KycModal";
import { Loader } from "@/components/Loader";
import { api } from "@/lib/api";
import { inr } from "@/lib/utils";
import { GUEST_TAGS } from "@hoteldesk/shared";

interface GuestStats {
  totalStays: number;
  completedStays: number;
  upcomingStays: number;
  cancelledStays: number;
  firstStay: string | null;
  lastStay: string | null;
  totalSpent: number;
  balanceDue: number;
}

interface Guest {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  idProofType: string;
  idProofLast4: string;
  idProofMasked?: string;
  idProofNumberEncrypted?: string;
  address: string | null;
  city: string | null;
  state: string | null;
  nationality: string;
  dateOfBirth: string | null;
  companyName: string | null;
  gstin: string | null;
  notes: string | null;
  tags: string[];
  createdAt: string;
  stats?: GuestStats;
}

interface GuestNote {
  id: string;
  guestId: string;
  body: string;
  authorId: string | null;
  createdAt: string;
}

interface FollowUp {
  id: string;
  guestId: string;
  task: string;
  dueDate: string;
  status: "pending" | "done" | "cancelled";
  assignedTo: string | null;
  createdAt: string;
  completedAt: string | null;
}

type Tab = "profile" | "notes" | "followups";

export default function GuestProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("profile");
  const [editing, setEditing] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["guest", id],
    queryFn: () => api.get<Guest>(`/guests/${id}`),
    enabled: !!id,
  });

  const outstandingQ = useQuery({
    queryKey: ["outstanding"],
    queryFn: () =>
      api.get<{
        byGuest: { guestId: string; balance: number }[];
      }>("/reports/outstanding"),
    staleTime: 30_000,
  });
  const outstanding = outstandingQ.data?.byGuest.find((g) => g.guestId === id)?.balance ?? 0;

  if (isLoading || !data) return <Loader size="lg" />;

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">{data.fullName}</h1>
          <div className="text-sm text-textSecondary font-mono mt-0.5">{data.phone}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {outstanding > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm bg-danger/10 text-danger text-xs font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-danger" />
                Outstanding {inr(outstanding)}
              </span>
            )}
            <TagsEditor guestId={data.id} tags={data.tags ?? []} />
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            className="btn-secondary inline-flex items-center gap-2"
            onClick={() => setEditing(true)}
          >
            <Pencil className="w-4 h-4" /> Edit
          </button>
          <button
            className="btn-primary inline-flex items-center gap-2"
            onClick={() => navigate(`/reservations/new?guestId=${data.id}`)}
          >
            <CalendarPlus className="w-4 h-4" /> New Booking
          </button>
        </div>
      </div>

      {data.stats && <StatsRow stats={data.stats} />}

      <div className="flex gap-1 border-b border-borderc">
        <TabBtn active={tab === "profile"} onClick={() => setTab("profile")}>
          Profile
        </TabBtn>
        <TabBtn active={tab === "notes"} onClick={() => setTab("notes")}>
          Notes
        </TabBtn>
        <TabBtn active={tab === "followups"} onClick={() => setTab("followups")}>
          Follow-ups
        </TabBtn>
      </div>

      {tab === "profile" && <ProfileTab g={data} />}
      {tab === "notes" && <NotesTab guestId={data.id} />}
      {tab === "followups" && <FollowUpsTab guestId={data.id} />}

      {editing && <EditGuestModal guest={data} onClose={() => setEditing(false)} />}
    </div>
  );
}

function EditGuestModal({ guest, onClose }: { guest: Guest; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    fullName: guest.fullName,
    phone: guest.phone,
    email: guest.email ?? "",
    address: guest.address ?? "",
    city: guest.city ?? "",
    state: guest.state ?? "",
    nationality: guest.nationality,
    dateOfBirth: guest.dateOfBirth ? guest.dateOfBirth.slice(0, 10) : "",
    companyName: guest.companyName ?? "",
    gstin: guest.gstin ?? "",
    notes: guest.notes ?? "",
  });
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api.put(`/guests/${guest.id}`, {
        fullName: form.fullName,
        phone: form.phone,
        email: form.email || null,
        address: form.address || null,
        city: form.city || null,
        state: form.state || null,
        nationality: form.nationality || "Indian",
        dateOfBirth: form.dateOfBirth || null,
        companyName: form.companyName || null,
        gstin: form.gstin || null,
        notes: form.notes || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["guest", guest.id] });
      qc.invalidateQueries({ queryKey: ["guests"] });
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm({ ...form, [k]: v });
  }

  return (
    <div
      className="fixed inset-0 z-[150] grid place-items-center bg-brand-dark/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl bg-surface rounded-md shadow-xl border border-borderc max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-borderc">
          <div className="font-semibold text-textPrimary">Edit Guest · {guest.fullName}</div>
          <button onClick={onClose} className="text-textSecondary hover:text-textPrimary">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Full Name">
              <input
                className="input"
                value={form.fullName}
                onChange={(e) => set("fullName", e.target.value)}
              />
            </Field>
            <Field label="Phone">
              <input
                className="input font-mono"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
              />
            </Field>
            <Field label="Email">
              <input
                className="input"
                type="email"
                value={form.email}
                placeholder="guest@example.com"
                onChange={(e) => set("email", e.target.value)}
              />
            </Field>
            <Field label="Date of Birth">
              <input
                className="input"
                type="date"
                value={form.dateOfBirth}
                onChange={(e) => set("dateOfBirth", e.target.value)}
              />
            </Field>
            <Field label="Nationality">
              <input
                className="input"
                value={form.nationality}
                onChange={(e) => set("nationality", e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <Field label="Address">
              <input
                className="input"
                value={form.address}
                placeholder="House / street / area"
                onChange={(e) => set("address", e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="City">
                <input
                  className="input"
                  value={form.city}
                  onChange={(e) => set("city", e.target.value)}
                />
              </Field>
              <Field label="State">
                <input
                  className="input"
                  value={form.state}
                  onChange={(e) => set("state", e.target.value)}
                />
              </Field>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Company">
              <input
                className="input"
                value={form.companyName}
                placeholder="If billed to a company"
                onChange={(e) => set("companyName", e.target.value)}
              />
            </Field>
            <Field label="GSTIN">
              <input
                className="input font-mono"
                value={form.gstin}
                placeholder="22AAAAA0000A1Z5"
                onChange={(e) => set("gstin", e.target.value)}
              />
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              className="w-full border border-borderc bg-surface rounded-sm px-3 py-2 text-textPrimary outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20 placeholder:text-textSecondary/60 resize-none"
              rows={3}
              value={form.notes}
              placeholder="Allergies, preferences, anniversary etc."
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>

          {err && <div className="text-danger text-sm">{err}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-borderc bg-bg/50">
          <button
            onClick={onClose}
            className="px-4 h-9 text-sm font-semibold rounded-sm border-2 border-borderc text-textSecondary hover:border-textSecondary hover:text-textPrimary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || !form.fullName.trim() || !form.phone.trim()}
            className="px-4 h-9 text-sm font-semibold rounded-sm bg-brand-dark text-cream border-2 border-brand-dark hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {save.isPending ? "Saving…" : "Save changes"}
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

function StatsRow({ stats }: { stats: GuestStats }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Stat label="Total stays" value={String(stats.totalStays)} sub={
        stats.upcomingStays > 0 ? `${stats.upcomingStays} upcoming` : stats.completedStays > 0 ? `${stats.completedStays} completed` : "—"
      } />
      <Stat
        label="Last stay"
        value={stats.lastStay ? format(new Date(stats.lastStay), "dd MMM yyyy") : "Never"}
        sub={stats.firstStay ? `Since ${format(new Date(stats.firstStay), "MMM yyyy")}` : "—"}
      />
      <Stat label="Total paid" value={inr(stats.totalSpent)} sub="across all invoices" mono />
      <Stat
        label="Balance due"
        value={inr(stats.balanceDue)}
        sub={stats.balanceDue > 0 ? "Pending collection" : "All clear"}
        mono
        tone={stats.balanceDue > 0 ? "danger" : "success"}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  mono,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
  tone?: "danger" | "success";
}) {
  const valueColor =
    tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-brand-dark";
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className={`text-xl font-bold mt-1 ${valueColor} ${mono ? "font-mono" : ""}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-textSecondary mt-0.5">{sub}</div>}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? "border-brand-dark text-brand-dark"
          : "border-transparent text-textSecondary hover:text-brand-dark"
      }`}
    >
      {children}
    </button>
  );
}

function ProfileTab({ g }: { g: Guest }) {
  const cityState = [g.city, g.state].filter(Boolean).join(", ");
  return (
    <div className="space-y-4">
      <KycSection guestId={g.id} idProofType={g.idProofType} />

      <Section title="Contact">
        <Row label="Full Name" value={g.fullName} />
        <Row label="Phone" value={<span className="font-mono">{g.phone}</span>} />
        <Row label="Email" value={g.email} />
      </Section>

      <Section title="Identity">
        <Row
          label="ID Proof"
          value={
            <span className="capitalize">
              {g.idProofType.replace("_", " ")}{" "}
              <span className="font-mono">{g.idProofMasked ?? `••••${g.idProofLast4}`}</span>
            </span>
          }
        />
        <Row label="Nationality" value={g.nationality} />
        <Row
          label="Date of Birth"
          value={g.dateOfBirth ? format(new Date(g.dateOfBirth), "dd MMM yyyy") : null}
        />
      </Section>

      <Section title="Address">
        <Row label="Street" value={g.address} />
        <Row label="City / State" value={cityState || null} />
      </Section>

      <Section title="Business">
        <Row label="Company" value={g.companyName} />
        <Row label="GSTIN" value={g.gstin ? <span className="font-mono">{g.gstin}</span> : null} />
      </Section>

      <Section title="Other">
        <Row label="Added on" value={format(new Date(g.createdAt), "dd MMM yyyy")} />
        {g.notes && (
          <div className="col-span-full pt-2 border-t border-borderc mt-1">
            <div className="label">Notes</div>
            <div className="mt-1 whitespace-pre-wrap text-textPrimary text-sm">{g.notes}</div>
          </div>
        )}
      </Section>
    </div>
  );
}

interface KycStatus {
  verified: boolean;
  kycVerifiedAt: string | null;
  frontUrl: string | null;
  backUrl: string | null;
}

function KycSection({ guestId, idProofType }: { guestId: string; idProofType: string }) {
  const qc = useQueryClient();
  const [showUpload, setShowUpload] = useState(false);
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["kyc", guestId],
    queryFn: () => api.get<KycStatus>(`/guests/${guestId}/kyc`),
  });

  const proofLabel = idProofType.replace("_", " ");

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-borderc">
        <div className="flex items-center gap-2">
          <div className="text-[10px] uppercase tracking-[0.18em] text-brand font-bold">
            KYC Documents
          </div>
          {data?.verified && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-success bg-success/10 px-1.5 py-0.5 rounded-sm">
              <ShieldCheck className="w-3 h-3" /> Verified
            </span>
          )}
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="text-xs font-semibold inline-flex items-center gap-1 px-2.5 py-1 rounded-sm border border-borderc text-textSecondary hover:border-brand-dark hover:text-brand-dark transition-colors"
        >
          <Upload className="w-3 h-3" />
          {data?.frontUrl ? "Replace" : "Upload"}
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm text-textSecondary">Loading documents…</div>
      ) : !data?.frontUrl ? (
        <div className="flex items-center gap-3 py-4 text-sm text-textSecondary">
          <FileImage className="w-8 h-8 opacity-40 shrink-0" />
          <div>
            <div className="font-medium text-textPrimary">No KYC uploaded yet</div>
            <div className="text-xs mt-0.5">
              Capture {proofLabel} photos to complete verification.
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <KycThumb
            label={`${proofLabel} · Front`}
            url={data.frontUrl}
            onPreview={() =>
              data.frontUrl &&
              setPreview({ url: data.frontUrl, label: `${proofLabel} · Front` })
            }
            onReplace={() => setShowUpload(true)}
          />
          <KycThumb
            label={`${proofLabel} · Back`}
            url={data.backUrl}
            onPreview={() =>
              data.backUrl && setPreview({ url: data.backUrl, label: `${proofLabel} · Back` })
            }
            onReplace={() => setShowUpload(true)}
          />
        </div>
      )}

      {data?.kycVerifiedAt && (
        <div className="text-[11px] text-textSecondary mt-3">
          Verified on {format(new Date(data.kycVerifiedAt), "dd MMM yyyy · HH:mm")}
        </div>
      )}

      {showUpload && (
        <KycModal
          guestId={guestId}
          onClose={() => setShowUpload(false)}
          onUploaded={() => {
            qc.invalidateQueries({ queryKey: ["kyc", guestId] });
            qc.invalidateQueries({ queryKey: ["guest", guestId] });
          }}
        />
      )}

      {preview && (
        <ImagePreview
          url={preview.url}
          label={preview.label}
          onClose={() => setPreview(null)}
          onReplace={() => setShowUpload(true)}
        />
      )}
    </div>
  );
}

function KycThumb({
  label,
  url,
  onPreview,
  onReplace,
}: {
  label: string;
  url: string | null;
  onPreview: () => void;
  onReplace: () => void;
}) {
  if (!url) {
    return (
      <button
        onClick={onReplace}
        className="border-2 border-dashed border-borderc rounded-sm p-4 flex items-center gap-2 text-textSecondary text-xs hover:border-brand-dark hover:text-brand-dark transition-colors w-full text-left"
      >
        <Upload className="w-4 h-4 opacity-70" />
        <span>{label} — click to upload</span>
      </button>
    );
  }
  return (
    <div className="group relative block border border-borderc rounded-sm overflow-hidden bg-bg hover:border-brand-dark transition-colors">
      <button
        onClick={onPreview}
        className="block w-full text-left"
        title="Click to enlarge"
      >
        <div className="aspect-[3/2] bg-bg overflow-hidden">
          <img
            src={url}
            alt={label}
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform"
          />
        </div>
        <div className="px-2 py-1.5 text-[11px] font-semibold text-textSecondary group-hover:text-brand-dark">
          {label}
        </div>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onReplace();
        }}
        className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 text-[10px] font-semibold px-2 h-6 rounded-sm bg-brand-dark/90 text-cream backdrop-blur-sm hover:bg-brand-dark opacity-0 group-hover:opacity-100 transition-opacity"
        title="Replace this document"
      >
        <Pencil className="w-3 h-3" /> Edit
      </button>
    </div>
  );
}

function ImagePreview({
  url,
  label,
  onClose,
  onReplace,
}: {
  url: string;
  label?: string;
  onClose: () => void;
  onReplace?: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(z + 0.25, 4));
      else if (e.key === "-") setZoom((z) => Math.max(z - 0.25, 0.25));
      else if (e.key === "0") {
        setZoom(1);
        setRotation(0);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[160] grid place-items-center bg-brand-dark/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-4xl h-[90vh] bg-surface rounded-md shadow-2xl border border-borderc flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-borderc bg-bg/50">
          <div className="font-semibold text-brand-dark truncate">{label ?? "KYC document"}</div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setZoom((z) => Math.max(z - 0.25, 0.25))}
              className="text-textSecondary hover:text-brand-dark px-2 h-8 inline-flex items-center font-mono text-sm"
              title="Zoom out (-)"
            >
              −
            </button>
            <span className="text-xs font-mono text-textSecondary min-w-[3rem] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom((z) => Math.min(z + 0.25, 4))}
              className="text-textSecondary hover:text-brand-dark px-2 h-8 inline-flex items-center font-mono text-sm"
              title="Zoom in (+)"
            >
              +
            </button>
            <button
              onClick={() => setRotation((r) => (r + 90) % 360)}
              className="text-textSecondary hover:text-brand-dark px-2 h-8 inline-flex items-center text-xs font-semibold"
              title="Rotate"
            >
              Rotate
            </button>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold inline-flex items-center gap-1.5 px-2.5 h-8 rounded-sm border-2 border-borderc text-textSecondary hover:border-brand-dark hover:text-brand-dark transition-colors"
              title="Open in new tab"
            >
              <ExternalLink className="w-3.5 h-3.5" /> New tab
            </a>
            {onReplace && (
              <button
                onClick={() => {
                  onReplace();
                  onClose();
                }}
                className="text-xs font-semibold inline-flex items-center gap-1.5 px-2.5 h-8 rounded-sm bg-brand-dark text-cream border-2 border-brand-dark hover:opacity-90 transition-opacity"
                title="Replace this document"
              >
                <Upload className="w-3.5 h-3.5" /> Replace
              </button>
            )}
            <button
              onClick={onClose}
              className="ml-1 text-textSecondary hover:text-textPrimary"
              title="Close (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 bg-bg overflow-auto grid place-items-center p-4">
          <img
            src={url}
            alt={label ?? "KYC document"}
            style={{
              transform: `scale(${zoom}) rotate(${rotation}deg)`,
              transition: "transform 120ms ease",
            }}
            className="max-w-full max-h-full object-contain shadow-md rounded-sm bg-white"
            onMouseDown={(e) => e.stopPropagation()}
          />
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="text-[10px] uppercase tracking-[0.18em] text-brand font-bold mb-3 pb-2 border-b border-borderc">
        {title}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">{children}</div>
    </div>
  );
}

function TagsEditor({ guestId, tags }: { guestId: string; tags: string[] }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(tags);
  const [custom, setCustom] = useState("");

  const save = useMutation({
    mutationFn: () => api.patch(`/guests/${guestId}/tags`, { tags: draft }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["guest", guestId] });
      qc.invalidateQueries({ queryKey: ["guests"] });
      setEditing(false);
    },
  });

  function toggle(t: string) {
    setDraft((d) => (d.includes(t) ? d.filter((x) => x !== t) : [...d, t]));
  }
  function addCustom() {
    const v = custom.trim().toLowerCase();
    if (!v || draft.includes(v)) return;
    setDraft([...draft, v]);
    setCustom("");
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        {tags.map((t) => (
          <span
            key={t}
            className="text-xs font-semibold px-2 py-1 rounded-sm bg-brand-soft text-brand-dark capitalize"
          >
            {t.replace("_", " ")}
          </span>
        ))}
        <button
          onClick={() => {
            setDraft(tags);
            setEditing(true);
          }}
          className="text-xs font-semibold inline-flex items-center gap-1 px-2 py-1 rounded-sm border border-borderc text-textSecondary hover:border-brand-dark hover:text-brand-dark transition-colors"
        >
          <TagIcon className="w-3 h-3" />
          {tags.length === 0 ? "Add tags" : "Edit"}
        </button>
      </div>
    );
  }

  return (
    <div className="card w-full max-w-md space-y-2">
      <div className="flex items-center justify-between">
        <div className="label">Edit Tags</div>
        <button onClick={() => setEditing(false)} className="text-textSecondary hover:text-brand-dark">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {GUEST_TAGS.map((t) => (
          <button
            key={t}
            onClick={() => toggle(t)}
            className={`text-xs px-2 py-1 rounded-sm border-2 capitalize transition-colors ${
              draft.includes(t)
                ? "bg-brand-dark text-cream border-brand-dark"
                : "border-borderc text-textSecondary hover:border-brand-dark"
            }`}
          >
            {t.replace("_", " ")}
          </button>
        ))}
        {draft
          .filter((t) => !GUEST_TAGS.includes(t as typeof GUEST_TAGS[number]))
          .map((t) => (
            <button
              key={t}
              onClick={() => toggle(t)}
              className="text-xs px-2 py-1 rounded-sm border-2 bg-brand-dark text-cream border-brand-dark capitalize"
            >
              {t.replace("_", " ")} ×
            </button>
          ))}
      </div>
      <div className="flex gap-2">
        <input
          className="input h-8 text-sm"
          placeholder="Custom tag"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addCustom()}
        />
        <button onClick={addCustom} className="btn-secondary !h-8 !px-3 text-xs">
          Add
        </button>
      </div>
      <div className="flex justify-end gap-2">
        <button className="btn-secondary !h-8 text-xs" onClick={() => setEditing(false)}>
          Cancel
        </button>
        <button
          className="btn-primary !h-8 text-xs"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function NotesTab({ guestId }: { guestId: string }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ["guest-notes", guestId],
    queryFn: () => api.get<GuestNote[]>(`/guests/${guestId}/notes`),
  });

  const add = useMutation({
    mutationFn: () => api.post(`/guests/${guestId}/notes`, { body }),
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: ["guest-notes", guestId] });
    },
  });

  return (
    <div className="space-y-3">
      <div className="card space-y-2">
        <label className="label">Add Note</label>
        <textarea
          className="input min-h-[80px]"
          placeholder="Guest preferred late check-in, mentioned anniversary on 12 May…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex justify-end">
          <button
            className="btn-primary inline-flex items-center gap-1.5"
            disabled={!body.trim() || add.isPending}
            onClick={() => add.mutate()}
          >
            <Plus className="w-4 h-4" /> {add.isPending ? "Saving…" : "Add Note"}
          </button>
        </div>
      </div>

      {isLoading ? (
        <Loader />
      ) : notes.length === 0 ? (
        <div className="card text-textSecondary text-sm">No notes yet.</div>
      ) : (
        <div className="space-y-2">
          {notes.map((n) => (
            <div key={n.id} className="card">
              <div className="text-sm whitespace-pre-wrap">{n.body}</div>
              <div className="text-xs text-textSecondary mt-2">
                {format(new Date(n.createdAt), "dd MMM yyyy HH:mm")}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FollowUpsTab({ guestId }: { guestId: string }) {
  const qc = useQueryClient();
  const [task, setTask] = useState("");
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["guest-followups", guestId],
    queryFn: () => api.get<FollowUp[]>(`/guests/${guestId}/follow-ups`),
  });

  const add = useMutation({
    mutationFn: () => api.post(`/guests/${guestId}/follow-ups`, { task, dueDate }),
    onSuccess: () => {
      setTask("");
      qc.invalidateQueries({ queryKey: ["guest-followups", guestId] });
    },
  });

  const patch = useMutation({
    mutationFn: (vars: { id: string; status: "done" | "cancelled" | "pending" }) =>
      api.patch(`/guests/${guestId}/follow-ups/${vars.id}`, { status: vars.status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["guest-followups", guestId] }),
  });

  const pending = items.filter((i) => i.status === "pending");
  const done = items.filter((i) => i.status !== "pending");

  return (
    <div className="space-y-3">
      <div className="card space-y-2">
        <label className="label">Add Follow-up</label>
        <div className="grid grid-cols-[1fr_auto_auto] gap-2">
          <input
            className="input"
            placeholder="Call guest for feedback, send anniversary offer…"
            value={task}
            onChange={(e) => setTask(e.target.value)}
          />
          <input
            className="input w-40"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
          <button
            className="btn-primary inline-flex items-center gap-1.5"
            disabled={!task.trim() || add.isPending}
            onClick={() => add.mutate()}
          >
            <Plus className="w-4 h-4" /> {add.isPending ? "…" : "Add"}
          </button>
        </div>
      </div>

      {isLoading ? (
        <Loader />
      ) : (
        <>
          {pending.length > 0 && (
            <div className="card p-0">
              <div className="px-4 py-2 border-b flex items-center gap-2 text-sm font-semibold text-brand-dark">
                <Bell className="w-4 h-4" /> Pending ({pending.length})
              </div>
              <ul>
                {pending.map((f) => (
                  <FollowUpRow
                    key={f.id}
                    item={f}
                    onDone={() => patch.mutate({ id: f.id, status: "done" })}
                    onCancel={() => patch.mutate({ id: f.id, status: "cancelled" })}
                  />
                ))}
              </ul>
            </div>
          )}
          {done.length > 0 && (
            <div className="card p-0">
              <div className="px-4 py-2 border-b text-sm font-semibold text-textSecondary">
                History
              </div>
              <ul>
                {done.map((f) => (
                  <FollowUpRow key={f.id} item={f} />
                ))}
              </ul>
            </div>
          )}
          {items.length === 0 && (
            <div className="card text-textSecondary text-sm">No follow-ups.</div>
          )}
        </>
      )}
    </div>
  );
}

function FollowUpRow({
  item,
  onDone,
  onCancel,
}: {
  item: FollowUp;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const overdue =
    item.status === "pending" && new Date(item.dueDate) < new Date(new Date().toDateString());
  return (
    <li className="px-4 py-3 border-b last:border-b-0 flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div className={`text-sm ${item.status === "cancelled" ? "line-through text-textSecondary" : ""}`}>
          {item.task}
        </div>
        <div className={`text-xs ${overdue ? "text-danger font-semibold" : "text-textSecondary"}`}>
          Due {format(new Date(item.dueDate), "dd MMM yyyy")}
          {overdue && " · Overdue"}
          {item.status === "done" &&
            item.completedAt &&
            ` · Done ${format(new Date(item.completedAt), "dd MMM")}`}
          {item.status === "cancelled" && " · Cancelled"}
        </div>
      </div>
      {onDone && onCancel && (
        <div className="flex gap-1">
          <button
            onClick={onDone}
            className="btn-secondary !h-8 !px-2 inline-flex items-center gap-1 text-xs"
            title="Mark done"
          >
            <CheckCircle2 className="w-3.5 h-3.5" /> Done
          </button>
          <button
            onClick={onCancel}
            className="btn-secondary !h-8 !px-2 text-xs text-danger"
            title="Cancel"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </li>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  const isEmpty =
    value === null ||
    value === undefined ||
    value === "" ||
    (typeof value === "string" && value.trim() === "");
  return (
    <div>
      <div className="label">{label}</div>
      <div
        className={`mt-0.5 ${isEmpty ? "text-textSecondary/60 italic" : "text-textPrimary"}`}
      >
        {isEmpty ? "Not provided" : value}
      </div>
    </div>
  );
}
