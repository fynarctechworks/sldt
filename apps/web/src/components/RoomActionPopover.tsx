import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, Undo2, Wrench, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";

type HkStatus = "dirty" | "clean" | "inspected" | "available" | "maintenance";

function mutateRoomStatus(old: unknown, roomId: string, next: HkStatus): unknown {
  if (!old || typeof old !== "object") return old;
  const obj = old as Record<string, unknown>;

  // Dashboard shape: { room_grid: [{ id, status, ... }], ... }
  if (Array.isArray(obj.room_grid)) {
    return {
      ...obj,
      room_grid: (obj.room_grid as Array<Record<string, unknown>>).map((r) =>
        r.id === roomId ? { ...r, status: next } : r,
      ),
    };
  }

  // Reservation detail shape: { rooms: [{ id, status, ... }], ... }
  if (Array.isArray(obj.rooms)) {
    return {
      ...obj,
      rooms: (obj.rooms as Array<Record<string, unknown>>).map((r) =>
        r.id === roomId ? { ...r, status: next } : r,
      ),
    };
  }

  return old;
}

const TRANSITIONS: Record<HkStatus, { to: HkStatus; label: string; direction: "forward" | "reverse" | "side" }[]> = {
  dirty: [
    { to: "clean", label: "Mark Clean", direction: "forward" },
    { to: "maintenance", label: "Send to Maintenance", direction: "side" },
  ],
  clean: [
    { to: "inspected", label: "Mark Inspected", direction: "forward" },
    { to: "dirty", label: "Revert to Dirty", direction: "reverse" },
  ],
  inspected: [
    { to: "available", label: "Mark Available", direction: "forward" },
    { to: "dirty", label: "Revert to Dirty", direction: "reverse" },
  ],
  available: [
    { to: "dirty", label: "Mark Dirty (turn-down)", direction: "reverse" },
    { to: "maintenance", label: "Send to Maintenance", direction: "side" },
  ],
  maintenance: [
    { to: "available", label: "Back to Available", direction: "forward" },
    { to: "dirty", label: "Mark Dirty", direction: "reverse" },
  ],
};

interface Props {
  roomId: string;
  roomNumber: string;
  status: HkStatus;
  trigger: ReactNode;
  onChanged?: () => void;
  invalidateKeys?: string[][];
}

export function RoomActionPopover({ roomId, roomNumber, status, trigger, onChanged, invalidateKeys }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const update = useMutation({
    mutationFn: (next: HkStatus) => api.patch(`/housekeeping/${roomId}`, { status: next }),
    onMutate: async (next: HkStatus) => {
      const keys = invalidateKeys ?? [["dashboard"], ["reservation"]];
      // Cancel any in-flight refetches so they don't overwrite our optimistic update
      await Promise.all(keys.map((k) => qc.cancelQueries({ queryKey: k })));

      // Snapshot previous state for rollback
      const snapshots = keys.map((k) => [k, qc.getQueriesData({ queryKey: k })] as const);

      // Optimistically rewrite the room's status everywhere it appears
      keys.forEach((k) => {
        qc.setQueriesData({ queryKey: k }, (old: unknown) => mutateRoomStatus(old, roomId, next));
      });

      setOpen(false); // close instantly
      return { snapshots };
    },
    onError: (e, _next, ctx) => {
      // Roll back
      ctx?.snapshots.forEach(([_k, entries]) => {
        for (const [qk, data] of entries) qc.setQueryData(qk, data);
      });
      const msg = e instanceof ApiError ? e.message : "Update failed";
      alert(msg);
    },
    onSettled: () => {
      const keys = invalidateKeys ?? [["dashboard"], ["reservation"]];
      keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      onChanged?.();
    },
  });

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const options = TRANSITIONS[status] ?? [];

  return (
    <div className="relative inline-block" ref={wrapRef}>
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        {trigger}
      </span>

      {open && (
        <div className="absolute z-30 mt-2 right-0 w-64 bg-surface border border-borderc rounded-md shadow-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-borderc bg-brand-soft/40 flex items-center justify-between">
            <div className="text-xs">
              <span className="font-mono font-semibold">{roomNumber}</span>
              <span className="ml-2 text-textSecondary capitalize">· {status}</span>
            </div>
            <button onClick={() => setOpen(false)} className="text-textSecondary hover:text-textPrimary">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="p-1.5 flex flex-col gap-1">
            {options.map((opt) => {
              const Icon =
                opt.direction === "forward"
                  ? ArrowRight
                  : opt.direction === "reverse"
                    ? Undo2
                    : Wrench;
              const cls =
                opt.direction === "forward"
                  ? "bg-brand text-cream hover:bg-brand-dark"
                  : opt.direction === "reverse"
                    ? "bg-surface text-textPrimary border border-borderc hover:bg-bg"
                    : "bg-surface text-warning border border-warning/40 hover:bg-warning/5";
              return (
                <button
                  key={opt.to}
                  onClick={() => update.mutate(opt.to)}
                  disabled={update.isPending}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-sm text-left transition-colors disabled:opacity-50 ${cls}`}
                >
                  {update.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  ) : (
                    <Icon className="w-4 h-4 shrink-0" />
                  )}
                  <span className="flex-1">{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
