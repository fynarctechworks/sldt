import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { api } from "@/lib/api";
import { CheckoutAlerts } from "./CheckoutAlerts";
import { Sidebar } from "./Sidebar";
import { useNotificationToasts } from "./Toast";

interface NotifResp {
  items: Array<{ id: string; readAt: string | null }>;
  unreadCount: number;
}

export function AppShell({ children }: { children: ReactNode }) {
  const q = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<NotifResp>("/notifications"),
    refetchInterval: 15000,
  });

  // Pre-fetch hotel branding once per session — used by receipt overlays
  useQuery({
    queryKey: ["settings-public"],
    queryFn: () => api.get("/settings/public"),
    staleTime: 30 * 60 * 1000, // fresh for 30 min
    gcTime: 60 * 60 * 1000, // keep cached for 1 hour
  });

  const unreadIds = useMemo(
    () => q.data?.items.filter((i) => !i.readAt).map((i) => i.id),
    [q.data],
  );
  useNotificationToasts(unreadIds);

  return (
    <div className="min-h-screen bg-bg">
      <Sidebar />
      <div className="ml-60">
        {/* CheckoutAlerts is sticky at top of the scroll area so it stays
            visible regardless of which page is mounted. */}
        <CheckoutAlerts />
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
