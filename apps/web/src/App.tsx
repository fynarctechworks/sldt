import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Loader } from "@/components/Loader";
import { ProtectedRoute, RoleGuard } from "@/auth/guards";

const Login = lazy(() => import("@/pages/Login"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Rooms = lazy(() => import("@/pages/Rooms"));
const RoomDetail = lazy(() => import("@/pages/RoomDetail"));
const Reservations = lazy(() => import("@/pages/Reservations"));
const NewReservation = lazy(() => import("@/pages/NewReservation"));
const ReservationDetail = lazy(() => import("@/pages/ReservationDetail"));
const Guests = lazy(() => import("@/pages/Guests"));
const GuestProfile = lazy(() => import("@/pages/GuestProfile"));
const Housekeeping = lazy(() => import("@/pages/Housekeeping"));
const Activity = lazy(() => import("@/pages/Activity"));
const Reports = lazy(() => import("@/pages/Reports"));
const Settings = lazy(() => import("@/pages/Settings"));
const Messages = lazy(() => import("@/pages/Messages"));
const Notifications = lazy(() => import("@/pages/Notifications"));

export default function App() {
  return (
    <Suspense fallback={<Loader size="lg" fullscreen />}>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppShell>
                <Dashboard />
              </AppShell>
            </ProtectedRoute>
          }
        />

        <Route
          path="/rooms"
          element={
            <ProtectedRoute>
              <AppShell>
                <RoleGuard allow={["admin", "frontdesk"]}>
                  <Rooms />
                </RoleGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/rooms/:id"
          element={
            <ProtectedRoute>
              <AppShell>
                <RoleGuard allow={["admin"]}>
                  <RoomDetail />
                </RoleGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />

        <Route
          path="/reservations"
          element={
            <ProtectedRoute>
              <AppShell>
                <RoleGuard allow={["admin", "frontdesk"]}>
                  <Reservations />
                </RoleGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/reservations/new"
          element={
            <ProtectedRoute>
              <AppShell>
                <RoleGuard allow={["admin", "frontdesk"]}>
                  <NewReservation />
                </RoleGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/reservations/:id"
          element={
            <ProtectedRoute>
              <AppShell>
                <RoleGuard allow={["admin", "frontdesk"]}>
                  <ReservationDetail />
                </RoleGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />

        <Route
          path="/guests"
          element={
            <ProtectedRoute>
              <AppShell>
                <RoleGuard allow={["admin", "frontdesk"]}>
                  <Guests />
                </RoleGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/guests/:id"
          element={
            <ProtectedRoute>
              <AppShell>
                <RoleGuard allow={["admin", "frontdesk"]}>
                  <GuestProfile />
                </RoleGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />

        <Route
          path="/housekeeping"
          element={
            <ProtectedRoute>
              <AppShell>
                <Housekeeping />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/activity"
          element={
            <ProtectedRoute>
              <AppShell>
                <RoleGuard allow={["admin", "frontdesk"]}>
                  <Activity />
                </RoleGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <ProtectedRoute>
              <AppShell>
                <RoleGuard allow={["admin"]}>
                  <Reports />
                </RoleGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <AppShell>
                <RoleGuard allow={["admin"]}>
                  <Settings />
                </RoleGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />

        <Route
          path="/messages"
          element={
            <ProtectedRoute>
              <AppShell>
                <Messages />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/notifications"
          element={
            <ProtectedRoute>
              <AppShell>
                <Notifications />
              </AppShell>
            </ProtectedRoute>
          }
        />

        <Route
          path="*"
          element={
            <div className="p-8">
              <h1 className="text-xl font-semibold">404</h1>
            </div>
          }
        />
      </Routes>
    </Suspense>
  );
}
