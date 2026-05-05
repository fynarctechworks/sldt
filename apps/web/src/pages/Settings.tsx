import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, UserPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Loader } from "@/components/Loader";
import { api } from "@/lib/api";
import { inr } from "@/lib/utils";

type Tab = "hotel" | "documents" | "messages" | "room-types" | "staff";

const TABS: { id: Tab; label: string }[] = [
  { id: "hotel", label: "Hotel Profile" },
  { id: "documents", label: "Invoice & Receipt" },
  { id: "messages", label: "Messages" },
  { id: "room-types", label: "Room Types" },
  { id: "staff", label: "Staff" },
];

export default function Settings() {
  const [tab, setTab] = useState<Tab>("hotel");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-navy">Settings</h1>
      <div className="flex gap-1 flex-wrap border-b border-borderc">
        {TABS.map((t) => (
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
      {tab === "documents" && <DocumentsTab />}
      {tab === "messages" && <MessagesTab />}
      {tab === "room-types" && <RoomTypesTab />}
      {tab === "staff" && <StaffTab />}
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

      <div className="flex justify-end gap-2 items-center">
        {msg && <span className="text-xs text-success">{msg}</span>}
        <button className="btn-primary" onClick={() => save.mutate(form)} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

interface DocSettings {
  hotelName: string;
  hotelAddress: string;
  hotelGstin: string;
  hotelLogoUrl: string | null;
  currencySymbol: string;
  docPrimaryColor: string;
  docAccentColor: string;
  docInvoiceTitle: string;
  docReceiptTitle: string;
  docFooterText: string;
  docTermsText: string | null;
  docSignatoryLabel: string;
  docInvoicePageSize: "A4" | "A5" | "Letter";
  docReceiptPageSize: "A4" | "A5" | "A6" | "Letter";
  docShowLogo: boolean;
  docShowGstin: boolean;
  docShowTerms: boolean;
  docShowSignature: boolean;
}

const DOC_DEFAULTS: DocSettings = {
  hotelName: "",
  hotelAddress: "",
  hotelGstin: "",
  hotelLogoUrl: null,
  currencySymbol: "₹",
  docPrimaryColor: "#0F3D2E",
  docAccentColor: "#B08A4A",
  docInvoiceTitle: "Tax Invoice",
  docReceiptTitle: "Payment Receipt",
  docFooterText: "Thank you for staying with us.",
  docTermsText: "",
  docSignatoryLabel: "Authorised Signatory",
  docInvoicePageSize: "A4",
  docReceiptPageSize: "A5",
  docShowLogo: true,
  docShowGstin: true,
  docShowTerms: false,
  docShowSignature: true,
};

function DocumentsTab() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<{ settings: DocSettings | null }>("/settings"),
  });
  const [form, setForm] = useState<DocSettings | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState<"invoice" | "receipt">("invoice");

  useEffect(() => {
    if (data?.settings && !form) {
      setForm({ ...DOC_DEFAULTS, ...data.settings });
    }
  }, [data, form]);

  const save = useMutation({
    mutationFn: (f: DocSettings) =>
      api.put("/settings", {
        docPrimaryColor: f.docPrimaryColor,
        docAccentColor: f.docAccentColor,
        docInvoiceTitle: f.docInvoiceTitle,
        docReceiptTitle: f.docReceiptTitle,
        docFooterText: f.docFooterText,
        docTermsText: f.docTermsText && f.docTermsText.trim() !== "" ? f.docTermsText : null,
        docSignatoryLabel: f.docSignatoryLabel,
        docInvoicePageSize: f.docInvoicePageSize,
        docReceiptPageSize: f.docReceiptPageSize,
        docShowLogo: f.docShowLogo,
        docShowGstin: f.docShowGstin,
        docShowTerms: f.docShowTerms,
        docShowSignature: f.docShowSignature,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      setMsg("Saved");
      setTimeout(() => setMsg(null), 2000);
    },
    onError: (e: Error) => setMsg(e.message),
  });

  if (!form) return <Loader />;

  const set = <K extends keyof DocSettings>(k: K, v: DocSettings[K]) => setForm({ ...form, [k]: v });

  return (
    <div className="grid lg:grid-cols-[1fr_1.2fr] gap-4 items-start">
      <div className="card space-y-4">
        <section className="space-y-3">
          <h3 className="font-semibold text-brand-dark">Branding</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Primary color">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="h-10 w-12 border border-borderc rounded-sm"
                  value={form.docPrimaryColor}
                  onChange={(e) => set("docPrimaryColor", e.target.value)}
                />
                <input
                  className="input font-mono uppercase"
                  value={form.docPrimaryColor}
                  onChange={(e) => set("docPrimaryColor", e.target.value)}
                  maxLength={7}
                />
              </div>
            </Field>
            <Field label="Accent color">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="h-10 w-12 border border-borderc rounded-sm"
                  value={form.docAccentColor}
                  onChange={(e) => set("docAccentColor", e.target.value)}
                />
                <input
                  className="input font-mono uppercase"
                  value={form.docAccentColor}
                  onChange={(e) => set("docAccentColor", e.target.value)}
                  maxLength={7}
                />
              </div>
            </Field>
          </div>
          <Field label="Logo URL (leave blank to hide)">
            <input
              className="input"
              placeholder="https://..."
              value={form.hotelLogoUrl ?? ""}
              onChange={(e) => set("hotelLogoUrl", e.target.value || null)}
              disabled
              title="Set the logo URL from Hotel Profile"
            />
          </Field>
        </section>

        <section className="space-y-3">
          <h3 className="font-semibold text-brand-dark">Titles</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Invoice title">
              <input className="input" value={form.docInvoiceTitle} onChange={(e) => set("docInvoiceTitle", e.target.value)} />
            </Field>
            <Field label="Receipt title">
              <input className="input" value={form.docReceiptTitle} onChange={(e) => set("docReceiptTitle", e.target.value)} />
            </Field>
            <Field label="Invoice page size">
              <select
                className="input"
                value={form.docInvoicePageSize}
                onChange={(e) => set("docInvoicePageSize", e.target.value as DocSettings["docInvoicePageSize"])}
              >
                <option>A4</option>
                <option>A5</option>
                <option>Letter</option>
              </select>
            </Field>
            <Field label="Receipt page size">
              <select
                className="input"
                value={form.docReceiptPageSize}
                onChange={(e) => set("docReceiptPageSize", e.target.value as DocSettings["docReceiptPageSize"])}
              >
                <option>A4</option>
                <option>A5</option>
                <option>A6</option>
                <option>Letter</option>
              </select>
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="font-semibold text-brand-dark">Footer &amp; Signature</h3>
          <Field label="Footer text">
            <input className="input" value={form.docFooterText} onChange={(e) => set("docFooterText", e.target.value)} />
          </Field>
          <Field label="Signatory label">
            <input className="input" value={form.docSignatoryLabel} onChange={(e) => set("docSignatoryLabel", e.target.value)} />
          </Field>
          <Field label="Terms &amp; conditions (shown when enabled)">
            <textarea
              className="input min-h-[88px]"
              value={form.docTermsText ?? ""}
              onChange={(e) => set("docTermsText", e.target.value)}
              placeholder="e.g. Check-in 12:00, check-out 11:00. GST as applicable…"
            />
          </Field>
        </section>

        <section className="space-y-2">
          <h3 className="font-semibold text-brand-dark">Toggles</h3>
          <div className="grid grid-cols-2 gap-2">
            <Toggle label="Show logo" value={form.docShowLogo} onChange={(v) => set("docShowLogo", v)} />
            <Toggle label="Show GSTIN" value={form.docShowGstin} onChange={(v) => set("docShowGstin", v)} />
            <Toggle label="Show signature line" value={form.docShowSignature} onChange={(v) => set("docShowSignature", v)} />
            <Toggle label="Show terms block" value={form.docShowTerms} onChange={(v) => set("docShowTerms", v)} />
          </div>
        </section>

        <div className="flex justify-end gap-2 items-center pt-2 border-t border-borderc">
          {msg && <span className="text-xs text-success">{msg}</span>}
          <button className="btn-primary" onClick={() => save.mutate(form)} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-brand-dark">Live Preview</h3>
          <div className="inline-flex rounded-sm border border-borderc overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setPreviewKind("invoice")}
              className={`px-3 py-1.5 ${previewKind === "invoice" ? "bg-brand text-cream" : "bg-bg text-textSecondary"}`}
            >
              Invoice
            </button>
            <button
              type="button"
              onClick={() => setPreviewKind("receipt")}
              className={`px-3 py-1.5 ${previewKind === "receipt" ? "bg-brand text-cream" : "bg-bg text-textSecondary"}`}
            >
              Receipt
            </button>
          </div>
        </div>
        <DocPreview kind={previewKind} doc={form} />
      </div>
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 px-3 py-2 border border-borderc rounded-sm bg-surface cursor-pointer hover:bg-bg select-none">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 accent-brand"
      />
      <span className="text-sm">{label}</span>
    </label>
  );
}

function DocPreview({ kind, doc }: { kind: "invoice" | "receipt"; doc: DocSettings }) {
  const isInvoice = kind === "invoice";
  const title = isInvoice ? doc.docInvoiceTitle : doc.docReceiptTitle;
  const number = isInvoice ? "INV-202605-0042" : "RCP-202605-0078";
  const date = "03 May 2026";
  const grandTotal = "8,260.00";
  const paid = "5,000.00";
  const balance = "3,260.00";
  return (
    <div className="border border-borderc rounded-md bg-white shadow-sm overflow-hidden">
      <div className="p-6 text-[12px] text-[#1a1a1a] font-sans" style={{ fontFamily: "system-ui" }}>
        <div className="flex justify-between items-start gap-4 pb-3 border-b-2" style={{ borderColor: doc.docPrimaryColor }}>
          <div className="flex gap-3 items-start max-w-[60%]">
            {doc.docShowLogo && doc.hotelLogoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={doc.hotelLogoUrl} alt="logo" className="w-14 h-14 object-contain rounded border border-borderc p-0.5" />
            )}
            <div>
              <div className="text-[20px] font-bold leading-tight" style={{ color: doc.docPrimaryColor }}>
                {doc.hotelName || "Your Hotel Name"}
              </div>
              <div className="text-[#444] mt-1">{doc.hotelAddress || "Hotel address line"}</div>
              {doc.docShowGstin && doc.hotelGstin && (
                <div className="font-mono text-[11px] text-[#555] mt-0.5">GSTIN: {doc.hotelGstin}</div>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-widest font-bold" style={{ color: doc.docAccentColor }}>
              {title}
            </div>
            <div className="text-[14px] font-bold font-mono" style={{ color: doc.docPrimaryColor }}>
              {number}
            </div>
            <div className="mt-1 text-[#666]">Date: {date}</div>
          </div>
        </div>

        <div className="my-4 p-3 bg-[#FAF7F0] border border-[#EDE7D6] rounded-sm flex justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[#666]">{isInvoice ? "Billed To" : "Received From"}</div>
            <div className="font-semibold mt-0.5">Sample Guest</div>
            <div className="font-mono text-[#444]">+91 90000 00000</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-[#666]">Reservation</div>
            <div className="font-mono font-semibold mt-0.5">RES-202605-0119</div>
          </div>
        </div>

        {isInvoice ? (
          <>
            <div className="text-[11px] uppercase tracking-wide font-semibold mt-3 mb-1" style={{ color: doc.docPrimaryColor }}>
              Line Items
            </div>
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-[#F5F2EA]" style={{ color: doc.docPrimaryColor }}>
                  <th className="text-left p-1.5 border-b" style={{ borderColor: doc.docPrimaryColor }}>Description</th>
                  <th className="text-left p-1.5 border-b" style={{ borderColor: doc.docPrimaryColor }}>SAC</th>
                  <th className="text-right p-1.5 border-b" style={{ borderColor: doc.docPrimaryColor }}>Qty</th>
                  <th className="text-right p-1.5 border-b" style={{ borderColor: doc.docPrimaryColor }}>Rate</th>
                  <th className="text-right p-1.5 border-b" style={{ borderColor: doc.docPrimaryColor }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="p-1.5 border-b border-borderc">Room 101 (2 nights)</td>
                  <td className="p-1.5 border-b border-borderc font-mono">996311</td>
                  <td className="p-1.5 border-b border-borderc text-right">2</td>
                  <td className="p-1.5 border-b border-borderc text-right font-mono">{doc.currencySymbol}3,500.00</td>
                  <td className="p-1.5 border-b border-borderc text-right font-mono">{doc.currencySymbol}7,000.00</td>
                </tr>
              </tbody>
            </table>
            <table className="ml-auto w-1/2 mt-3 text-[11px]">
              <tbody>
                <tr><td className="p-1">Subtotal</td><td className="p-1 text-right font-mono">{doc.currencySymbol}7,000.00</td></tr>
                <tr><td className="p-1">CGST @ 9%</td><td className="p-1 text-right font-mono">{doc.currencySymbol}630.00</td></tr>
                <tr><td className="p-1">SGST @ 9%</td><td className="p-1 text-right font-mono">{doc.currencySymbol}630.00</td></tr>
                <tr style={{ borderTop: `2px solid ${doc.docPrimaryColor}` }}>
                  <td className="p-1 pt-2 font-bold text-[13px]" style={{ color: doc.docPrimaryColor }}>Grand Total</td>
                  <td className="p-1 pt-2 text-right font-mono font-bold text-[13px]" style={{ color: doc.docPrimaryColor }}>
                    {doc.currencySymbol}{grandTotal}
                  </td>
                </tr>
                <tr><td className="p-1">Total Paid</td><td className="p-1 text-right font-mono">{doc.currencySymbol}{paid}</td></tr>
                <tr><td className="p-1 font-semibold">Balance Due</td><td className="p-1 text-right font-mono font-bold text-[#B23A2E]">{doc.currencySymbol}{balance}</td></tr>
              </tbody>
            </table>
          </>
        ) : (
          <div className="my-4 p-4 rounded-md text-white text-center" style={{ background: doc.docPrimaryColor }}>
            <div className="text-[10px] uppercase tracking-widest opacity-80">Amount Received</div>
            <div className="text-[28px] font-bold font-mono mt-1">{doc.currencySymbol}{paid}</div>
            <div className="text-[11px] mt-1 capitalize opacity-90">via cash</div>
          </div>
        )}

        {doc.docShowTerms && doc.docTermsText && (
          <div
            className="mt-4 p-2.5 text-[11px] text-[#5D4037] whitespace-pre-wrap rounded-sm"
            style={{ background: "#FFFBF1", borderLeft: `3px solid ${doc.docAccentColor}` }}
          >
            {doc.docTermsText}
          </div>
        )}

        <div className="mt-6 pt-3 border-t border-borderc flex justify-between gap-4 text-[10px] text-[#666]">
          <div>{doc.docFooterText}</div>
          {doc.docShowSignature && (
            <div className="text-right">
              <div className="mt-7 inline-block min-w-[160px] pt-1 border-t border-[#999]">{doc.docSignatoryLabel}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface TemplateRow {
  key: string;
  group: string;
  label: string;
  channel: "sms" | "email";
  recipient: "guest" | "owner";
  subject: string | null;
  body: string;
  enabled: boolean;
  defaults: { subject?: string; body: string };
  availableVars: string[];
}

function MessagesTab() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["templates"],
    queryFn: () => api.get<{ items: TemplateRow[] }>("/settings/templates"),
  });

  if (!data) return <Loader />;
  // Email channel is disabled in this deployment — show SMS templates only.
  const smsOnly = data.items.filter((t) => t.channel === "sms");
  const groups = new Map<string, TemplateRow[]>();
  for (const t of smsOnly) {
    if (!groups.has(t.group)) groups.set(t.group, []);
    groups.get(t.group)!.push(t);
  }

  return (
    <div className="space-y-5">
      <div className="card text-sm text-textSecondary">
        Edit the SMS templates sent to guests and the owner via Twilio. Use{" "}
        <code className="bg-bg px-1 rounded font-mono text-xs">{"{variable}"}</code> placeholders —
        click an available variable to insert it. Disable a template to stop sending it without
        deleting the wording.
      </div>
      {Array.from(groups.entries()).map(([groupName, items]) => (
        <section key={groupName} className="space-y-3">
          <h3 className="font-semibold text-brand-dark text-base">{groupName}</h3>
          <div className="space-y-3">
            {items.map((t) => (
              <TemplateCard
                key={t.key}
                row={t}
                onSaved={() => qc.invalidateQueries({ queryKey: ["templates"] })}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function TemplateCard({ row, onSaved }: { row: TemplateRow; onSaved: () => void }) {
  const [subject, setSubject] = useState(row.subject ?? "");
  const [body, setBody] = useState(row.body);
  const [enabled, setEnabled] = useState(row.enabled);
  const [msg, setMsg] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const lastFocused = useRef<"body" | "subject">("body");

  const save = useMutation({
    mutationFn: () =>
      api.put(`/settings/templates/${row.key}`, {
        subject: row.channel === "email" ? (subject.trim() === "" ? null : subject) : null,
        body,
        enabled,
      }),
    onSuccess: () => {
      setMsg("Saved");
      setTimeout(() => setMsg(null), 1500);
      onSaved();
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const reset = useMutation({
    mutationFn: () => api.post(`/settings/templates/${row.key}/reset`),
    onSuccess: () => {
      setSubject(row.defaults.subject ?? "");
      setBody(row.defaults.body);
      setEnabled(true);
      setMsg("Reset to default");
      setTimeout(() => setMsg(null), 1500);
      onSaved();
    },
  });

  function insertVar(name: string) {
    const tag = `{${name}}`;
    if (lastFocused.current === "subject" && subjectRef.current) {
      const el = subjectRef.current;
      const start = el.selectionStart ?? subject.length;
      const end = el.selectionEnd ?? subject.length;
      const next = subject.slice(0, start) + tag + subject.slice(end);
      setSubject(next);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + tag.length, start + tag.length);
      }, 0);
    } else if (bodyRef.current) {
      const el = bodyRef.current;
      const start = el.selectionStart ?? body.length;
      const end = el.selectionEnd ?? body.length;
      const next = body.slice(0, start) + tag + body.slice(end);
      setBody(next);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + tag.length, start + tag.length);
      }, 0);
    }
  }

  const dirty = subject !== (row.subject ?? "") || body !== row.body || enabled !== row.enabled;

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-textPrimary">{row.label}</span>
          <span
            className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold ${
              row.channel === "sms" ? "bg-brand/10 text-brand" : "bg-accentBlue/10 text-accentBlue"
            }`}
          >
            {row.channel}
          </span>
          {!enabled && (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold bg-warning/15 text-warning">
              Disabled
            </span>
          )}
        </div>
        <label className="flex items-center gap-2 text-xs text-textSecondary cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="w-3.5 h-3.5 accent-brand"
          />
          Enabled
        </label>
      </div>

      {row.channel === "email" && (
        <Field label="Subject">
          <input
            ref={subjectRef}
            className="input"
            value={subject}
            onFocus={() => (lastFocused.current = "subject")}
            onChange={(e) => setSubject(e.target.value)}
          />
        </Field>
      )}

      <Field label={row.channel === "email" ? "Body" : "Message"}>
        <textarea
          ref={bodyRef}
          className="input min-h-[120px] py-2 font-mono text-[12px]"
          value={body}
          onFocus={() => (lastFocused.current = "body")}
          onChange={(e) => setBody(e.target.value)}
        />
      </Field>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-textSecondary font-semibold mb-1.5">
          Available variables
        </div>
        <div className="flex flex-wrap gap-1.5">
          {row.availableVars.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => insertVar(v)}
              className="px-2 py-1 text-[11px] font-mono rounded border border-borderc bg-bg hover:bg-brand-soft hover:border-brand text-textPrimary"
              title={`Insert {${v}}`}
            >
              {`{${v}}`}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-between items-center gap-2 pt-2 border-t border-borderc">
        <button
          type="button"
          onClick={() => reset.mutate()}
          disabled={reset.isPending}
          className="text-xs text-textSecondary hover:text-danger hover:underline"
        >
          Reset to default
        </button>
        <div className="flex items-center gap-2">
          {msg && <span className="text-xs text-success">{msg}</span>}
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending || !dirty}
            className="btn-primary !h-9 text-xs"
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface RoomTypeRow {
  id: string;
  slug: string;
  label: string;
  defaultRate: string;
  maxOccupancy: string;
  description: string | null;
  isActive: boolean;
}

function RoomTypesTab() {
  const qc = useQueryClient();
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
                        onClick={() => {
                          if (confirm(`Archive "${t.label}"? Existing rooms keep the type; it'll be hidden from new-room forms.`)) {
                            archive.mutate(t.id);
                          }
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
    onError: (e: Error) => alert(e.message),
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
                        onClick={() => {
                          if (confirm(`Deactivate ${s.fullName}? They will lose access but their history is kept.`)) {
                            deactivate.mutate(s.id);
                          }
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
                      onClick={() => {
                        const txt = `Permanently DELETE ${s.fullName}?\n\nThis removes them from auth and the database. Only works if they have no reservations, invoices, payments, or activity history.\n\nType DELETE to confirm:`;
                        const ans = prompt(txt);
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
    role: staff.role,
    phone: staff.phone ?? "",
  });
  const [newPassword, setNewPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const patch: Record<string, unknown> = {};
      if (form.fullName !== staff.fullName) patch.fullName = form.fullName;
      if (form.email !== staff.email) patch.email = form.email;
      if (form.role !== staff.role) patch.role = form.role;
      const newPhone = form.phone || null;
      if (newPhone !== (staff.phone ?? null)) patch.phone = newPhone;
      if (newPassword) patch.password = newPassword;
      if (Object.keys(patch).length === 0) {
        return Promise.reject(new Error("No changes"));
      }
      return api.put(`/staff/${staff.id}`, patch);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      setMsg("Saved");
      setTimeout(onClose, 800);
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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-surface rounded-md w-full max-w-md p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-brand-dark">Edit Staff</h2>
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
        <Field label="Role">
          <select
            className="input"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Staff["role"] })}
          >
            <option value="admin">Admin</option>
            <option value="frontdesk">Front Desk</option>
            <option value="housekeeping">Housekeeping</option>
          </select>
        </Field>
        <Field label="Phone (optional)">
          <input
            className="input"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </Field>

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

        <div className="flex justify-end gap-2 pt-2">
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
