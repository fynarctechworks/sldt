import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Bell, Check, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

interface ListResp {
  items: Notification[];
  unreadCount: number;
}

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const q = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<ListResp>("/notifications"),
    refetchInterval: 15000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const markAll = useMutation({
    mutationFn: () => api.post("/notifications/read-all"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const unread = q.data?.unreadCount ?? 0;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative grid place-items-center w-9 h-9 rounded-md text-textSecondary hover:bg-brand-soft hover:text-brand transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 grid place-items-center rounded-full bg-brand text-cream text-[10px] font-semibold">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[22rem] max-h-[28rem] bg-surface border border-borderc rounded-md shadow-lg z-50 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-borderc">
            <div className="font-semibold text-textPrimary">Notifications</div>
            {unread > 0 && (
              <button
                onClick={() => markAll.mutate()}
                className="text-xs text-brand hover:underline flex items-center gap-1"
                disabled={markAll.isPending}
              >
                <Check className="w-3 h-3" /> Mark all read
              </button>
            )}
          </div>

          <div className="overflow-y-auto flex-1">
            {q.isLoading && (
              <div className="p-6 text-center text-textSecondary text-sm flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading
              </div>
            )}
            {q.data?.items.length === 0 && (
              <div className="p-6 text-center text-textSecondary text-sm">No notifications</div>
            )}
            {q.data?.items.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  if (!n.readAt) markRead.mutate(n.id);
                  if (n.href) {
                    navigate(n.href);
                    setOpen(false);
                  }
                }}
                className={`w-full text-left px-4 py-3 border-b border-borderc/60 hover:bg-bg transition-colors ${
                  !n.readAt ? "bg-brand-soft/30" : ""
                }`}
              >
                <div className="flex items-start gap-2">
                  {!n.readAt && <span className="mt-1.5 w-2 h-2 rounded-full bg-brand shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-textPrimary truncate">{n.title}</div>
                    <div className="text-xs text-textSecondary line-clamp-2">{n.body}</div>
                    <div className="text-[10px] text-textSecondary mt-1">{timeAgo(n.createdAt)}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="border-t border-borderc">
            <button
              onClick={() => {
                navigate("/notifications");
                setOpen(false);
              }}
              className="w-full px-4 py-2.5 text-sm text-brand hover:bg-bg font-medium"
            >
              View all
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
