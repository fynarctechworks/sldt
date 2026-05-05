import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/auth/AuthContext";
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

const COLUMN_ORDER = ["dirty", "clean", "inspected", "available", "occupied", "reserved", "maintenance"];
const COLUMN_LABELS: Record<string, string> = {
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
  const [floor, setFloor] = useState("");
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

  const groups = Object.fromEntries(COLUMN_ORDER.map((s) => [s, [] as Room[]]));
  for (const r of rooms) {
    (groups[r.status] ?? (groups[r.status] = [])).push(r);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-navy">Housekeeping</h1>
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

      {err && <div className="card bg-danger/5 border-danger text-danger text-sm">{err}</div>}

      {isLoading ? (
        <Loader />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {COLUMN_ORDER.map((col) => (
            <div key={col} className="card p-3">
              <div className="flex items-center justify-between mb-3">
                <div className="font-semibold text-navy">{COLUMN_LABELS[col]}</div>
                <span className="text-xs text-textSecondary">{groups[col]?.length ?? 0}</span>
              </div>
              <div className="space-y-2">
                {(groups[col] ?? []).map((r) => {
                  const transitions = NEXT_STATUS[r.status] ?? [];
                  return (
                    <div key={r.id} className="border border-borderc rounded-sm p-2 bg-bg">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-mono font-bold">{r.roomNumber}</div>
                          <div className="text-xs text-textSecondary capitalize">
                            {r.roomType} · Floor {r.floor}
                          </div>
                        </div>
                        <StatusBadge status={r.status} />
                      </div>
                      {r.notes && (
                        <div className="text-xs text-warning bg-warning/5 p-1 mt-1 rounded">
                          {r.notes}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {transitions.map((t) => (
                          <button
                            key={t.status}
                            className="text-xs px-2 py-1 bg-navy text-white rounded-sm hover:opacity-90 inline-flex items-center gap-1"
                            onClick={() => updateStatus.mutate({ id: r.id, status: t.status })}
                          >
                            <Check className="w-3 h-3" />
                            {t.label}
                          </button>
                        ))}
                        {r.status !== "maintenance" && r.status !== "occupied" && r.status !== "reserved" && (
                          <button
                            className="text-xs px-2 py-1 bg-warning/20 text-[#B45309] rounded-sm hover:bg-warning/30 inline-flex items-center gap-1"
                            onClick={() => {
                              const reason = prompt("Maintenance issue?");
                              if (reason) flagMaint.mutate({ id: r.id, reason });
                            }}
                          >
                            <AlertTriangle className="w-3 h-3" /> Flag
                          </button>
                        )}
                        {r.status === "maintenance" && profile?.role === "admin" && (
                          <button
                            className="text-xs px-2 py-1 bg-success/20 text-success rounded-sm hover:bg-success/30"
                            onClick={() => resolveMaint.mutate(r.id)}
                          >
                            Resolve
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {(groups[col]?.length ?? 0) === 0 && (
                  <div className="text-xs text-textSecondary text-center py-4">No items</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
