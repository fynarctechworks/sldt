import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Bell, CalendarPlus, CheckCircle2, Plus, Tag as TagIcon, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader } from "@/components/Loader";
import { api } from "@/lib/api";
import { GUEST_TAGS } from "@hoteldesk/shared";

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
  companyName: string | null;
  gstin: string | null;
  notes: string | null;
  tags: string[];
  createdAt: string;
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

  const { data, isLoading } = useQuery({
    queryKey: ["guest", id],
    queryFn: () => api.get<Guest>(`/guests/${id}`),
    enabled: !!id,
  });

  if (isLoading || !data) return <Loader size="lg" />;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy">{data.fullName}</h1>
          <div className="text-sm text-textSecondary font-mono">{data.phone}</div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <button
            className="btn-primary inline-flex items-center gap-2"
            onClick={() => navigate(`/reservations/new?guestId=${data.id}`)}
          >
            <CalendarPlus className="w-4 h-4" /> New Booking
          </button>
          <TagsEditor guestId={data.id} tags={data.tags ?? []} />
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
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
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active ? "border-navy text-navy" : "border-transparent text-textSecondary hover:text-navy"
      }`}
    >
      {children}
    </button>
  );
}

function ProfileTab({ g }: { g: Guest }) {
  return (
    <div className="card grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
      <Row label="Email" value={g.email ?? "-"} />
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
      <Row label="Address" value={g.address ?? "-"} />
      <Row label="City / State" value={`${g.city ?? "-"}, ${g.state ?? "-"}`} />
      <Row label="Company" value={g.companyName ?? "-"} />
      <Row label="GSTIN" value={g.gstin ?? "-"} />
      <Row label="Added" value={new Date(g.createdAt).toLocaleDateString("en-IN")} />
      {g.notes && (
        <div className="col-span-2">
          <div className="label">Notes</div>
          <div className="mt-0.5 whitespace-pre-wrap">{g.notes}</div>
        </div>
      )}
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
      <div className="flex items-center gap-2 flex-wrap justify-end max-w-sm">
        {tags.length === 0 && <span className="text-xs text-textSecondary">No tags</span>}
        {tags.map((t) => (
          <span key={t} className="text-xs px-2 py-1 rounded bg-accentBlue/10 text-navy capitalize">
            {t.replace("_", " ")}
          </span>
        ))}
        <button
          onClick={() => {
            setDraft(tags);
            setEditing(true);
          }}
          className="btn-secondary !h-8 !px-2 inline-flex items-center gap-1 text-xs"
        >
          <TagIcon className="w-3 h-3" /> Edit
        </button>
      </div>
    );
  }

  return (
    <div className="card w-full max-w-md space-y-2">
      <div className="flex items-center justify-between">
        <div className="label">Edit Tags</div>
        <button onClick={() => setEditing(false)} className="text-textSecondary hover:text-navy">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {GUEST_TAGS.map((t) => (
          <button
            key={t}
            onClick={() => toggle(t)}
            className={`text-xs px-2 py-1 rounded border capitalize ${
              draft.includes(t) ? "bg-navy text-white border-navy" : "border-gray-300 hover:bg-gray-50"
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
              className="text-xs px-2 py-1 rounded border bg-navy text-white border-navy capitalize"
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
              <div className="px-4 py-2 border-b flex items-center gap-2 text-sm font-semibold text-navy">
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
  return (
    <div>
      <div className="label">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}
