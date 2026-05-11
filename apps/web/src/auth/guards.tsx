import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { Role } from "@hoteldesk/shared";
import { Loader } from "@/components/Loader";
import { useAuth } from "./AuthContext";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loader size="lg" fullscreen />;
  if (!session) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

// Legacy role guard. Still used by some pages until Phase 5 cleanup.
// Prefer PermissionGuard for new code.
export function RoleGuard({ allow, children }: { allow: Role[]; children: ReactNode }) {
  const { profile } = useAuth();
  if (!profile) return null;
  if (!allow.includes(profile.role)) {
    return <Forbidden detail={`Your role (${profile.role}) doesn't have access to this page.`} />;
  }
  return <>{children}</>;
}

// Permission-driven guard. Pass one or more permission keys; the user must have any of them.
// Admin (god mode) always passes.
export function PermissionGuard({
  any,
  all,
  children,
}: {
  any?: string[];
  all?: string[];
  children: ReactNode;
}) {
  const { profile, can } = useAuth();
  if (!profile) return null;
  const ok =
    (any && any.some((k) => can(k))) ||
    (all && all.every((k) => can(k))) ||
    (!any && !all);
  if (!ok) {
    return (
      <Forbidden detail="You don't have permission to access this page." />
    );
  }
  return <>{children}</>;
}

function Forbidden({ detail }: { detail: string }) {
  return (
    <div className="p-8 max-w-md">
      <h1 className="text-xl font-semibold text-brand-dark">403 Forbidden</h1>
      <p className="text-textSecondary mt-2 text-sm">{detail}</p>
    </div>
  );
}
