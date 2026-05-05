import { useQuery } from "@tanstack/react-query";
import {
  Activity,
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
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles: Array<"admin" | "frontdesk" | "housekeeping">;
}

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "frontdesk"] },
  { to: "/rooms", label: "Rooms", icon: DoorOpen, roles: ["admin", "frontdesk"] },
  { to: "/reservations", label: "Reservations", icon: CalendarCheck, roles: ["admin", "frontdesk"] },
  { to: "/guests", label: "Guests", icon: Users, roles: ["admin", "frontdesk"] },
  { to: "/housekeeping", label: "Housekeeping", icon: Sparkles, roles: ["admin", "frontdesk", "housekeeping"] },
  { to: "/messages", label: "Messages", icon: MessageSquare, roles: ["admin", "frontdesk", "housekeeping"] },
  { to: "/notifications", label: "Notifications", icon: Bell, roles: ["admin", "frontdesk", "housekeeping"] },
  { to: "/activity", label: "Activity", icon: Activity, roles: ["admin", "frontdesk"] },
  { to: "/reports", label: "Reports", icon: BarChart3, roles: ["admin"] },
  { to: "/settings", label: "Settings", icon: Settings, roles: ["admin"] },
];

export function Sidebar() {
  const { profile, signOut } = useAuth();
  const notifQ = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<{ unreadCount: number }>("/notifications"),
    refetchInterval: 30_000,
    enabled: !!profile,
  });
  const unread = notifQ.data?.unreadCount ?? 0;
  if (!profile) return null;

  return (
    <aside className="w-60 bg-brand-dark text-cream flex flex-col fixed top-0 left-0 h-full">
      <div className="px-5 py-5 border-b border-brass/15 flex items-center gap-3">
        <img src="/logo.jpg" alt="SLDT Stay Inn" className="w-10 h-10 rounded-md bg-cream object-contain p-0.5 shrink-0 ring-1 ring-brass/30" />
        <div className="min-w-0">
          <div className="text-base font-semibold tracking-tight leading-tight truncate text-cream">SLDT Stay Inn</div>
          <div className="text-[10px] text-brass tracking-[0.15em] mt-0.5">SABBAVARAM</div>
        </div>
      </div>

      <nav className="flex-1 py-3">
        {NAV.filter((i) => i.roles.includes(profile.role)).map((item) => {
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
            </NavLink>
          );
        })}
      </nav>

      <div className="px-5 py-4 border-t border-brass/15">
        <div className="text-[10px] text-brass tracking-[0.15em]">SIGNED IN AS</div>
        <div className="text-sm font-medium truncate text-cream mt-1">{profile.fullName}</div>
        <div className="text-xs text-cream/50 capitalize">{profile.role}</div>
        <button
          onClick={() => signOut()}
          className="mt-3 flex items-center gap-2 text-xs text-cream/60 hover:text-brass transition-colors"
        >
          <LogOut className="w-3 h-3" /> Sign out
        </button>
      </div>
    </aside>
  );
}
