// Booking Engine settings + pending bookings inbox.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Globe, Inbox, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Can } from "@/auth/Can";
import { Loader } from "@/components/Loader";
import { useToast } from "@/components/Toast";
import { api, getList } from "@/lib/api";
import { inr } from "@/lib/utils";

interface BookingEngineSettings {
  propertyId: string;
  isEnabled: boolean;
  publicRatePlanId: string | null;
  cancellationPolicy: string | null;
  minAdvanceHours: number;
  maxNightsPerBooking: number;
  requireKycAtBooking: boolean;
  bannerImageUrl: string | null;
  tagline: string | null;
  channelLabel: string;
}

interface PendingBooking {
  id: string;
  publicRef: string;
  checkInDate: string;
  checkOutDate: string;
  roomType: string;
  guestName: string;
  guestPhone: string;
  quotedTotal: string;
  paymentStatus: string;
  status: string;
  submittedAt: string;
  rejectedReason: string | null;
}

export default function BookingEngineSettingsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["booking-engine"],
    queryFn: () => api.get<BookingEngineSettings>("/booking-engine"),
  });
  const pendingQuery = useQuery({
    queryKey: ["booking-engine-pending"],
    queryFn: () => getList<PendingBooking>("/booking-engine/pending"),
    refetchInterval: 30_000,
  });
  const ratePlansQuery = useQuery({
    queryKey: ["rate-plans-min"],
    queryFn: () =>
      api
        .get<{ data?: { id: string; code: string; name: string }[] } | { id: string; code: string; name: string }[]>("/rate-plans")
        .then((r) => (Array.isArray(r) ? r : r.data ?? [])),
  });

  const [form, setForm] = useState<Partial<BookingEngineSettings>>({});
  useEffect(() => {
    if (settingsQuery.data) {
      setForm({
        isEnabled: settingsQuery.data.isEnabled,
        publicRatePlanId: settingsQuery.data.publicRatePlanId,
        cancellationPolicy: settingsQuery.data.cancellationPolicy,
        minAdvanceHours: settingsQuery.data.minAdvanceHours,
        maxNightsPerBooking: settingsQuery.data.maxNightsPerBooking,
        requireKycAtBooking: settingsQuery.data.requireKycAtBooking,
        bannerImageUrl: settingsQuery.data.bannerImageUrl,
        tagline: settingsQuery.data.tagline,
        channelLabel: settingsQuery.data.channelLabel,
      });
    }
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => api.put("/booking-engine", form),
    onSuccess: () => {
      toast("Settings saved", "success");
      void qc.invalidateQueries({ queryKey: ["booking-engine"] });
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  if (settingsQuery.isLoading) return <Loader label="Loading…" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-dark">Booking Engine</h1>
        <div className="text-xs text-textSecondary mt-0.5">
          Public booking widget configuration + inbound submissions inbox
        </div>
      </div>

      {/* Settings */}
      <div className="card space-y-4">
        <header className="flex items-center justify-between border-b border-borderc pb-3">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-brand-dark" />
            <h2 className="font-semibold text-brand-dark">Public widget</h2>
          </div>
          <Can do="configure_booking_engine">
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="btn-primary inline-flex items-center gap-2 !h-9 text-sm"
            >
              <Save className="w-4 h-4" /> Save
            </button>
          </Can>
        </header>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={!!form.isEnabled}
            onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })}
          />
          <span className="text-sm">
            Enable the public booking page (
            <code className="text-xs text-accentBlue">/book/PRIMARY</code>)
          </span>
        </label>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-textSecondary">Public rate plan</label>
            <select
              value={form.publicRatePlanId ?? ""}
              onChange={(e) =>
                setForm({ ...form, publicRatePlanId: e.target.value || null })
              }
              className="input mt-1 w-full"
            >
              <option value="">— pick a plan —</option>
              {(ratePlansQuery.data ?? []).map((rp) => (
                <option key={rp.id} value={rp.id}>
                  {rp.code} · {rp.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-textSecondary">Max nights per booking</label>
            <input
              type="number"
              min="1"
              max="60"
              value={form.maxNightsPerBooking ?? 14}
              onChange={(e) =>
                setForm({ ...form, maxNightsPerBooking: Number(e.target.value) })
              }
              className="input mt-1 w-full"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-textSecondary">Min advance hours</label>
            <input
              type="number"
              min="0"
              max="720"
              value={form.minAdvanceHours ?? 0}
              onChange={(e) => setForm({ ...form, minAdvanceHours: Number(e.target.value) })}
              className="input mt-1 w-full"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-textSecondary">Channel label (booking source)</label>
            <input
              value={form.channelLabel ?? "phone_whatsapp"}
              onChange={(e) => setForm({ ...form, channelLabel: e.target.value })}
              className="input mt-1 w-full"
            />
          </div>
        </div>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={!!form.requireKycAtBooking}
            onChange={(e) => setForm({ ...form, requireKycAtBooking: e.target.checked })}
          />
          <span className="text-sm">Require KYC at booking time (otherwise collected at check-in)</span>
        </label>

        <div>
          <label className="text-xs font-medium text-textSecondary">Tagline shown on the public page</label>
          <input
            value={form.tagline ?? ""}
            onChange={(e) => setForm({ ...form, tagline: e.target.value })}
            className="input mt-1 w-full"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-textSecondary">Cancellation policy (markdown)</label>
          <textarea
            rows={4}
            value={form.cancellationPolicy ?? ""}
            onChange={(e) => setForm({ ...form, cancellationPolicy: e.target.value })}
            className="input mt-1 w-full text-sm"
            placeholder="Free cancellation up to 48 hours before check-in…"
          />
        </div>
      </div>

      {/* Pending inbox */}
      <div className="card space-y-3">
        <header className="flex items-center justify-between border-b border-borderc pb-3">
          <div className="flex items-center gap-2">
            <Inbox className="w-4 h-4 text-brand-dark" />
            <h2 className="font-semibold text-brand-dark">Inbound submissions</h2>
          </div>
          <span className="text-xs text-textSecondary">
            {pendingQuery.data?.meta.total ?? 0} total
          </span>
        </header>

        {pendingQuery.isLoading ? (
          <Loader label="Loading inbox…" />
        ) : (pendingQuery.data?.data.length ?? 0) === 0 ? (
          <div className="text-sm text-textSecondary py-6 text-center">No pending bookings yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="text-textSecondary text-left">
                <tr>
                  <th className="px-2 py-1">Ref</th>
                  <th className="px-2 py-1">Submitted</th>
                  <th className="px-2 py-1">Guest</th>
                  <th className="px-2 py-1">Phone</th>
                  <th className="px-2 py-1">Stay</th>
                  <th className="px-2 py-1">Room type</th>
                  <th className="px-2 py-1 text-right">Total</th>
                  <th className="px-2 py-1">Payment</th>
                  <th className="px-2 py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {(pendingQuery.data?.data ?? []).map((p) => (
                  <tr key={p.id} className="border-t border-borderc/60">
                    <td className="px-2 py-1 font-mono">{p.publicRef}</td>
                    <td className="px-2 py-1">{format(new Date(p.submittedAt), "d MMM, h:mm a")}</td>
                    <td className="px-2 py-1">{p.guestName}</td>
                    <td className="px-2 py-1">{p.guestPhone}</td>
                    <td className="px-2 py-1">
                      {p.checkInDate} → {p.checkOutDate}
                    </td>
                    <td className="px-2 py-1">{p.roomType.replace(/_/g, " ")}</td>
                    <td className="px-2 py-1 text-right font-mono">{inr(Number(p.quotedTotal))}</td>
                    <td className="px-2 py-1">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg text-textSecondary">
                        {p.paymentStatus}
                      </span>
                    </td>
                    <td className="px-2 py-1">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${p.status === "received" ? "bg-brass/15 text-brand-dark" : p.status === "accepted" ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}`}
                      >
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
