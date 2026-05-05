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

export function RoleGuard({ allow, children }: { allow: Role[]; children: ReactNode }) {
  const { profile } = useAuth();
  if (!profile) return null;
  if (!allow.includes(profile.role)) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold">403 Forbidden</h1>
        <p className="text-textSecondary mt-2">
          Your role ({profile.role}) doesn't have access to this page.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
