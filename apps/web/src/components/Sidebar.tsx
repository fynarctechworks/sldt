import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BadgeIndianRupee,
  BarChart3,
  Bell,
  CalendarCheck,
  DoorOpen,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Settings,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { useDialog } from "@/components/Dialog";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission: string; // permission key required to see this item
}

// Each item declares the permission key required. Admin (god mode) sees everything.
const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, permission: "view_dashboard" },
  { to: "/rooms", label: "Rooms", icon: DoorOpen, permission: "view_rooms" },
  { to: "/reservations", label: "Reservations", icon: CalendarCheck, permission: "view_reservations" },
  { to: "/guests", label: "Guests", icon: Users, permission: "view_guests" },
  { to: "/housekeeping", label: "Housekeeping", icon: Sparkles, permission: "view_housekeeping" },
  { to: "/messages", label: "Messages", icon: MessageSquare, permission: "view_messages" },
  // Both pages surface aggregate financial totals — gate behind
  // `view_revenue` so only admin (god-mode) and explicitly-granted roles
  // see them in the nav. `view_collections` still controls collection
  // workflows elsewhere (per-payment record etc.).
  { to: "/collections", label: "Collections", icon: Wallet, permission: "view_revenue" },
  { to: "/credits", label: "Credits", icon: BadgeIndianRupee, permission: "view_revenue" },
  { to: "/notifications", label: "Notifications", icon: Bell, permission: "view_notifications" },
  { to: "/activity", label: "Activity", icon: Activity, permission: "view_activity" },
  { to: "/reports", label: "Reports", icon: BarChart3, permission: "view_reports" },
  { to: "/settings", label: "Settings", icon: Settings, permission: "manage_settings" },
];

export function Sidebar() {
  const { profile, signOut, can } = useAuth();
  const dialog = useDialog();

  async function handleSignOut() {
    const ok = await dialog.confirm({
      title: "Sign out?",
      message: "You'll need to log in again to use the system.",
      okLabel: "Sign out",
      cancelLabel: "Stay signed in",
    });
    if (ok) await signOut();
  }
  const notifQ = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<{ unreadCount: number }>("/notifications"),
    refetchInterval: 30_000,
    enabled: !!profile && can("view_notifications"),
  });
  const unread = notifQ.data?.unreadCount ?? 0;

  const collectionsQ = useQuery({
    queryKey: ["collections-summary"],
    queryFn: () =>
      api
        .get<{ pendingPayments: { paymentId: string }[] }>("/reports/outstanding")
        .then((d) => d.pendingPayments.length),
    refetchInterval: 60_000,
    // Match the nav: Collections is now revenue-gated, so we shouldn't be
    // polling /reports/outstanding for a user who can't even see the page.
    enabled: !!profile && can("view_revenue"),
  });
  const owingCount = collectionsQ.data ?? 0;

  // Messages badge — sum of per-thread unread counts. Same polling
  // cadence as collections so the sidebar stays cheap.
  const messagesQ = useQuery({
    queryKey: ["messages-threads-summary"],
    queryFn: () =>
      api
        .get<{ items: { unread: number }[] }>("/messages/threads")
        .then((d) => d.items.reduce((s, t) => s + (t.unread ?? 0), 0)),
    refetchInterval: 30_000,
    enabled: !!profile && can("view_messages"),
  });
  const unreadMessages = messagesQ.data ?? 0;

  if (!profile) return null;

  const visible = NAV.filter((i) => can(i.permission));

  return (
    <aside className="w-60 bg-brand-dark text-cream flex flex-col fixed top-0 left-0 h-full">
      <div className="px-5 py-5 border-b border-brass/15 flex items-center gap-3">
        <img src="/logo.jpg" alt="SLDT Stay Inn" className="w-10 h-10 rounded-md bg-cream object-contain p-0.5 shrink-0 ring-1 ring-brass/30" />
        <div className="min-w-0">
          <div className="text-base font-semibold tracking-tight leading-tight truncate text-cream">SLDT Stay Inn</div>
          <div className="text-[10px] text-brass tracking-[0.15em] mt-0.5">SABBAVARAM</div>
        </div>
      </div>

      <nav className="flex-1 py-3 overflow-y-auto">
        {visible.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-5 py-2.5 text-sm transition-colors",
                  isActive
                    ? "bg-brand-mid/30 text-cream border-l-2 border-brass"
                    : "text-cream/70 hover:bg-cream/5 hover:text-cream border-l-2 border-transparent",
                )
              }
            >
              <Icon className="w-4 h-4" />
              <span className="flex-1">{item.label}</span>
              {item.to === "/notifications" && unread > 0 && (
                <span
                  className="w-2 h-2 rounded-full bg-brass shrink-0"
                  aria-label={`${unread} unread`}
                  title={`${unread} unread`}
                />
              )}
              {item.to === "/messages" && unreadMessages > 0 && (
                <span
                  className="w-2 h-2 rounded-full bg-brass shrink-0"
                  aria-label={`${unreadMessages} unread message${unreadMessages === 1 ? "" : "s"}`}
                  title={`${unreadMessages} unread message${unreadMessages === 1 ? "" : "s"}`}
                />
              )}
              {item.to === "/collections" && owingCount > 0 && (
                <span
                  className="relative flex w-2 h-2 shrink-0"
                  aria-label={`${owingCount} guest(s) owing`}
                  title={`${owingCount} guest(s) owing`}
                >
                  <span className="absolute inset-0 rounded-full bg-danger animate-ping opacity-60" />
                  <span className="relative w-2 h-2 rounded-full bg-danger" />
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      <div className="px-5 py-4 border-t border-brass/15">
        <div className="text-[10px] text-brass tracking-[0.15em]">SIGNED IN AS</div>
        <div className="text-sm font-medium truncate text-cream mt-1">{profile.fullName}</div>
        <div className="text-xs text-cream/50 capitalize">
          {profile.rbacRoleKey ?? profile.role}
        </div>
        <button
          onClick={handleSignOut}
          className="mt-3 flex items-center gap-2 text-xs text-cream/60 hover:text-brass transition-colors"
        >
          <LogOut className="w-3 h-3" /> Sign out
        </button>
      </div>
    </aside>
  );
}
