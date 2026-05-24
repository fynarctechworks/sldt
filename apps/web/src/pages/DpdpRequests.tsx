// DPDP requests log — past exports + deletions.
//
// Admin can search a guest and trigger an export or deletion directly
// from the guest profile (separate UI on GuestProfile, not added here
// to keep scope tight). This page is the history viewer.

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Database, FileDown, Trash2 } from "lucide-react";
import { useState } from "react";
import { Loader } from "@/components/Loader";
import { api, getList } from "@/lib/api";

interface ExportRow {
  id: string;
  subjectName: string;
  subjectPhone: string;
  verificationMethod: string;
  requestedAt: string;
  fulfilledAt: string;
}
interface DeletionRow {
  id: string;
  subjectSnapshot: { fullName?: string; phone?: string };
  redactedFields: string[];
  reason: string | null;
  verificationMethod: string;
  fulfilledAt: string;
}

export default function DpdpRequestsPage() {
  const [tab, setTab] = useState<"exports" | "deletions">("exports");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-brand-dark">DPDP requests</h1>
        <div className="text-xs text-textSecondary mt-0.5">
          Data-subject access + erasure history (Indian DPDP Act 2023)
        </div>
      </div>

      <div className="inline-flex rounded-sm border border-borderc overflow-hidden text-sm">
        <button
          onClick={() => setTab("exports")}
          className={`px-3 py-2 inline-flex items-center gap-1.5 ${tab === "exports" ? "bg-brand-dark text-cream" : "bg-surface hover:bg-bg"}`}
        >
          <FileDown className="w-4 h-4" /> Exports
        </button>
        <button
          onClick={() => setTab("deletions")}
          className={`px-3 py-2 inline-flex items-center gap-1.5 border-l border-borderc ${tab === "deletions" ? "bg-brand-dark text-cream" : "bg-surface hover:bg-bg"}`}
        >
          <Trash2 className="w-4 h-4" /> Deletions
        </button>
      </div>

      {tab === "exports" ? <ExportsTab /> : <DeletionsTab />}

      <div className="card text-xs text-textSecondary space-y-1">
        <div className="font-semibold text-brand-dark flex items-center gap-1">
          <Database className="w-3.5 h-3.5" /> How requests are processed
        </div>
        <p>
          Triggered from a guest's profile page after staff verifies the requester's identity in
          person or via OTP. The data export downloads a JSON of every record we hold; a deletion
          redacts PII in place while keeping financial rows for tax history.
        </p>
      </div>
    </div>
  );
}

function ExportsTab() {
  const q = useQuery({
    queryKey: ["dpdp-exports"],
    queryFn: () => getList<ExportRow>("/dpdp/exports"),
  });
  if (q.isLoading) return <Loader label="Loading…" />;
  const rows = q.data?.data ?? [];
  return (
    <div className="card !p-0 overflow-hidden">
      {rows.length === 0 ? (
        <div className="p-6 text-center text-sm text-textSecondary">No exports yet.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-bg/60 text-textSecondary text-left">
            <tr>
              <th className="px-3 py-2">Subject</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Verified via</th>
              <th className="px-3 py-2">Fulfilled at</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-borderc/60">
                <td className="px-3 py-2">{r.subjectName}</td>
                <td className="px-3 py-2 font-mono">{r.subjectPhone}</td>
                <td className="px-3 py-2 text-textSecondary">{r.verificationMethod.replace(/_/g, " ")}</td>
                <td className="px-3 py-2">{format(new Date(r.fulfilledAt), "d MMM yyyy, h:mm a")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function DeletionsTab() {
  const q = useQuery({
    queryKey: ["dpdp-deletions"],
    queryFn: () => getList<DeletionRow>("/dpdp/deletions"),
  });
  if (q.isLoading) return <Loader label="Loading…" />;
  const rows = q.data?.data ?? [];
  return (
    <div className="card !p-0 overflow-hidden">
      {rows.length === 0 ? (
        <div className="p-6 text-center text-sm text-textSecondary">No deletions yet.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-bg/60 text-textSecondary text-left">
            <tr>
              <th className="px-3 py-2">Subject (at deletion)</th>
              <th className="px-3 py-2">Phone (at deletion)</th>
              <th className="px-3 py-2">Reason</th>
              <th className="px-3 py-2">Fields redacted</th>
              <th className="px-3 py-2">Fulfilled at</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-borderc/60">
                <td className="px-3 py-2">{r.subjectSnapshot.fullName ?? "—"}</td>
                <td className="px-3 py-2 font-mono">{r.subjectSnapshot.phone ?? "—"}</td>
                <td className="px-3 py-2 text-textSecondary">{r.reason ?? "—"}</td>
                <td className="px-3 py-2 text-[11px] text-textSecondary">{r.redactedFields.length}</td>
                <td className="px-3 py-2">{format(new Date(r.fulfilledAt), "d MMM yyyy")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
