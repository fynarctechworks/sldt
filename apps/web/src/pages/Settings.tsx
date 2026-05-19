import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Pencil, Plus, Trash2, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { useDialog } from "@/components/Dialog";
import { Loader } from "@/components/Loader";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { inr } from "@/lib/utils";

type Tab = "hotel" | "room-types" | "staff" | "roles" | "audit";

export default function Settings() {
  const { can } = useAuth();
  const canAudit = can("manage_staff");
  const tabs = useMemo<{ id: Tab; label: string }[]>(() => {
    const base: { id: Tab; label: string }[] = [
      { id: "hotel", label: "Hotel Profile" },
      { id: "room-types", label: "Room Types" },
      { id: "staff", label: "Staff" },
      { id: "roles", label: "Roles & Permissions" },
    ];
    if (canAudit) base.push({ id: "audit", label: "Audit Log" });
    return base;
  }, [canAudit]);
  const [tab, setTab] = useState<Tab>("hotel");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-navy">Settings</h1>
      <div className="flex gap-1 flex-wrap border-b border-borderc">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              tab === t.id
                ? "border-gold text-navy"
                : "border-transparent text-textSecondary hover:text-navy"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "hotel" && <HotelTab />}
      {tab === "room-types" && <RoomTypesTab />}
      {tab === "staff" && <StaffTab />}
      {tab === "roles" && <RolesTab />}
      {tab === "audit" && canAudit && <AuditTab />}
    </div>
  );
}

interface HotelSettings {
  id: string;
  hotelName: string;
  hotelAddress: string;
  hotelPhone: string;
  hotelEmail: string | null;
  hotelGstin: string;
  invoicePrefix: string;
  checkInTime: string;
  checkOutTime: string;
  ownerPhone: string | null;
  ownerNotifyEnabled: boolean;
  wifiSsid: string | null;
  wifiPassword: string | null;
  // Property-wide GST pricing mode. 'inclusive' = rate the staff types
  // already contains GST; 'exclusive' = GST is added on top. Only
  // affects NEW bookings; existing reservations keep their own snapshot.
  gstMode: "exclusive" | "inclusive";
}

function HotelTab() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: () =>
      api.get<{
        settings: HotelSettings | null;
        roomTypes: unknown[];
      }>("/settings"),
  });
  const [form, setForm] = useState<HotelSettings | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (data?.settings && !form) setForm(data.settings);
  }, [data, form]);

  const save = useMutation({
    mutationFn: (f: HotelSettings) => {
      const payload: Record<string, unknown> = {
        hotelName: f.hotelName,
        hotelAddress: f.hotelAddress,
        hotelPhone: f.hotelPhone,
        hotelGstin: f.hotelGstin,
        invoicePrefix: f.invoicePrefix,
        checkInTime: f.checkInTime,
        checkOutTime: f.checkOutTime,
        hotelEmail: f.hotelEmail && f.hotelEmail.trim() !== "" ? f.hotelEmail : null,
        ownerPhone: f.ownerPhone && f.ownerPhone.trim() !== "" ? f.ownerPhone : null,
        ownerNotifyEnabled: f.ownerNotifyEnabled,
        wifiSsid: f.wifiSsid && f.wifiSsid.trim() !== "" ? f.wifiSsid : null,
        wifiPassword: f.wifiPassword && f.wifiPassword.trim() !== "" ? f.wifiPassword : null,
        gstMode: f.gstMode,
      };
      for (const k of Object.keys(payload)) {
        if (payload[k] === "" || payload[k] === undefined) delete payload[k];
      }
      return api.put("/settings", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      setMsg("Saved");
      setTimeout(() => setMsg(null), 2000);
    },
    onError: (e: Error) => setMsg(e.message),
  });

  if (!form) return <Loader />;

  const set = <K extends keyof HotelSettings>(k: K, v: HotelSettings[K]) =>
    setForm({ ...form, [k]: v });

  return (
    <div className="card space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Hotel Name">
          <input className="input" value={form.hotelName} onChange={(e) => set("hotelName", e.target.value)} />
        </Field>
        <Field label="Phone">
          <input className="input" value={form.hotelPhone ?? ""} onChange={(e) => set("hotelPhone", e.target.value)} />
        </Field>
        <Field label="Email">
          <input className="input" value={form.hotelEmail ?? ""} onChange={(e) => set("hotelEmail", e.target.value)} />
        </Field>
        <Field label="GSTIN">
          <input
            className="input font-mono"
            value={form.hotelGstin ?? ""}
            onChange={(e) => set("hotelGstin", e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Invoice Prefix">
          <input
            className="input"
            value={form.invoicePrefix ?? "INV"}
            onChange={(e) => set("invoicePrefix", e.target.value)}
          />
        </Field>
        <Field label="Default Check-in">
          <input
            className="input"
            type="time"
            value={form.checkInTime ?? "12:00"}
            onChange={(e) => set("checkInTime", e.target.value)}
          />
        </Field>
        <Field label="Default Check-out">
          <input
            className="input"
            type="time"
            value={form.checkOutTime ?? "11:00"}
            onChange={(e) => set("checkOutTime", e.target.value)}
          />
        </Field>
        <Field label="GST Pricing Mode">
          <select
            className="input"
            value={form.gstMode ?? "inclusive"}
            onChange={(e) => set("gstMode", e.target.value as "exclusive" | "inclusive")}
          >
            <option value="inclusive">Inclusive — rate already contains GST</option>
            <option value="exclusive">Exclusive — GST is added on top of rate</option>
          </select>
          <div className="text-[11px] text-textSecondary mt-1 leading-snug">
            {form.gstMode === "inclusive" ? (
              <>
                Staff types <span className="font-mono">₹1000</span>, the guest pays{" "}
                <span className="font-mono">₹1000</span>. GST = 5% of ₹1000 =
                <span className="font-mono"> ₹50</span> (CGST{" "}
                <span className="font-mono">₹25</span> + SGST{" "}
                <span className="font-mono">₹25</span>); net room =
                <span className="font-mono"> ₹950</span>.
              </>
            ) : (
              <>
                Staff types <span className="font-mono">₹1000</span>, the guest pays{" "}
                <span className="font-mono">₹1050</span> (₹1000 + 5% GST).
              </>
            )}
            <br />
            <span className="text-textSecondary/80">
              Changing this only affects new bookings; existing reservations
              keep their original math.
            </span>
          </div>
        </Field>
      </div>
      <Field label="Address">
        <input className="input" value={form.hotelAddress ?? ""} onChange={(e) => set("hotelAddress", e.target.value)} />
      </Field>

      <div className="border-t border-borderc pt-4 mt-2 space-y-3">
        <h3 className="font-semibold text-brand-dark">Owner Notifications</h3>
        <p className="text-xs text-textSecondary -mt-2">
          Owner gets an SMS on every new booking, check-in and check-out.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Owner Phone (with country code)">
            <input
              className="input"
              placeholder="+91 90000 00000"
              value={form.ownerPhone ?? ""}
              onChange={(e) => set("ownerPhone", e.target.value)}
            />
          </Field>
          <Field label="Send owner alerts">
            <label className="flex items-center gap-2 px-3 py-2 border border-borderc rounded-sm bg-surface cursor-pointer hover:bg-bg select-none">
              <input
                type="checkbox"
                checked={form.ownerNotifyEnabled}
                onChange={(e) => set("ownerNotifyEnabled", e.target.checked)}
                className="w-4 h-4 accent-brand"
              />
              <span className="text-sm">Enabled</span>
            </label>
          </Field>
        </div>
      </div>

      <div className="border-t border-borderc pt-4 mt-2 space-y-3">
        <h3 className="font-semibold text-brand-dark">Guest Wi-Fi</h3>
        <p className="text-xs text-textSecondary -mt-2">
          Shown in the check-in WhatsApp message so guests don't have to ask the front desk.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Network name (SSID)">
            <input
              className="input"
              placeholder="SLDT_Guest"
              value={form.wifiSsid ?? ""}
              onChange={(e) => set("wifiSsid", e.target.value)}
            />
          </Field>
          <Field label="Password">
            <input
              className="input"
              placeholder="sldt2026"
              value={form.wifiPassword ?? ""}
              onChange={(e) => set("wifiPassword", e.target.value)}
            />
          </Field>
        </div>
      </div>

      <div className="flex justify-end gap-2 items-center">
        {msg && <span className="text-xs text-success">{msg}</span>}
        <button className="btn-primary" onClick={() => save.mutate(form)} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

interface ShortStayBand {
  label: string;
  hours: number;
  rate: number;
}

interface RoomTypeRow {
  id: string;
  slug: string;
  label: string;
  defaultRate: string;
  maxOccupancy: string;
  description: string | null;
  isActive: boolean;
  // Day-use price bands shown on the reservation form when stay_type is
  // 'short_stay'. Empty array when the property hasn't configured any
  // (the booking form then pro-rates the overnight default rate).
  shortStayBands?: ShortStayBand[];
}

function RoomTypesTab() {
  const qc = useQueryClient();
  const dialog = useDialog();
  const { data: types = [] } = useQuery({
    queryKey: ["room-types", true],
    queryFn: () => api.get<RoomTypeRow[]>("/settings/room-types", { all: "true" }),
  });

  const [editing, setEditing] = useState<RoomTypeRow | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const archive = useMutation({
    mutationFn: (id: string) => api.del(`/settings/room-types/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["room-types"] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="text-sm text-textSecondary">
          Room types drive every Type dropdown across the app. Archived types remain on existing rooms but are hidden from new-room forms.
        </div>
        <button className="btn-primary inline-flex items-center gap-2" onClick={() => setShowAdd(true)}>
          <Plus className="w-4 h-4" /> Add Room Type
        </button>
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="table-base table-fixed">
          <colgroup>
            <col className="w-[28%]" />
            <col className="w-[22%]" />
            <col className="w-[14%]" />
            <col className="w-[10%]" />
            <col className="w-[12%]" />
            <col className="w-[14%]" />
          </colgroup>
          <thead>
            <tr>
              <th>Label</th>
              <th>Slug</th>
              <th className="!text-right">Default Rate</th>
              <th className="!text-right">Max Occ.</th>
              <th>Status</th>
              <th className="!text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {types.length === 0 && (
              <tr>
                <td colSpan={6} className="p-4 text-textSecondary text-center">
                  No room types yet. Add one to start creating rooms.
                </td>
              </tr>
            )}
            {types.map((t) => (
              <tr key={t.id} className={t.isActive ? "" : "opacity-60"}>
                <td className="font-medium text-navy">{t.label}</td>
                <td className="font-mono text-xs text-textSecondary">{t.slug}</td>
                <td className="text-right font-mono tabular-nums">{inr(t.defaultRate)}</td>
                <td className="text-right tabular-nums">{t.maxOccupancy}</td>
                <td>
                  <span
                    className={`inline-block px-2 py-0.5 rounded-sm text-xs font-medium ${
                      t.isActive
                        ? "bg-success/15 text-success"
                        : "bg-gray-200 text-textSecondary"
                    }`}
                  >
                    {t.isActive ? "Active" : "Archived"}
                  </span>
                </td>
                <td>
                  <div className="flex items-center justify-end gap-3">
                    <button
                      className="text-accentBlue text-xs hover:underline"
                      onClick={() => setEditing(t)}
                    >
                      Edit
                    </button>
                    {t.isActive && (
                      <button
                        className="text-danger text-xs hover:underline inline-flex items-center gap-1"
                        onClick={async () => {
                          const ok = await dialog.confirm({
                            title: `Archive "${t.label}"?`,
                            message: "Existing rooms keep the type; it'll be hidden from new-room forms.",
                            okLabel: "Archive",
                            tone: "danger",
                          });
                          if (ok) archive.mutate(t.id);
                        }}
                      >
                        <Trash2 className="w-3 h-3" /> Archive
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(showAdd || editing) && (
        <RoomTypeModal
          row={editing}
          onClose={() => {
            setShowAdd(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function RoomTypeModal({ row, onClose }: { row: RoomTypeRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!row;
  const [form, setForm] = useState({
    slug: row?.slug ?? "",
    label: row?.label ?? "",
    defaultRate: row ? Number(row.defaultRate) : 1200,
    maxOccupancy: row ? Number(row.maxOccupancy) : 2,
    description: row?.description ?? "",
    isActive: row?.isActive ?? true,
    shortStayBands: (row?.shortStayBands ?? []) as ShortStayBand[],
  });
  const [slugDirty, setSlugDirty] = useState(isEdit);
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        slug: form.slug,
        label: form.label,
        defaultRate: form.defaultRate,
        maxOccupancy: form.maxOccupancy,
        description: form.description || null,
        isActive: form.isActive,
        // Filter out blank/zero rows so an empty trailing input doesn't
        // get persisted as a useless band. The server clamps hours and
        // rates again with Zod.
        shortStayBands: form.shortStayBands.filter(
          (b) => b.label.trim() && b.hours > 0 && b.rate >= 0,
        ),
      };
      return isEdit
        ? api.put(`/settings/room-types/${row!.id}`, body)
        : api.post("/settings/room-types", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["room-types"] });
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-md w-full max-w-md p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-navy">
          {isEdit ? `Edit ${row!.label}` : "Add Room Type"}
        </h2>
        <Field label="Label (shown to staff)">
          <input
            className="input"
            value={form.label}
            onChange={(e) => {
              const label = e.target.value;
              setForm({
                ...form,
                label,
                slug: slugDirty ? form.slug : slugify(label),
              });
            }}
            placeholder="e.g. Penthouse Suite"
          />
        </Field>
        <Field label="Slug (internal ID, lowercase, _ allowed)">
          <input
            className="input font-mono"
            value={form.slug}
            onChange={(e) => {
              setSlugDirty(true);
              setForm({ ...form, slug: slugify(e.target.value) });
            }}
            placeholder="penthouse_suite"
          />
          {isEdit && form.slug !== row!.slug && (
            <div className="text-xs text-warning mt-1">
              Renaming the slug will update every room and reservation referencing "{row!.slug}".
            </div>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Default Rate (₹)">
            <input
              className="input"
              type="number"
              value={form.defaultRate}
              onChange={(e) => setForm({ ...form, defaultRate: Number(e.target.value) })}
            />
          </Field>
          <Field label="Max Occupancy">
            <input
              className="input"
              type="number"
              value={form.maxOccupancy}
              onChange={(e) => setForm({ ...form, maxOccupancy: Number(e.target.value) })}
            />
          </Field>
        </div>
        <Field label="Description (optional)">
          <input
            className="input"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
          />
          Active (available in new-room forms)
        </label>

        <div className="pt-3 border-t border-borderc/40">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-sm font-semibold text-navy">Day-use price bands</div>
              <div className="text-[11px] text-textSecondary">
                Hourly tiers shown when staff picks "Day use" on a booking. Leave
                empty to pro-rate from the nightly default rate.
              </div>
            </div>
            <button
              type="button"
              className="text-xs text-accentBlue hover:underline"
              onClick={() =>
                setForm({
                  ...form,
                  shortStayBands: [
                    ...form.shortStayBands,
                    { label: "", hours: 0, rate: 0 },
                  ],
                })
              }
            >
              + Add band
            </button>
          </div>
          {form.shortStayBands.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-textSecondary">
                  <th className="py-1 font-medium">Label</th>
                  <th className="py-1 font-medium w-20">Hours</th>
                  <th className="py-1 font-medium w-24">Rate (₹)</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {form.shortStayBands.map((b, i) => (
                  <tr key={i}>
                    <td className="py-1 pr-1">
                      <input
                        className="input !h-8 text-xs"
                        value={b.label}
                        placeholder="e.g. 6 hrs"
                        onChange={(e) => {
                          const next = [...form.shortStayBands];
                          next[i] = { ...next[i]!, label: e.target.value };
                          setForm({ ...form, shortStayBands: next });
                        }}
                      />
                    </td>
                    <td className="py-1 pr-1">
                      <input
                        className="input !h-8 text-xs"
                        type="number"
                        min={1}
                        max={23.5}
                        step={0.5}
                        value={b.hours || ""}
                        onChange={(e) => {
                          const next = [...form.shortStayBands];
                          next[i] = { ...next[i]!, hours: Number(e.target.value) };
                          setForm({ ...form, shortStayBands: next });
                        }}
                      />
                    </td>
                    <td className="py-1 pr-1">
                      <input
                        className="input !h-8 text-xs"
                        type="number"
                        min={0}
                        value={b.rate || ""}
                        onChange={(e) => {
                          const next = [...form.shortStayBands];
                          next[i] = { ...next[i]!, rate: Number(e.target.value) };
                          setForm({ ...form, shortStayBands: next });
                        }}
                      />
                    </td>
                    <td className="py-1 text-right">
                      <button
                        type="button"
                        className="text-danger text-xs hover:underline"
                        onClick={() =>
                          setForm({
                            ...form,
                            shortStayBands: form.shortStayBands.filter((_, j) => j !== i),
                          })
                        }
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {err && <div className="text-danger text-sm">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            onClick={() => save.mutate()}
            disabled={save.isPending || !form.label || !form.slug || form.defaultRate <= 0}
          >
            {save.isPending ? "Saving…" : isEdit ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface Staff {
  id: string;
  fullName: string;
  email: string;
  role: "admin" | "frontdesk" | "housekeeping";
  phone: string | null;
  isActive: boolean;
}

function StaffTab() {
  const qc = useQueryClient();
  const dialog = useDialog();
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Staff | null>(null);
  const { data = [] } = useQuery({
    queryKey: ["staff"],
    queryFn: () => api.get<Staff[]>("/staff"),
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => api.del(`/staff/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff"] }),
  });
  const reactivate = useMutation({
    mutationFn: (id: string) => api.put(`/staff/${id}`, { isActive: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff"] }),
  });
  const hardDelete = useMutation({
    mutationFn: (id: string) => api.del(`/staff/${id}/hard`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff"] }),
    onError: (e: Error) => toast(e.message, "error"),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn-primary inline-flex items-center gap-2" onClick={() => setShowAdd(true)}>
          <UserPlus className="w-4 h-4" /> Add Staff
        </button>
      </div>
      <div className="card p-0">
        <table className="table-base">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Phone</th>
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.map((s) => (
              <tr key={s.id} className={s.isActive ? "" : "opacity-60"}>
                <td>{s.fullName}</td>
                <td>{s.email}</td>
                <td className="capitalize">{s.role}</td>
                <td>{s.phone ?? "-"}</td>
                <td>{s.isActive ? "Active" : "Deactivated"}</td>
                <td className="text-right">
                  <div className="inline-flex items-center gap-3">
                    <button
                      className="text-brand hover:underline text-xs inline-flex items-center gap-1"
                      onClick={() => setEditing(s)}
                    >
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                    {s.isActive && (
                      <button
                        className="text-warning hover:underline text-xs inline-flex items-center gap-1"
                        onClick={async () => {
                          const ok = await dialog.confirm({
                            title: `Deactivate ${s.fullName}?`,
                            message: "They will lose access but their history is kept.",
                            okLabel: "Deactivate",
                            tone: "warning",
                          });
                          if (ok) deactivate.mutate(s.id);
                        }}
                      >
                        Deactivate
                      </button>
                    )}
                    {!s.isActive && (
                      <button
                        className="text-success hover:underline text-xs"
                        onClick={() => reactivate.mutate(s.id)}
                      >
                        Reactivate
                      </button>
                    )}
                    <button
                      className="text-danger hover:underline text-xs inline-flex items-center gap-1"
                      onClick={async () => {
                        const ans = await dialog.prompt({
                          title: `Permanently delete ${s.fullName}?`,
                          message:
                            "This removes them from auth and the database. Only works if they have no reservations, invoices, payments, or activity. Type DELETE to confirm.",
                          placeholder: "Type DELETE",
                          okLabel: "Delete forever",
                          tone: "danger",
                          required: true,
                        });
                        if (ans === "DELETE") hardDelete.mutate(s.id);
                      }}
                    >
                      <Trash2 className="w-3 h-3" /> Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showAdd && <AddStaffModal onClose={() => setShowAdd(false)} />}
      {editing && <EditStaffModal staff={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EditStaffModal({ staff, onClose }: { staff: Staff; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    fullName: staff.fullName,
    email: staff.email,
    phone: staff.phone ?? "",
  });
  const [newPassword, setNewPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const { data: rbacRoles } = useQuery({
    queryKey: ["rbac-roles"],
    queryFn: () => api.get<RbacRole[]>("/rbac/roles"),
  });
  const { data: catalog } = useQuery({
    queryKey: ["rbac-catalog"],
    queryFn: () => api.get<PermissionDef[]>("/rbac/permissions"),
  });
  const { data: effective } = useQuery({
    queryKey: ["rbac-effective", staff.id],
    queryFn: () =>
      api.get<{ roleKey: string | null; isGodMode: boolean; permissions: string[] }>(
        `/rbac/users/${staff.id}/effective`,
      ),
  });
  const { data: existingOverrides } = useQuery({
    queryKey: ["rbac-overrides", staff.id],
    queryFn: () =>
      api.get<{ permissionKey: string; effect: "grant" | "deny" }[]>(
        `/rbac/users/${staff.id}/overrides`,
      ),
  });

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, "grant" | "deny">>({});
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Initialise selectedRoleId once rbacRoles + effective have loaded
  useEffect(() => {
    if (selectedRoleId || !rbacRoles || !effective) return;
    const cur = rbacRoles.find((r) => r.key === effective.roleKey);
    setSelectedRoleId(cur?.id ?? null);
  }, [rbacRoles, effective, selectedRoleId]);

  // Initialise overrides from server once
  useEffect(() => {
    if (!existingOverrides) return;
    const map: Record<string, "grant" | "deny"> = {};
    for (const o of existingOverrides) map[o.permissionKey] = o.effect;
    setOverrides(map);
  }, [existingOverrides]);

  const save = useMutation({
    mutationFn: async () => {
      // 1. Profile patch (name/email/phone/password)
      const patch: Record<string, unknown> = {};
      if (form.fullName !== staff.fullName) patch.fullName = form.fullName;
      if (form.email !== staff.email) patch.email = form.email;
      const newPhone = form.phone || null;
      if (newPhone !== (staff.phone ?? null)) patch.phone = newPhone;
      if (newPassword) patch.password = newPassword;
      if (Object.keys(patch).length > 0) {
        await api.put(`/staff/${staff.id}`, patch);
      }

      // 2. RBAC role
      if (selectedRoleId && selectedRoleId !== rbacRoles?.find((r) => r.key === effective?.roleKey)?.id) {
        await api.put(`/rbac/users/${staff.id}/role`, { roleId: selectedRoleId });
      }

      // 3. Overrides
      const arr = Object.entries(overrides).map(([permissionKey, effect]) => ({
        permissionKey,
        effect,
      }));
      await api.put(`/rbac/users/${staff.id}/overrides`, { overrides: arr });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      qc.invalidateQueries({ queryKey: ["rbac-effective", staff.id] });
      qc.invalidateQueries({ queryKey: ["rbac-overrides", staff.id] });
      setMsg("Saved");
      setTimeout(onClose, 700);
    },
    onError: (e: Error) => setErr(e.message),
  });

  function genStrong() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let out = "";
    const arr = new Uint32Array(14);
    crypto.getRandomValues(arr);
    for (const n of arr) out += chars[n % chars.length];
    setNewPassword(out + "!");
    setShowPw(true);
  }

  const selectedRole = rbacRoles?.find((r) => r.id === selectedRoleId) ?? null;
  const baseRolePerms = new Set(
    selectedRole?.permissions.includes("*")
      ? (catalog ?? []).map((c) => c.key)
      : selectedRole?.permissions ?? [],
  );
  const effectivePerms = (() => {
    const set = new Set(baseRolePerms);
    for (const [k, eff] of Object.entries(overrides)) {
      if (eff === "grant") set.add(k);
      else if (eff === "deny") set.delete(k);
    }
    return set;
  })();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-surface rounded-md w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-borderc">
          <h2 className="text-lg font-semibold text-brand-dark">Edit Staff · {staff.fullName}</h2>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Full Name">
            <input
              className="input"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            />
          </Field>
          <Field label="Email">
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Phone (optional)">
            <input
              className="input"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </Field>
          <Field label="Role">
            <select
              className="input"
              value={selectedRoleId ?? ""}
              onChange={(e) => setSelectedRoleId(e.target.value || null)}
            >
              <option value="">— Pick a role —</option>
              {(rbacRoles ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                  {r.isSystem ? " · system" : " · custom"}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {selectedRole && (
          <div className="bg-bg/50 border border-borderc rounded-sm px-3 py-2 text-xs text-textSecondary">
            <span className="font-semibold text-brand-dark">{selectedRole.label}</span> grants{" "}
            {selectedRole.permissions.includes("*") ? (
              <span className="font-semibold text-success">all permissions (god mode)</span>
            ) : (
              <span>{selectedRole.permissions.length} permissions</span>
            )}
            . Effective for this user: <span className="font-mono">{effectivePerms.size}</span>
            {Object.keys(overrides).length > 0 && (
              <span> · {Object.keys(overrides).length} override(s)</span>
            )}
          </div>
        )}

        {selectedRole && !selectedRole.permissions.includes("*") && catalog && (
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((s) => !s)}
              className="text-xs font-semibold text-brand hover:underline"
            >
              {showAdvanced ? "Hide" : "Show"} advanced permission overrides
            </button>
            {showAdvanced && (
              <div className="mt-3 border border-borderc rounded-sm p-3 space-y-3">
                <p className="text-xs text-textSecondary">
                  Three-state for each permission: <strong>Inherit</strong> (use role default),{" "}
                  <strong className="text-success">Grant</strong> (force allow), or{" "}
                  <strong className="text-danger">Deny</strong> (force block). Deny wins.
                </p>
                {Object.entries(groupByArea(catalog)).map(([area, defs]) => (
                  <div key={area}>
                    <div className="text-xs font-bold text-brand-dark mb-1.5">{area}</div>
                    <div className="space-y-1">
                      {defs.map((d) => {
                        const ovr = overrides[d.key];
                        const inRole = baseRolePerms.has(d.key);
                        return (
                          <div
                            key={d.key}
                            className="flex items-center justify-between gap-2 text-sm py-1"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-textPrimary truncate">{d.label}</div>
                              <div className="text-[11px] text-textSecondary font-mono">
                                {d.key} · role:{" "}
                                {inRole ? (
                                  <span className="text-success">allowed</span>
                                ) : (
                                  <span className="text-textSecondary">not in role</span>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-1 shrink-0">
                              {(["inherit", "grant", "deny"] as const).map((opt) => {
                                const active = (ovr ?? "inherit") === opt;
                                const cls =
                                  opt === "grant"
                                    ? active
                                      ? "bg-success text-white border-success"
                                      : "border-borderc text-success hover:border-success"
                                    : opt === "deny"
                                      ? active
                                        ? "bg-danger text-white border-danger"
                                        : "border-borderc text-danger hover:border-danger"
                                      : active
                                        ? "bg-brand-dark text-cream border-brand-dark"
                                        : "border-borderc text-textSecondary hover:border-brand-dark";
                                return (
                                  <button
                                    key={opt}
                                    type="button"
                                    onClick={() =>
                                      setOverrides((o) => {
                                        const next = { ...o };
                                        if (opt === "inherit") delete next[d.key];
                                        else next[d.key] = opt;
                                        return next;
                                      })
                                    }
                                    className={`px-2 h-6 text-[10px] font-semibold rounded-sm border transition-colors capitalize ${cls}`}
                                  >
                                    {opt}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="border-t border-borderc pt-3 mt-2">
          <div className="text-xs uppercase tracking-wide text-textSecondary mb-2">Reset password</div>
          <div className="relative">
            <input
              className="input pr-20 font-mono"
              type={showPw ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Leave blank to keep current"
              minLength={8}
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPw(!showPw)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-textSecondary hover:text-brand"
            >
              {showPw ? "Hide" : "Show"}
            </button>
          </div>
          <div className="flex justify-between items-center mt-1">
            <button type="button" onClick={genStrong} className="text-xs text-brand hover:underline">
              Generate strong password
            </button>
            {newPassword && newPassword.length < 8 && (
              <span className="text-xs text-danger">Min 8 characters</span>
            )}
          </div>
        </div>

        {err && <div className="text-danger text-sm">{err}</div>}
        {msg && <div className="text-success text-sm">{msg}</div>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-borderc bg-bg/50">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            onClick={() => save.mutate()}
            disabled={save.isPending || (newPassword.length > 0 && newPassword.length < 8)}
          >
            {save.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddStaffModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    email: "",
    password: "",
    fullName: "",
    role: "frontdesk" as "admin" | "frontdesk" | "housekeeping",
    phone: "",
  });
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => api.post("/staff", { ...form, phone: form.phone || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-md w-full max-w-md p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-navy">Add Staff</h2>
        <Field label="Full Name">
          <input
            className="input"
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
        </Field>
        <Field label="Email">
          <input
            className="input"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>
        <Field label="Password">
          <input
            className="input"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>
        <Field label="Role">
          <select
            className="input"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as typeof form.role })}
          >
            <option value="frontdesk">Front Desk</option>
            <option value="housekeeping">Housekeeping</option>
            <option value="admin">Admin</option>
          </select>
        </Field>
        <Field label="Phone (optional)">
          <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        {err && <div className="text-danger text-sm">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            onClick={() => save.mutate()}
            disabled={save.isPending || !form.email || !form.password || !form.fullName}
          >
            {save.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label block mb-1">{label}</label>
      {children}
    </div>
  );
}

// ============================================================
// Roles & Permissions tab
// ============================================================

interface PermissionDef {
  key: string;
  area: string;
  label: string;
  description?: string;
}

interface RbacRole {
  id: string;
  key: string;
  label: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
}

function RolesTab() {
  const qc = useQueryClient();
  const dialog = useDialog();
  const { toast } = useToast();
  const [editing, setEditing] = useState<RbacRole | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: rolesData } = useQuery({
    queryKey: ["rbac-roles"],
    queryFn: () => api.get<RbacRole[]>("/rbac/roles"),
  });
  const { data: catalog } = useQuery({
    queryKey: ["rbac-catalog"],
    queryFn: () => api.get<PermissionDef[]>("/rbac/permissions"),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/rbac/roles/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rbac-roles"] });
      toast("Role deleted", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  if (!rolesData || !catalog) return <Loader />;

  const grouped = groupByArea(catalog);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-textSecondary">
            Roles bundle permissions. System roles can be edited (except <em>admin</em>).
            Custom roles can be deleted when no users hold them.
          </p>
        </div>
        <button
          className="btn-primary inline-flex items-center gap-2"
          onClick={() => setCreating(true)}
        >
          <Plus className="w-4 h-4" /> New Role
        </button>
      </div>

      <div className="card p-0">
        <table className="table-base">
          <thead>
            <tr>
              <th>Role</th>
              <th>Type</th>
              <th>Permissions</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rolesData.map((r) => {
              const isAdmin = r.key === "admin";
              const permCount = r.permissions.includes("*") ? "All (god mode)" : `${r.permissions.length}`;
              return (
                <tr key={r.id}>
                  <td>
                    <div className="font-semibold text-brand-dark">{r.label}</div>
                    <div className="text-xs text-textSecondary font-mono">{r.key}</div>
                    {r.description && (
                      <div className="text-xs text-textSecondary mt-0.5">{r.description}</div>
                    )}
                  </td>
                  <td className="text-xs">
                    {r.isSystem ? (
                      <span className="px-1.5 py-0.5 rounded-sm bg-brand-soft text-brand-dark font-semibold">
                        System
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded-sm bg-bg text-textSecondary border border-borderc">
                        Custom
                      </span>
                    )}
                  </td>
                  <td className="text-sm font-mono">{permCount}</td>
                  <td className="text-right">
                    <div className="inline-flex gap-2">
                      {!isAdmin && (
                        <button
                          className="text-brand text-xs hover:underline inline-flex items-center gap-1"
                          onClick={() => setEditing(r)}
                        >
                          <Pencil className="w-3 h-3" /> Edit
                        </button>
                      )}
                      {!r.isSystem && (
                        <button
                          className="text-danger text-xs hover:underline inline-flex items-center gap-1"
                          onClick={async () => {
                            const ok = await dialog.confirm({
                              title: `Delete role "${r.label}"?`,
                              message:
                                "This cannot be undone. Users currently in this role must be reassigned first.",
                              okLabel: "Delete role",
                              tone: "danger",
                            });
                            if (ok) del.mutate(r.id);
                          }}
                        >
                          <Trash2 className="w-3 h-3" /> Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {creating && <RoleEditor catalog={grouped} onClose={() => setCreating(false)} />}
      {editing && (
        <RoleEditor catalog={grouped} role={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function groupByArea(catalog: PermissionDef[]): Record<string, PermissionDef[]> {
  const out: Record<string, PermissionDef[]> = {};
  for (const p of catalog) {
    if (!out[p.area]) out[p.area] = [];
    out[p.area]!.push(p);
  }
  return out;
}

function RoleEditor({
  role,
  catalog,
  onClose,
}: {
  role?: RbacRole;
  catalog: Record<string, PermissionDef[]>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [key, setKey] = useState(role?.key ?? "");
  const [label, setLabel] = useState(role?.label ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [perms, setPerms] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [err, setErr] = useState<string | null>(null);

  function toggle(k: string) {
    setPerms((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function toggleArea(area: string, on: boolean) {
    const keys = (catalog[area] ?? []).map((p) => p.key);
    setPerms((s) => {
      const next = new Set(s);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  }

  const save = useMutation({
    mutationFn: () => {
      const body = {
        key,
        label,
        description: description || null,
        permissions: Array.from(perms),
      };
      if (role) {
        const { key: _k, ...rest } = body;
        return api.patch(`/rbac/roles/${role.id}`, rest);
      }
      return api.post(`/rbac/roles`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rbac-roles"] });
      toast(role ? "Role updated" : "Role created", "success");
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div
      className="fixed inset-0 z-[150] grid place-items-center bg-brand-dark/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-3xl bg-surface rounded-md shadow-xl border border-borderc max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-borderc">
          <div className="font-semibold text-textPrimary">
            {role ? `Edit role · ${role.label}` : "Create role"}
          </div>
          <button onClick={onClose} className="text-textSecondary hover:text-textPrimary text-lg">
            ×
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Role key (lowercase, _)">
              <input
                className="input font-mono disabled:bg-bg/50 disabled:text-textSecondary"
                value={key}
                disabled={!!role}
                placeholder="e.g. front_desk_lead"
                onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
              />
            </Field>
            <Field label="Display label">
              <input
                className="input"
                value={label}
                placeholder="e.g. Front Desk Lead"
                onChange={(e) => setLabel(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Description">
            <input
              className="input"
              value={description}
              placeholder="What this role is for"
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>

          <div>
            <div className="label mb-2">Permissions ({perms.size})</div>
            <div className="space-y-3">
              {Object.entries(catalog).map(([area, defs]) => {
                const all = defs.every((d) => perms.has(d.key));
                const some = defs.some((d) => perms.has(d.key));
                return (
                  <div key={area} className="border border-borderc rounded-sm p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-bold text-brand-dark">{area}</div>
                      <button
                        type="button"
                        className="text-xs font-semibold text-brand hover:underline"
                        onClick={() => toggleArea(area, !all)}
                      >
                        {all ? "Clear all" : some ? "Select all" : "Select all"}
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {defs.map((d) => {
                        const on = perms.has(d.key);
                        return (
                          <label
                            key={d.key}
                            className={`flex items-start gap-2 px-2 py-1.5 rounded-sm cursor-pointer text-sm transition-colors ${
                              on ? "bg-brand-soft" : "hover:bg-bg"
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={on}
                              onChange={() => toggle(d.key)}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-textPrimary">{d.label}</div>
                              <div className="text-[11px] text-textSecondary font-mono truncate">
                                {d.key}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {err && <div className="text-danger text-sm">{err}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-borderc bg-bg/50">
          <button
            onClick={onClose}
            className="px-4 h-9 text-sm font-semibold rounded-sm border-2 border-borderc text-textSecondary hover:border-textSecondary hover:text-textPrimary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || !key.trim() || !label.trim()}
            className="px-4 h-9 text-sm font-semibold rounded-sm bg-brand-dark text-cream border-2 border-brand-dark hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {save.isPending ? "Saving…" : role ? "Save changes" : "Create role"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Audit Log tab — admin-only CSV export of activity_log
// ============================================================

function AuditTab() {
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = `${today.slice(0, 8)}01`;
  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(today);
  const [limit, setLimit] = useState(10000);
  const [downloading, setDownloading] = useState(false);

  async function download() {
    if (!dateFrom || !dateTo) {
      toast("Pick a date range", "error");
      return;
    }
    if (dateFrom > dateTo) {
      toast("From date must be on or before To date", "error");
      return;
    }
    setDownloading(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Not signed in");
      const base = (import.meta.env.VITE_API_URL as string).replace(/\/+$/, "");
      const url = new URL(`${base}/audit/activity.csv`);
      url.searchParams.set("date_from", dateFrom);
      url.searchParams.set("date_to", dateTo);
      url.searchParams.set("limit", String(limit));
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Download failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = `activity_${dateFrom.replace(/-/g, "")}_${dateTo.replace(/-/g, "")}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
      toast("Audit log downloaded", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Download failed", "error");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="card space-y-4">
      <div>
        <h3 className="font-semibold text-brand-dark">Export activity log</h3>
        <p className="text-xs text-textSecondary mt-1">
          Downloads every staff action — logins, check-ins, payments, voids, settings changes — as
          CSV for the chosen range. Use this for periodic compliance reviews.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="From">
          <input
            className="input"
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </Field>
        <Field label="To">
          <input
            className="input"
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            max={today}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </Field>
        <Field label="Row limit (max 50,000)">
          <input
            className="input"
            type="number"
            min={1}
            max={50000}
            step={1000}
            value={limit}
            onChange={(e) => setLimit(Math.max(1, Math.min(50000, Number(e.target.value) || 0)))}
          />
        </Field>
      </div>
      <div className="flex justify-end">
        <button
          className="btn-primary inline-flex items-center gap-2"
          onClick={download}
          disabled={downloading}
        >
          <Download className="w-4 h-4" />
          {downloading ? "Downloading…" : "Download CSV"}
        </button>
      </div>
      <div className="text-[11px] text-textSecondary border-t border-borderc pt-3">
        Note: each export is itself recorded in the audit log under the action{" "}
        <code className="font-mono">audit_export</code>.
      </div>
    </div>
  );
}
