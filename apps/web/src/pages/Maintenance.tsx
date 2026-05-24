// Maintenance ticket inbox + detail. Two-pane layout: a filterable
// list on the left, the selected ticket's detail (with photos, events,
// status controls) on the right. New-ticket modal sits on top.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  Plus,
  Wrench,
  X,
} from "lucide-react";
import { useState } from "react";
import { Can } from "@/auth/Can";
import { useAuth } from "@/auth/AuthContext";
import { Loader } from "@/components/Loader";
import { useToast } from "@/components/Toast";
import { api, getList } from "@/lib/api";

const CATEGORIES = [
  "plumbing",
  "electrical",
  "ac_heating",
  "furniture",
  "appliances",
  "tv_internet",
  "locks_safety",
  "painting_walls",
  "flooring",
  "other",
] as const;

const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

const PRIORITY_STYLE: Record<string, string> = {
  low: "bg-bg text-textSecondary border-borderc",
  medium: "bg-accentBlue/10 text-accentBlue border-accentBlue/30",
  high: "bg-brass/15 text-brand-dark border-brass/40",
  urgent: "bg-danger/15 text-danger border-danger/40",
};

const STATUS_STYLE: Record<string, string> = {
  open: "bg-accentBlue/10 text-accentBlue",
  triaged: "bg-brass/15 text-brand-dark",
  in_progress: "bg-brand-dark text-cream",
  blocked: "bg-danger/15 text-danger",
  resolved: "bg-success/15 text-success",
  closed: "bg-bg text-textSecondary",
  wont_fix: "bg-bg text-textSecondary line-through",
};

interface TicketRow {
  id: string;
  ticketNumber: string;
  category: string;
  priority: string;
  status: string;
  title: string;
  roomNumber: string | null;
  floor: number | null;
  assigneeName: string | null;
  createdAt: string;
  blocksRoom: boolean;
}

const labelize = (s: string) => s.replace(/_/g, " ");

export default function MaintenancePage() {
  const { can } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [openOnly, setOpenOnly] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const listQuery = useQuery({
    queryKey: ["maintenance", { openOnly }],
    queryFn: () =>
      getList<TicketRow>("/maintenance", {
        openOnly: openOnly ? "true" : "false",
        per_page: 100,
      }),
    refetchInterval: 30_000,
  });

  const tickets = listQuery.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Maintenance</h1>
          <div className="text-xs text-textSecondary mt-0.5">
            {listQuery.data?.meta.total ?? 0} {openOnly ? "open" : "total"} ticket
            {(listQuery.data?.meta.total ?? 0) === 1 ? "" : "s"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-sm border border-borderc overflow-hidden text-sm">
            <button
              onClick={() => setOpenOnly(true)}
              className={`px-3 py-2 ${openOnly ? "bg-brand-dark text-cream" : "bg-surface hover:bg-bg"}`}
            >
              Open
            </button>
            <button
              onClick={() => setOpenOnly(false)}
              className={`px-3 py-2 border-l border-borderc ${!openOnly ? "bg-brand-dark text-cream" : "bg-surface hover:bg-bg"}`}
            >
              All
            </button>
          </div>
          <Can do="create_maintenance">
            <button
              onClick={() => setShowNew(true)}
              className="btn-primary inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> New ticket
            </button>
          </Can>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4">
        {/* List pane */}
        <div className="card !p-0 overflow-hidden">
          {listQuery.isLoading ? (
            <Loader label="Loading tickets…" />
          ) : tickets.length === 0 ? (
            <div className="p-8 text-center text-sm text-textSecondary">
              {openOnly ? "No open tickets. Nice." : "No tickets yet."}
            </div>
          ) : (
            <ul className="divide-y divide-borderc max-h-[70vh] overflow-y-auto">
              {tickets.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => setSelectedId(t.id)}
                    className={`w-full text-left px-3 py-3 hover:bg-bg ${selectedId === t.id ? "bg-brand-soft/40" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-accentBlue">{t.ticketNumber}</span>
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${PRIORITY_STYLE[t.priority]}`}
                      >
                        {t.priority}
                      </span>
                    </div>
                    <div className="text-sm font-medium text-brand-dark mt-0.5 truncate">
                      {t.title}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-textSecondary">
                      <span className={`px-1.5 py-0.5 rounded ${STATUS_STYLE[t.status]}`}>
                        {labelize(t.status)}
                      </span>
                      {t.roomNumber && <span>Room {t.roomNumber}</span>}
                      <span>· {labelize(t.category)}</span>
                      {t.blocksRoom && (
                        <span className="text-danger inline-flex items-center gap-0.5">
                          <AlertTriangle className="w-3 h-3" /> blocks
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Detail pane */}
        <div>
          {selectedId ? (
            <TicketDetail
              ticketId={selectedId}
              canEdit={can("edit_maintenance")}
              canClose={can("close_maintenance")}
              onChanged={() => {
                void qc.invalidateQueries({ queryKey: ["maintenance"] });
                void qc.invalidateQueries({ queryKey: ["maintenance-ticket", selectedId] });
              }}
            />
          ) : (
            <div className="card h-full grid place-items-center text-sm text-textSecondary min-h-[300px]">
              <div className="text-center">
                <Wrench className="w-10 h-10 mx-auto mb-2 opacity-40" />
                Select a ticket to view details.
              </div>
            </div>
          )}
        </div>
      </div>

      {showNew && (
        <NewTicketModal
          onClose={() => setShowNew(false)}
          onCreated={(id) => {
            setShowNew(false);
            setSelectedId(id);
            void qc.invalidateQueries({ queryKey: ["maintenance"] });
            toast("Ticket created", "success");
          }}
        />
      )}
    </div>
  );
}

interface TicketDetailData extends TicketRow {
  description: string | null;
  estimatedCost: string | null;
  actualCost: string | null;
  resolutionNotes: string | null;
  reservationId: string | null;
  photos: { id: string; url: string; caption: string | null }[];
  events: { id: string; eventType: string; description: string | null; actorName: string | null; createdAt: string }[];
  room: { id: string; roomNumber: string; status: string } | null;
}

const STATUS_ACTIONS: Record<string, { to: string; label: string }[]> = {
  open: [
    { to: "triaged", label: "Triage" },
    { to: "in_progress", label: "Start work" },
  ],
  triaged: [
    { to: "in_progress", label: "Start work" },
    { to: "blocked", label: "Block" },
  ],
  in_progress: [
    { to: "resolved", label: "Resolve" },
    { to: "blocked", label: "Block" },
  ],
  blocked: [{ to: "in_progress", label: "Unblock" }],
  resolved: [{ to: "closed", label: "Close" }],
};

function TicketDetail({
  ticketId,
  canEdit,
  canClose,
  onChanged,
}: {
  ticketId: string;
  canEdit: boolean;
  canClose: boolean;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ["maintenance-ticket", ticketId],
    queryFn: () => api.get<TicketDetailData>(`/maintenance/${ticketId}`),
  });
  const [resolutionNotes, setResolutionNotes] = useState("");

  const statusMutation = useMutation({
    mutationFn: (vars: { status: string; resolutionNotes?: string }) =>
      api.post(`/maintenance/${ticketId}/status`, vars),
    onSuccess: () => {
      onChanged();
      toast("Status updated", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const photoMutation = useMutation({
    mutationFn: (files: FileList) => {
      const form = new FormData();
      Array.from(files).forEach((f) => form.append("files", f));
      return api.upload(`/maintenance/${ticketId}/photos`, form);
    },
    onSuccess: () => {
      onChanged();
      toast("Photo added", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  if (isLoading || !data) return <Loader label="Loading ticket…" />;

  const actions = STATUS_ACTIONS[data.status] ?? [];

  return (
    <div className="card space-y-4">
      <header className="flex items-start justify-between gap-3 border-b border-borderc pb-3">
        <div>
          <div className="font-mono text-xs text-accentBlue">{data.ticketNumber}</div>
          <h2 className="text-lg font-bold text-brand-dark">{data.title}</h2>
          <div className="flex items-center gap-2 mt-1 text-xs">
            <span className={`px-2 py-0.5 rounded ${STATUS_STYLE[data.status]}`}>
              {labelize(data.status)}
            </span>
            <span className={`px-2 py-0.5 rounded border ${PRIORITY_STYLE[data.priority]}`}>
              {data.priority}
            </span>
            <span className="text-textSecondary">{labelize(data.category)}</span>
            {data.room && <span className="text-textSecondary">· Room {data.room.roomNumber}</span>}
          </div>
        </div>
      </header>

      {data.description && (
        <p className="text-sm text-textSecondary whitespace-pre-wrap">{data.description}</p>
      )}

      {/* Status actions */}
      {canEdit && (actions.length > 0 || canClose) && (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => {
            const isResolve = a.to === "resolved";
            return (
              <button
                key={a.to}
                disabled={statusMutation.isPending}
                onClick={() =>
                  statusMutation.mutate({
                    status: a.to,
                    resolutionNotes: isResolve ? resolutionNotes || undefined : undefined,
                  })
                }
                className="btn-secondary !h-8 text-xs"
              >
                {a.label}
              </button>
            );
          })}
          {data.status === "resolved" && canClose && (
            <button
              disabled={statusMutation.isPending}
              onClick={() => statusMutation.mutate({ status: "closed" })}
              className="btn-primary !h-8 text-xs inline-flex items-center gap-1"
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> Close ticket
            </button>
          )}
        </div>
      )}

      {/* Resolution note input shown when in_progress so it's ready at resolve time */}
      {canEdit && data.status === "in_progress" && (
        <div>
          <label className="text-xs font-medium text-textSecondary">Resolution notes (optional)</label>
          <textarea
            value={resolutionNotes}
            onChange={(e) => setResolutionNotes(e.target.value)}
            rows={2}
            className="input mt-1 w-full text-sm"
            placeholder="What was done to fix it…"
          />
        </div>
      )}

      {data.resolutionNotes && (
        <div className="bg-success/5 border border-success/20 rounded p-2 text-sm">
          <div className="text-[10px] uppercase tracking-wider text-success font-semibold">Resolution</div>
          {data.resolutionNotes}
        </div>
      )}

      {/* Photos */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-brand-dark">Photos</h3>
          {canEdit && (
            <label className="btn-secondary !h-7 text-xs inline-flex items-center gap-1 cursor-pointer">
              <Camera className="w-3.5 h-3.5" /> Add
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) photoMutation.mutate(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </div>
        {data.photos.length === 0 ? (
          <div className="text-xs text-textSecondary">No photos.</div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {data.photos.map((p) => (
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                <img
                  src={p.url}
                  alt={p.caption ?? "maintenance photo"}
                  className="w-full h-24 object-cover rounded border border-borderc hover:opacity-90"
                />
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Timeline */}
      <div>
        <h3 className="text-sm font-semibold text-brand-dark mb-2">Timeline</h3>
        <ul className="space-y-2">
          {data.events.map((e) => (
            <li key={e.id} className="flex items-start gap-2 text-xs">
              <Clock className="w-3.5 h-3.5 mt-0.5 text-textSecondary shrink-0" />
              <div>
                <span className="text-brand-dark font-medium">{e.description ?? labelize(e.eventType)}</span>
                <span className="text-textSecondary">
                  {" "}
                  · {e.actorName ?? "system"} · {format(new Date(e.createdAt), "d MMM, h:mm a")}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function NewTicketModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("other");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("medium");
  const [roomId, setRoomId] = useState("");
  const [blocksRoom, setBlocksRoom] = useState(false);

  const roomsQuery = useQuery({
    queryKey: ["rooms-min"],
    queryFn: () => api.get<{ id: string; roomNumber: string }[]>("/rooms"),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>("/maintenance", {
        title,
        description: description || null,
        category,
        priority,
        roomId: roomId || null,
        blocksRoom: blocksRoom && !!roomId,
      }),
    onSuccess: (row) => onCreated(row.id),
    onError: (e: Error) => toast(e.message, "error"),
  });

  return (
    <div className="fixed inset-0 z-50 bg-brand-dark/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-md border border-borderc w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between px-4 py-3 border-b border-borderc">
          <h2 className="font-semibold text-brand-dark">New maintenance ticket</h2>
          <button onClick={onClose} className="p-1 hover:bg-bg rounded">
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-textSecondary">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input mt-1 w-full"
              placeholder="e.g. AC not cooling in 203"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-medium text-textSecondary">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="input mt-1 w-full"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-textSecondary">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)} className="input mt-1 w-full">
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {labelize(c)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-textSecondary">Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} className="input mt-1 w-full">
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-textSecondary">Room (optional)</label>
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)} className="input mt-1 w-full">
              <option value="">— none —</option>
              {(roomsQuery.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  Room {r.roomNumber}
                </option>
              ))}
            </select>
          </div>
          {roomId && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={blocksRoom} onChange={(e) => setBlocksRoom(e.target.checked)} />
              Block this room (set to maintenance until resolved)
            </label>
          )}
        </div>
        <footer className="flex justify-end gap-2 px-4 py-3 border-t border-borderc">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            disabled={title.trim().length < 3 || createMutation.isPending}
            onClick={() => createMutation.mutate()}
            className="btn-primary"
          >
            {createMutation.isPending ? "Creating…" : "Create ticket"}
          </button>
        </footer>
      </div>
    </div>
  );
}
