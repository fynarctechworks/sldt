import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Loader } from "@/components/Loader";
import { PermissionGuard, ProtectedRoute } from "@/auth/guards";

const Login = lazy(() => import("@/pages/Login"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Rooms = lazy(() => import("@/pages/Rooms"));
const RoomDetail = lazy(() => import("@/pages/RoomDetail"));
const CalendarPage = lazy(() => import("@/pages/Calendar"));
const Reservations = lazy(() => import("@/pages/Reservations"));
const NewReservation = lazy(() => import("@/pages/NewReservation"));
const ReservationDetail = lazy(() => import("@/pages/ReservationDetail"));
const Guests = lazy(() => import("@/pages/Guests"));
const GuestProfile = lazy(() => import("@/pages/GuestProfile"));
const Housekeeping = lazy(() => import("@/pages/Housekeeping"));
const HousekeepingTasks = lazy(() => import("@/pages/HousekeepingTasks"));
const Maintenance = lazy(() => import("@/pages/Maintenance"));
const RatePlans = lazy(() => import("@/pages/RatePlans"));
const Companies = lazy(() => import("@/pages/Companies"));
const GroupBookings = lazy(() => import("@/pages/GroupBookings"));
const ReservationFolios = lazy(() => import("@/pages/ReservationFolios"));
const Operations = lazy(() => import("@/pages/Operations"));
const PricingRules = lazy(() => import("@/pages/PricingRules"));
const BookingEngineSettings = lazy(() => import("@/pages/BookingEngineSettings"));
const DpdpRequests = lazy(() => import("@/pages/DpdpRequests"));
const GstReturns = lazy(() => import("@/pages/GstReturns"));
const PublicBooking = lazy(() => import("@/pages/PublicBooking"));
const Activity = lazy(() => import("@/pages/Activity"));
const Reports = lazy(() => import("@/pages/Reports"));
const Settings = lazy(() => import("@/pages/Settings"));
const Messages = lazy(() => import("@/pages/Messages"));
const Notifications = lazy(() => import("@/pages/Notifications"));
const Collections = lazy(() => import("@/pages/Collections"));
const Credits = lazy(() => import("@/pages/Credits"));

export default function App() {
  return (
    <Suspense fallback={<Loader size="lg" fullscreen />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* Password-reset confirmation. Public (no auth) — the user
            arrives from the recovery email link with a token in the URL
            hash. No AppShell. */}
        <Route path="/reset-password" element={<ResetPassword />} />
        {/* Public booking widget. No auth, no AppShell. Anyone with the
            URL can land here; the API enforces "is enabled". */}
        <Route path="/book/:propertyCode" element={<PublicBooking />} />

        {/* Dashboard is mounted at both / and /dashboard so the URL is
            explicit when staff types or bookmarks the dashboard. Both
            paths render the same component — no redirect, no
            additional fetch cost. */}
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
          path="/dashboard"
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
                <PermissionGuard any={["view_rooms"]}>
                  <Rooms />
                </PermissionGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/rooms/:id"
          element={
            <ProtectedRoute>
              <AppShell>
                <PermissionGuard any={["edit_rooms"]}>
                  <RoomDetail />
                </PermissionGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />

        <Route
          path="/calendar"
          element={
            <ProtectedRoute>
              <AppShell>
                <PermissionGuard any={["view_reservations"]}>
                  <CalendarPage />
                </PermissionGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/reservations"
          element={
            <ProtectedRoute>
              <AppShell>
                <PermissionGuard any={["view_reservations"]}>
                  <Reservations />
                </PermissionGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/reservations/new"
          element={
            <ProtectedRoute>
              <AppShell>
                <PermissionGuard any={["create_reservations"]}>
                  <NewReservation />
                </PermissionGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/reservations/:id"
          element={
            <ProtectedRoute>
              <AppShell>
                <PermissionGuard any={["view_reservations"]}>
                  <ReservationDetail />
                </PermissionGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />

        <Route
          path="/guests"
          element={
            <ProtectedRoute>
              <AppShell>
                <PermissionGuard any={["view_guests"]}>
                  <Guests />
                </PermissionGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/guests/:id"
          element={
            <ProtectedRoute>
              <AppShell>
                <PermissionGuard any={["view_guests"]}>
                  <GuestProfile />
                </PermissionGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />

        <Route
          path="/housekeeping"
          element={
            <ProtectedRoute>
              <AppShell>
                <PermissionGuard any={["view_housekeeping"]}>
                  <Housekeeping />
                </PermissionGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/housekeeping-tasks"
          element={
            <ProtectedRoute>
              <AppShell>
                <PermissionGuard any={["view_housekeeping_tasks"]}>
                  <HousekeepingTasks />
                </PermissionGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance"
          element={
            <ProtectedRoute>
              <AppShell>
                <PermissionGuard any={["view_maintenance"]}>
                  <Maintenance />
                </PermissionGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/companies"
          element={
            <ProtectedRoute>
              <AppShell>
                <PermissionGuard any={["view_companies"]}>
                  <Companies />
                </PermissionGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/group-bookings"
          element={
            <ProtectedRoute>
              <AppShell>
                <PermissionGuard any={["view_groups"]}>
                  <GroupBookings />
                </PermissionGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/reservations/:id/folios"
          element={
            <ProtectedRoute>
              <AppShell>
                <PermissionGuard any={["view_reservations"]}>
                  <ReservationFolios />
                </PermissionGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/operations"
          element={
            <ProtectedRoute>
              <AppShell>
                <PermissionGuard any={["view_reports", "view_night_audit"]}>
                  <Operations />
                </PermissionGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/pricing-rules"
          element={
            <ProtectedRoute>
              <AppShell>
                <PermissionGuard any={["view_pricing_rules"]}>
                  <PricingRules />
                </PermissionGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/booking-engine"
          element={
            <ProtectedRoute>
              <AppShell>
                <PermissionGuard any={["configure_booking_engine", "review_pending_bookings"]}>
                  <BookingEngineSettings />
                </PermissionGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/dpdp"
          element={
            <ProtectedRoute>
              <AppShell>
                <PermissionGuard any={["view_dpdp"]}>
                  <DpdpRequests />
                </PermissionGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/gst-returns"
          element={
            <ProtectedRoute>
              <AppShell>
                <PermissionGuard any={["export_gstr"]}>
                  <GstReturns />
                </PermissionGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/rate-plans"
          element={
            <ProtectedRoute>
              <AppShell>
                <PermissionGuard any={["view_rate_plans"]}>
                  <RatePlans />
                </PermissionGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/activity"
          element={
            <ProtectedRoute>
              <AppShell>
                <PermissionGuard any={["view_activity"]}>
                  <Activity />
                </PermissionGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <ProtectedRoute>
              <AppShell>
                <PermissionGuard any={["view_reports"]}>
                  <Reports />
                </PermissionGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <AppShell>
                <PermissionGuard any={["manage_settings", "manage_staff", "manage_roles", "manage_templates"]}>
                  <Settings />
                </PermissionGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />

        <Route
          path="/messages"
          element={
            <ProtectedRoute>
              <AppShell>
                <PermissionGuard any={["view_messages"]}>
                  <Messages />
                </PermissionGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/notifications"
          element={
            <ProtectedRoute>
              <AppShell>
                <PermissionGuard any={["view_notifications"]}>
                  <Notifications />
                </PermissionGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/collections"
          element={
            <ProtectedRoute>
              <AppShell>
                <PermissionGuard any={["view_revenue"]}>
                  <Collections />
                </PermissionGuard>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/credits"
          element={
            <ProtectedRoute>
              <AppShell>
                <PermissionGuard any={["view_revenue"]}>
                  <Credits />
                </PermissionGuard>
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
