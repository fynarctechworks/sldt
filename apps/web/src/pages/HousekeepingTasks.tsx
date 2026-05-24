// Housekeeping task board (Phase 2). Distinct from the room-status
// board on /housekeeping — this lists structured tasks (auto-created on
// checkout) with a checklist, an assignee, and a state machine.
//
// Layout: filter bar + card grid. Each card is a task with its room,
// type, assignee, and a step-progress bar. Clicking a card opens the
// checklist drawer where the cleaner ticks steps and completes.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CheckCircle2, ClipboardList, Play, UserCircle2, X } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { Loader } from "@/components/Loader";
import { useToast } from "@/components/Toast";
import { api, getList } from "@/lib/api";

interface TaskRow {
  id: string;
  roomNumber: string;
  floor: number;
  roomType: string;
  taskType: string;
  status: string;
  priority: number;
  assigneeName: string | null;
  assignedTo: string | null;
  dueAt: string | null;
  createdAt: string;
}

interface TaskStep {
  id: string;
  label: string;
  isDone: boolean;
  sortOrder: number;
}

interface TaskDetail extends TaskRow {
  steps: TaskStep[];
  notes: string | null;
  room: { roomNumber: string; status: string } | null;
  reservation: { reservationNumber: string; guestName: string; checkOutDate: string } | null;
}

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-brass/15 text-brand-dark",
  in_progress: "bg-brand-dark text-cream",
  blocked: "bg-danger/15 text-danger",
  done: "bg-success/15 text-success",
  skipped: "bg-bg text-textSecondary line-through",
};

const labelize = (s: string) => s.replace(/_/g, " ");

export default function HousekeepingTasksPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [openOnly, setOpenOnly] = useState(true);
  const [mineOnly, setMineOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { profile } = useAuth();
  const canComplete = can("complete_housekeeping_tasks");

  const listQuery = useQuery({
    queryKey: ["hk-tasks", { openOnly, mineOnly, me: profile?.id }],
    queryFn: () =>
      getList<TaskRow>("/housekeeping-tasks", {
        openOnly: openOnly ? "true" : "false",
        assignedTo: mineOnly ? profile?.id : undefined,
        per_page: 100,
      }),
    refetchInterval: 20_000,
  });

  const tasks = listQuery.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Housekeeping Tasks</h1>
          <div className="text-xs text-textSecondary mt-0.5">
            {listQuery.data?.meta.total ?? 0} {openOnly ? "open" : "total"} task
            {(listQuery.data?.meta.total ?? 0) === 1 ? "" : "s"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMineOnly((v) => !v)}
            className={`px-3 py-2 text-sm rounded-sm border ${mineOnly ? "bg-brand-dark text-cream border-brand-dark" : "bg-surface border-borderc hover:bg-bg"}`}
          >
            Mine
          </button>
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
        </div>
      </div>

      {listQuery.isLoading ? (
        <Loader label="Loading tasks…" />
      ) : tasks.length === 0 ? (
        <div className="card text-center py-10 text-sm text-textSecondary">
          <ClipboardList className="w-10 h-10 mx-auto mb-2 opacity-40" />
          {openOnly ? "No open tasks. Everything's clean." : "No tasks yet."}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {tasks.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedId(t.id)}
              // Mobile: bigger hit target (min-h 96), bigger room number,
              // active state for finger feedback. Cards stay desktop-y
              // on larger screens via sm: overrides.
              className="card text-left hover:shadow-md active:bg-bg/60 transition-shadow !p-4 sm:!p-3 min-h-[96px] sm:min-h-0"
            >
              <div className="flex items-center justify-between">
                <span className="text-2xl sm:text-lg font-bold font-mono text-brand-dark">
                  {t.roomNumber}
                </span>
                <span className={`text-[11px] sm:text-[10px] font-semibold px-2 py-0.5 rounded ${STATUS_STYLE[t.status]}`}>
                  {labelize(t.status)}
                </span>
              </div>
              <div className="text-sm sm:text-xs text-textSecondary mt-1 sm:mt-0.5">
                F{t.floor} · {labelize(t.taskType)}
              </div>
              <div className="flex items-center gap-1.5 mt-2 text-xs sm:text-[11px] text-textSecondary">
                <UserCircle2 className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                {t.assigneeName ?? "Unassigned"}
              </div>
            </button>
          ))}
        </div>
      )}

      {selectedId && (
        <TaskDrawer
          taskId={selectedId}
          canComplete={canComplete}
          onClose={() => setSelectedId(null)}
          onChanged={() => {
            void qc.invalidateQueries({ queryKey: ["hk-tasks"] });
            void qc.invalidateQueries({ queryKey: ["hk-task", selectedId] });
          }}
        />
      )}
    </div>
  );
}

function TaskDrawer({
  taskId,
  canComplete,
  onClose,
  onChanged,
}: {
  taskId: string;
  canComplete: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ["hk-task", taskId],
    queryFn: () => api.get<TaskDetail>(`/housekeeping-tasks/${taskId}`),
  });

  const stepMutation = useMutation({
    mutationFn: (vars: { stepId: string; isDone: boolean }) =>
      api.patch(`/housekeeping-tasks/${taskId}/steps/${vars.stepId}`, { isDone: vars.isDone }),
    onSuccess: () => onChanged(),
    onError: (e: Error) => toast(e.message, "error"),
  });

  const startMutation = useMutation({
    mutationFn: () => api.post(`/housekeeping-tasks/${taskId}/start`),
    onSuccess: () => {
      onChanged();
      toast("Task started", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const completeMutation = useMutation({
    mutationFn: () => api.post(`/housekeeping-tasks/${taskId}/complete`),
    onSuccess: () => {
      onChanged();
      toast("Task completed — room marked clean", "success");
      onClose();
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const doneCount = data?.steps.filter((s) => s.isDone).length ?? 0;
  const totalSteps = data?.steps.length ?? 0;
  const allDone = totalSteps > 0 && doneCount === totalSteps;

  return (
    <div className="fixed inset-0 z-50 bg-brand-dark/40 flex justify-end" onClick={onClose}>
      <div
        // Full-screen sheet on phones (under sm), right-side drawer on
        // larger screens. Same component — Tailwind responsive size.
        className="bg-surface w-full sm:max-w-md h-full overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {isLoading || !data ? (
          <Loader label="Loading task…" />
        ) : (
          <div className="p-4 space-y-4">
            <header className="flex items-start justify-between border-b border-borderc pb-3">
              <div>
                <div className="text-2xl font-bold font-mono text-brand-dark">
                  Room {data.roomNumber}
                </div>
                <div className="text-xs text-textSecondary">
                  {labelize(data.taskType)} ·{" "}
                  <span className={`px-1.5 py-0.5 rounded ${STATUS_STYLE[data.status]}`}>
                    {labelize(data.status)}
                  </span>
                </div>
                {data.reservation && (
                  <div className="text-xs text-textSecondary mt-1">
                    {data.reservation.guestName} · checked out {data.reservation.checkOutDate}
                  </div>
                )}
              </div>
              <button onClick={onClose} className="p-1 hover:bg-bg rounded">
                <X className="w-5 h-5" />
              </button>
            </header>

            {/* Progress */}
            <div>
              <div className="flex items-center justify-between text-xs text-textSecondary mb-1">
                <span>Checklist</span>
                <span>
                  {doneCount}/{totalSteps}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-borderc/40 overflow-hidden">
                <div
                  className="h-full bg-brand-dark transition-all"
                  style={{ width: totalSteps ? `${(doneCount / totalSteps) * 100}%` : "0%" }}
                />
              </div>
            </div>

            {/* Steps */}
            <ul className="space-y-1">
              {data.steps.map((s) => (
                <li key={s.id}>
                  <label
                    // Bigger row + bigger checkbox on mobile for thumb-tap.
                    className={`flex items-center gap-3 px-2 py-3 sm:py-2 rounded hover:bg-bg active:bg-bg cursor-pointer ${!canComplete ? "opacity-60 pointer-events-none" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={s.isDone}
                      disabled={stepMutation.isPending || data.status === "done"}
                      onChange={(e) => stepMutation.mutate({ stepId: s.id, isDone: e.target.checked })}
                      className="w-5 h-5 sm:w-4 sm:h-4 shrink-0"
                    />
                    <span className={`text-base sm:text-sm ${s.isDone ? "line-through text-textSecondary" : "text-brand-dark"}`}>
                      {s.label}
                    </span>
                  </label>
                </li>
              ))}
              {data.steps.length === 0 && (
                <li className="text-xs text-textSecondary py-2">No checklist steps.</li>
              )}
            </ul>

            {/* Actions */}
            {canComplete && data.status !== "done" && data.status !== "skipped" && (
              <div className="flex gap-2 pt-2 border-t border-borderc">
                {data.status === "pending" && (
                  <button
                    onClick={() => startMutation.mutate()}
                    disabled={startMutation.isPending}
                    className="btn-secondary flex-1 inline-flex items-center justify-center gap-1"
                  >
                    <Play className="w-4 h-4" /> Start
                  </button>
                )}
                <button
                  onClick={() => completeMutation.mutate()}
                  disabled={!allDone || completeMutation.isPending}
                  className="btn-primary flex-1 inline-flex items-center justify-center gap-1"
                  title={allDone ? "Mark task complete" : "Tick every step first"}
                >
                  <CheckCircle2 className="w-4 h-4" /> Complete
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
