// GST Returns — pick a period + return type, generate JSON, download.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Play, ScrollText } from "lucide-react";
import { useState } from "react";
import { Loader } from "@/components/Loader";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api";
import { inr } from "@/lib/utils";

interface GstRun {
  id: string;
  returnType: "GSTR-1" | "GSTR-3B";
  periodMonth: number;
  periodYear: number;
  totalInvoices: number;
  totalTaxable: string;
  totalCgst: string;
  totalSgst: string;
  generatedAt: string;
}

export default function GstReturnsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const now = new Date();
  const [returnType, setReturnType] = useState<"GSTR-1" | "GSTR-3B">("GSTR-1");
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [force, setForce] = useState(false);

  const runsQuery = useQuery({
    queryKey: ["gst-returns"],
    queryFn: () =>
      api
        .get<{ data?: GstRun[] } | GstRun[]>("/gst-returns")
        .then((r) => (Array.isArray(r) ? r : r.data ?? [])),
  });

  const runMutation = useMutation({
    mutationFn: () =>
      api.post<GstRun>("/gst-returns/run", {
        returnType,
        periodMonth: month,
        periodYear: year,
        force,
      }),
    onSuccess: () => {
      toast("Return generated", "success");
      void qc.invalidateQueries({ queryKey: ["gst-returns"] });
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-brand-dark">GST Returns</h1>
        <div className="text-xs text-textSecondary mt-0.5">
          GSTR-1 (outward supplies) + GSTR-3B (monthly summary) JSON for filing
        </div>
      </div>

      {/* Generate */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-brand-dark">Generate a return</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs font-medium text-textSecondary">Return type</label>
            <select
              value={returnType}
              onChange={(e) => setReturnType(e.target.value as "GSTR-1" | "GSTR-3B")}
              className="input mt-1 w-full"
            >
              <option value="GSTR-1">GSTR-1</option>
              <option value="GSTR-3B">GSTR-3B</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-textSecondary">Month</label>
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="input mt-1 w-full"
            >
              {Array.from({ length: 12 }).map((_, i) => (
                <option key={i + 1} value={i + 1}>
                  {new Date(2024, i, 1).toLocaleDateString("en-IN", { month: "long" })}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-textSecondary">Year</label>
            <input
              type="number"
              min="2017"
              max="2100"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="input mt-1 w-full"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
              Overwrite if exists
            </label>
          </div>
        </div>
        <button
          onClick={() => runMutation.mutate()}
          disabled={runMutation.isPending}
          className="btn-primary inline-flex items-center gap-2"
        >
          <Play className="w-4 h-4" /> {runMutation.isPending ? "Generating…" : "Generate"}
        </button>
        <p className="text-[11px] text-textSecondary flex items-start gap-1">
          <ScrollText className="w-3 h-3 mt-0.5 shrink-0" />
          The generated JSON follows the published government schema, but the schema evolves —
          have your CA verify before uploading to the GST portal.
        </p>
      </div>

      {/* History */}
      <div className="card !p-0 overflow-hidden">
        <header className="px-3 py-2 border-b border-borderc bg-bg/60">
          <h2 className="font-semibold text-brand-dark">Past runs</h2>
        </header>
        {runsQuery.isLoading ? (
          <Loader label="Loading…" />
        ) : (runsQuery.data ?? []).length === 0 ? (
          <div className="p-6 text-center text-sm text-textSecondary">No runs yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-textSecondary text-left">
              <tr>
                <th className="px-3 py-2">Period</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2 text-right">Invoices</th>
                <th className="px-3 py-2 text-right">Taxable</th>
                <th className="px-3 py-2 text-right">CGST</th>
                <th className="px-3 py-2 text-right">SGST</th>
                <th className="px-3 py-2 text-right">Download</th>
              </tr>
            </thead>
            <tbody>
              {(runsQuery.data ?? []).map((r) => (
                <tr key={r.id} className="border-t border-borderc/60">
                  <td className="px-3 py-2 font-mono">
                    {String(r.periodMonth).padStart(2, "0")}/{r.periodYear}
                  </td>
                  <td className="px-3 py-2">{r.returnType}</td>
                  <td className="px-3 py-2 text-right">{r.totalInvoices}</td>
                  <td className="px-3 py-2 text-right font-mono">{inr(Number(r.totalTaxable))}</td>
                  <td className="px-3 py-2 text-right font-mono">{inr(Number(r.totalCgst))}</td>
                  <td className="px-3 py-2 text-right font-mono">{inr(Number(r.totalSgst))}</td>
                  <td className="px-3 py-2 text-right">
                    <a
                      href={`${(import.meta.env.VITE_API_URL as string).replace(/\/+$/, "")}/gst-returns/${r.id}/json`}
                      className="text-accentBlue inline-flex items-center gap-1 hover:underline"
                    >
                      <Download className="w-3.5 h-3.5" /> JSON
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
