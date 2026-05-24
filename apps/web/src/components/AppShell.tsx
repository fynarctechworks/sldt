import { useQuery } from "@tanstack/react-query";
import { Menu } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "@/lib/api";
import { CheckoutAlerts } from "./CheckoutAlerts";
import { CommandPalette } from "./CommandPalette";
import { Sidebar } from "./Sidebar";
import { useNotificationToasts } from "./Toast";

interface NotifResp {
  items: Array<{ id: string; readAt: string | null }>;
  unreadCount: number;
}

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("hd:sidebarCollapsed") === "1",
  );
  // Mobile drawer is independent of the desktop collapsed state. We
  // open it via the hamburger and auto-close on route change.
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("hd:sidebarCollapsed", next ? "1" : "0");
      return next;
    });
  }

  // Auto-close the mobile drawer whenever the route changes so a tap
  // on a nav link doesn't leave the drawer hanging open.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // When the drawer is open, lock body scroll so the page underneath
  // doesn't scroll behind the overlay.
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

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
      <CommandPalette />

      {/* Sidebar:
          - desktop (md+): fixed left rail, width depends on `collapsed`
          - mobile (< md): hidden by default; slides in over content when
            mobileOpen=true, with a backdrop tap-to-close. */}
      <div
        className={`md:hidden fixed inset-0 z-40 bg-brand-dark/40 backdrop-blur-[2px] transition-opacity ${
          mobileOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setMobileOpen(false)}
        aria-hidden
      />
      <div
        className={`md:hidden fixed top-0 left-0 z-50 h-full transition-transform duration-200 ease-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Force the sidebar into expanded mode in the drawer. The desktop
            toggle button is hidden on mobile via Sidebar's own md: guards. */}
        <Sidebar collapsed={false} onToggle={() => setMobileOpen(false)} mobile />
      </div>
      <div className="hidden md:block">
        <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
      </div>

      {/* Watermark — hidden on phones (too noisy on small screens). */}
      <div
        aria-hidden
        className={`hidden md:grid pointer-events-none fixed inset-0 ${
          collapsed ? "pl-16" : "pl-60"
        } place-items-center select-none transition-[padding] duration-200 ease-out`}
      >
        <img
          src="/logo.jpg"
          alt=""
          className="w-[min(70vw,640px)] h-auto opacity-[0.06] mix-blend-multiply"
        />
      </div>

      <div
        className={`relative transition-[margin] duration-200 ease-out ${
          collapsed ? "md:ml-16" : "md:ml-60"
        }`}
      >
        {/* Mobile top bar with hamburger. Only visible <md. Sticky so
            the user can always reach the menu without scrolling up. */}
        <header className="md:hidden sticky top-0 z-30 bg-brand-dark text-cream flex items-center gap-2 px-3 h-12 shadow-sm pt-safe">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="p-2 -ml-2 rounded hover:bg-white/10 active:bg-white/15"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <img
              src="/logo.jpg"
              alt=""
              className="w-7 h-7 rounded-sm bg-cream object-contain p-0.5 ring-1 ring-brass/30 shrink-0"
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold leading-tight truncate">SLDT Stay Inn</div>
              <div className="text-[9px] text-brass tracking-[0.15em] leading-none">SABBAVARAM</div>
            </div>
          </div>
        </header>

        <CheckoutAlerts />
        {/* Main content padding tightens on mobile so cards aren't crammed. */}
        <main className="p-3 sm:p-5 md:p-6">{children}</main>
      </div>
    </div>
  );
}
