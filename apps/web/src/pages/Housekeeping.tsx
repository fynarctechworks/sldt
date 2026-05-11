import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Pencil, X } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { useDialog } from "@/components/Dialog";
import { Loader } from "@/components/Loader";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/api";

interface Room {
  id: string;
  roomNumber: string;
  floor: number;
  roomType: string;
  status: string;
  notes: string | null;
}

const NEXT_STATUS: Record<string, { label: string; status: string }[]> = {
  dirty: [{ label: "Mark Clean", status: "clean" }],
  clean: [{ label: "Mark Inspected", status: "inspected" }],
  inspected: [{ label: "Ready / Available", status: "available" }],
  available: [],
  occupied: [],
  reserved: [],
  maintenance: [],
};

const STATUS_FILTERS = [
  "all",
  "dirty",
  "clean",
  "inspected",
  "available",
  "occupied",
  "reserved",
  "maintenance",
] as const;

const STATUS_LABELS: Record<string, string> = {
  all: "All",
  dirty: "Dirty",
  clean: "Clean",
  inspected: "Inspected",
  available: "Available",
  occupied: "Occupied",
  reserved: "Reserved",
  maintenance: "Maintenance",
};

export default function Housekeeping() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const dialog = useDialog();
  const [floor, setFloor] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [err, setErr] = useState<string | null>(null);

  const { data: rooms = [], isLoading } = useQuery({
    queryKey: ["hk", floor],
    queryFn: () => api.get<Room[]>("/housekeeping", { floor: floor || undefined }),
    refetchInterval: 15_000,
  });

  const updateStatus = useMutation({
    mutationFn: (v: { id: string; status: string }) =>
      api.patch(`/housekeeping/${v.id}`, { status: v.status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hk"] });
      setErr(null);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const flagMaint = useMutation({
    mutationFn: (v: { id: string; reason: string }) =>
      api.post(`/housekeeping/${v.id}/maintenance`, { reason: v.reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hk"] }),
    onError: (e: Error) => setErr(e.message),
  });

  const resolveMaint = useMutation({
    mutationFn: (id: string) => api.post(`/housekeeping/${id}/resolve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hk"] }),
    onError: (e: Error) => setErr(e.message),
  });

  const updateNotes = useMutation({
    mutationFn: (v: { id: string; notes: string | null }) =>
      api.patch(`/housekeeping/${v.id}/notes`, { notes: v.notes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hk"] }),
    onError: (e: Error) => setErr(e.message),
  });

  const counts = rooms.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  const filtered = statusFilter === "all" ? rooms : rooms.filter((r) => r.status === statusFilter);
  const sorted = [...filtered].sort((a, b) => {
    if (a.floor !== b.floor) return a.floor - b.floor;
    return a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true });
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Housekeeping</h1>
          <p className="text-sm text-textSecondary mt-0.5">
            All rooms at a glance. {rooms.length} total.
          </p>
        </div>
        <div className="flex items-end gap-3">
          <div>
            <label className="label block mb-1">Floor</label>
            <input
              className="input w-24"
              type="number"
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
              placeholder="All"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((s) => {
          const count = s === "all" ? rooms.length : counts[s] ?? 0;
          const active = statusFilter === s;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-sm border-2 transition-colors inline-flex items-center gap-2 ${
                active
                  ? "bg-brand-dark text-cream border-brand-dark"
                  : "bg-white text-textSecondary border-borderc hover:border-brand-dark hover:text-brand-dark"
              }`}
            >
              <span>{STATUS_LABELS[s]}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${active ? "bg-cream/20" : "bg-bg"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {err && <div className="card bg-danger/5 border-danger text-danger text-sm">{err}</div>}

      {isLoading ? (
        <Loader />
      ) : sorted.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 text-center text-textSecondary">
          <div className="text-sm">No rooms match this filter.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {sorted.map((r) => {
            const transitions = NEXT_STATUS[r.status] ?? [];
            const canFlag = r.status !== "maintenance" && r.status !== "occupied" && r.status !== "reserved";
            return (
              <div key={r.id} className="card p-4 flex flex-col gap-3">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-mono text-xl font-bold text-brand-dark leading-none">
                      {r.roomNumber}
                    </div>
                    <div className="text-xs text-textSecondary capitalize mt-1">
                      {r.roomType} · Floor {r.floor}
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                </div>

                {r.notes && (
                  <div className="text-xs text-warning bg-warning/5 p-2 rounded border border-warning/20 flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <div className="flex-1 break-words">{r.notes}</div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        className="text-warning/70 hover:text-warning transition-colors"
                        title="Edit note"
                        onClick={async () => {
                          const next = await dialog.prompt({
                            title: `Edit note · room ${r.roomNumber}`,
                            message: "Update the issue description.",
                            placeholder: "e.g. AC not cooling, leaking tap",
                            okLabel: "Save note",
                            tone: "warning",
                            required: true,
                            multiline: true,
                            defaultValue: r.notes ?? "",
                          });
                          if (next) updateNotes.mutate({ id: r.id, notes: next });
                        }}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        className="text-warning/70 hover:text-danger transition-colors"
                        title="Clear note"
                        onClick={async () => {
                          const ok = await dialog.confirm({
                            title: `Clear note on room ${r.roomNumber}?`,
                            message: `"${r.notes}" will be removed.`,
                            okLabel: "Clear note",
                            tone: "danger",
                          });
                          if (ok) updateNotes.mutate({ id: r.id, notes: null });
                        }}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-1.5 mt-auto">
                  {transitions.map((t) => (
                    <button
                      key={t.status}
                      className="text-xs px-2 py-1 bg-brand-dark text-cream rounded-sm hover:opacity-90 inline-flex items-center gap-1 font-semibold"
                      onClick={() => updateStatus.mutate({ id: r.id, status: t.status })}
                    >
                      <Check className="w-3 h-3" />
                      {t.label}
                    </button>
                  ))}
                  {canFlag && (
                    <button
                      className="text-xs px-2 py-1 bg-warning/20 text-[#B45309] rounded-sm hover:bg-warning/30 inline-flex items-center gap-1 font-semibold"
                      onClick={async () => {
                        const reason = await dialog.prompt({
                          title: `Flag room ${r.roomNumber}`,
                          message: "Describe the issue. Housekeeping will be notified.",
                          placeholder: "e.g. AC not cooling, leaking tap",
                          okLabel: "Flag for maintenance",
                          tone: "warning",
                          required: true,
                          multiline: true,
                        });
                        if (reason) flagMaint.mutate({ id: r.id, reason });
                      }}
                    >
                      <AlertTriangle className="w-3 h-3" /> Flag
                    </button>
                  )}
                  {r.status === "maintenance" && profile?.role === "admin" && (
                    <button
                      className="text-xs px-2 py-1 bg-success/20 text-success rounded-sm hover:bg-success/30 font-semibold"
                      onClick={() => resolveMaint.mutate(r.id)}
                    >
                      Resolve
                    </button>
                  )}
                  {transitions.length === 0 && !canFlag && r.status !== "maintenance" && (
                    <span className="text-xs text-textSecondary italic">No actions</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
