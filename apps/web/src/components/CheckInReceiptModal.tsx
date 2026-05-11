import { format } from "date-fns";
import { Printer, X } from "lucide-react";
import { useEffect } from "react";
import { formatTime, inr } from "@/lib/utils";

export interface CheckInReceiptData {
  reservationId?: string;
  reservationNumber: string;
  checkInDate: string;
  checkOutDate: string;
  checkedInAt?: string | null;
  numNights: number;
  numAdults: number;
  numChildren: number;
  guest: {
    fullName: string;
    phone: string;
    idProofType?: string | null;
    idProofLast4?: string | null;
  };
  rooms: { roomNumber: string; roomType: string; ratePerNight: string }[];
  subtotal: string;
  gstRate: string;
  gstAmount: string;
  grandTotal: string;
  advancePaid: string;
  balanceDue: string;
  latestPayment?: {
    amount: string;
    paymentMethod: string;
    receiptNumber: string | null;
    paymentDate: string;
  } | null;
  hotel: {
    name: string;
    address: string;
    phone: string;
    gstin: string;
    logoUrl?: string | null;
    checkInTime?: string | null;
    checkOutTime?: string | null;
  };
}

interface Props {
  data: CheckInReceiptData;
  onClose: () => void;
}

export function CheckInReceiptModal({ data, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function print() {
    window.print();
  }

  return (
    <div className="print-portal fixed inset-0 z-50 grid place-items-center bg-brand-dark/40 p-4 print:bg-white print:p-0 print:static">
      <style>{`
        @media print {
          @page { margin: 10mm; size: A4; }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
            height: auto !important;
            min-height: 0 !important;
            overflow: visible !important;
          }
          /* Hide everything by default */
          body * { visibility: hidden !important; }
          /* Re-show the receipt and its descendants */
          .checkin-receipt, .checkin-receipt * { visibility: visible !important; }

          /* Collapse modal wrapper so it doesn't reserve page space */
          .print-portal {
            position: static !important;
            display: block !important;
            inset: auto !important;
            padding: 0 !important;
            margin: 0 !important;
            background: transparent !important;
            height: 0 !important;
            min-height: 0 !important;
          }

          /* Pull receipt to the page origin */
          .checkin-receipt {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            max-height: none !important;
            margin: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
            border: none !important;
            border-radius: 0 !important;
            background: #fff !important;
            overflow: visible !important;
            page-break-after: avoid !important;
            page-break-inside: avoid !important;
          }
          .checkin-receipt > .receipt-body {
            padding: 0 !important;
            font-size: 10.5px !important;
            line-height: 1.35 !important;
          }
          /* Trim large vertical spacings */
          .receipt-body .mt-6 { margin-top: 16px !important; }
          .receipt-body .mt-5 { margin-top: 12px !important; }
          .receipt-body .mt-4 { margin-top: 10px !important; }
          .receipt-body .mt-3 { margin-top: 8px !important; }
          .receipt-body .pt-3 { padding-top: 8px !important; }
          .receipt-body .py-3 { padding-top: 6px !important; padding-bottom: 6px !important; }
          .receipt-body .py-2\\.5 { padding-top: 4px !important; padding-bottom: 4px !important; }
          .receipt-body .p-2\\.5 { padding: 6px !important; }
          .receipt-body .p-3 { padding: 8px !important; }
          .receipt-body .p-4 { padding: 10px !important; }
          .receipt-body .p-6 { padding: 0 !important; }

          .no-print, .no-print * { display: none !important; }
          .receipt-body table { page-break-inside: avoid; }
          .receipt-body .receipt-section { page-break-inside: avoid; }

          /* Last-resort: force the whole receipt onto one A4 page */
          .checkin-receipt::after {
            content: "";
            display: block;
            page-break-after: avoid;
          }
        }
      `}</style>

      <div
        className="checkin-receipt w-full max-w-md bg-white rounded-md shadow-xl border border-borderc max-h-[90vh] overflow-y-auto print:max-w-full print:max-h-none print:overflow-visible print:shadow-none"
        role="dialog"
        aria-modal="true"
      >
        <div className="no-print flex items-center justify-between px-5 py-3 border-b border-borderc bg-brand-soft">
          <div className="font-semibold text-brand-dark">Check-in Receipt</div>
          <button onClick={onClose} className="text-textSecondary hover:text-textPrimary">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="receipt-body p-6 text-[12px] text-textPrimary">
          <div className="receipt-section flex items-start justify-between gap-3 pb-3 border-b-2 border-brand">
            <div className="flex items-start gap-2.5">
              {data.hotel.logoUrl && (
                <img
                  src={data.hotel.logoUrl}
                  alt=""
                  className="w-12 h-12 rounded-md object-contain bg-cream p-0.5 ring-1 ring-brand/20"
                />
              )}
              <div className="leading-tight">
                <div className="text-[15px] font-bold text-brand-dark">{data.hotel.name}</div>
                <div className="text-[10px] text-textSecondary mt-0.5">{data.hotel.address}</div>
                {data.hotel.gstin && (
                  <div className="text-[10px] text-textSecondary font-mono mt-0.5">
                    GSTIN: {data.hotel.gstin}
                  </div>
                )}
                {data.hotel.phone && (
                  <div className="text-[10px] text-textSecondary mt-0.5">{data.hotel.phone}</div>
                )}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="inline-block text-[10px] tracking-[0.2em] uppercase font-bold text-brass border border-brass rounded-full px-2.5 py-0.5">
                Check-in
              </div>
              <div className="text-[13px] font-bold font-mono text-brand-dark mt-1.5">
                {data.reservationNumber}
              </div>
              <div className="text-[10px] text-textSecondary">
                {format(new Date(), "dd MMM yyyy · HH:mm")}
              </div>
            </div>
          </div>

          <div className="receipt-section grid grid-cols-2 gap-2 mt-3">
            <div className="border border-borderc rounded-sm bg-cream/40 p-2.5">
              <div className="text-[9px] uppercase tracking-wider text-textSecondary font-semibold">
                Guest
              </div>
              <div className="font-semibold text-brand-dark mt-0.5">{data.guest.fullName}</div>
              <div className="font-mono text-[11px] mt-0.5">{data.guest.phone}</div>
              {data.guest.idProofType && data.guest.idProofLast4 && (
                <div className="text-[10px] text-textSecondary mt-1 capitalize">
                  {data.guest.idProofType.replace("_", " ")} ····{data.guest.idProofLast4}
                </div>
              )}
            </div>
            <div className="border border-borderc rounded-sm bg-cream/40 p-2.5">
              <div className="text-[9px] uppercase tracking-wider text-textSecondary font-semibold">
                Stay
              </div>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-brass font-bold">Check-in</div>
                  <div className="font-semibold text-brand-dark text-[12px] leading-tight">
                    {format(new Date(data.checkedInAt ?? data.checkInDate), "dd MMM yyyy")}
                  </div>
                  <div className="text-[10px] text-textSecondary leading-tight mt-0.5">
                    {data.checkedInAt
                      ? `at ${format(new Date(data.checkedInAt), "h:mm a")}`
                      : data.hotel.checkInTime
                        ? `from ${formatTime(data.hotel.checkInTime)}`
                        : ""}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-brass font-bold">Check-out</div>
                  <div className="font-semibold text-brand-dark text-[12px] leading-tight">
                    {format(new Date(data.checkOutDate), "dd MMM yyyy")}
                  </div>
                  {data.hotel.checkOutTime && (
                    <div className="text-[10px] text-textSecondary leading-tight mt-0.5">
                      by {formatTime(data.hotel.checkOutTime)}
                    </div>
                  )}
                </div>
              </div>
              <div className="text-[10px] text-textSecondary mt-1.5">
                {data.numNights} night{data.numNights === 1 ? "" : "s"} · {data.numAdults} adult
                {data.numAdults === 1 ? "" : "s"}
                {data.numChildren > 0 && `, ${data.numChildren} child${data.numChildren === 1 ? "" : "ren"}`}
              </div>
            </div>
          </div>

          <div className="receipt-section mt-4">
            <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-brass mb-1.5">
              Rooms Allotted
            </div>
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-brand-dark">
                  <th className="py-1.5 border-b border-brand/30 font-semibold">Room</th>
                  <th className="py-1.5 border-b border-brand/30 font-semibold">Type</th>
                  <th className="py-1.5 border-b border-brand/30 font-semibold text-right">Rate/Night</th>
                </tr>
              </thead>
              <tbody>
                {data.rooms.map((rm) => (
                  <tr key={rm.roomNumber}>
                    <td className="py-1.5 border-b border-borderc font-mono font-bold">{rm.roomNumber}</td>
                    <td className="py-1.5 border-b border-borderc capitalize">
                      {rm.roomType.replace(/_/g, " ")}
                    </td>
                    <td className="py-1.5 border-b border-borderc text-right font-mono">
                      {inr(rm.ratePerNight)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.latestPayment && (
            <div className="mt-4 p-3 rounded-md text-cream text-center bg-brand-dark">
              <div className="text-[9px] tracking-[0.25em] uppercase text-brass font-bold">
                Advance Received
              </div>
              <div className="text-[24px] font-bold font-mono mt-0.5">
                {inr(data.latestPayment.amount)}
              </div>
              <div className="text-[10px] mt-0.5 capitalize opacity-90">
                via {data.latestPayment.paymentMethod.replace(/_/g, " ")}
                {data.latestPayment.receiptNumber && ` · ${data.latestPayment.receiptNumber}`}
              </div>
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <table className="w-full max-w-[18rem] text-[11px]">
              <tbody>
                <tr>
                  <td className="py-1 text-textSecondary">Subtotal ({data.numNights}n)</td>
                  <td className="py-1 text-right font-mono">{inr(data.subtotal)}</td>
                </tr>
                {(() => {
                  const gstRate = Number(data.gstRate);
                  const gstAmt = Number(data.gstAmount);
                  if (!gstRate || !gstAmt) return null;
                  const half = +(gstAmt / 2).toFixed(2);
                  const halfRate = +(gstRate / 2).toFixed(2);
                  return (
                    <>
                      <tr>
                        <td className="py-1 text-textSecondary">CGST @ {halfRate}%</td>
                        <td className="py-1 text-right font-mono">{inr(half)}</td>
                      </tr>
                      <tr>
                        <td className="py-1 text-textSecondary">SGST @ {halfRate}%</td>
                        <td className="py-1 text-right font-mono">{inr(gstAmt - half)}</td>
                      </tr>
                    </>
                  );
                })()}
                <tr className="border-t border-brand/30">
                  <td className="py-1.5 pt-2 font-bold text-brand-dark">Grand Total</td>
                  <td className="py-1.5 pt-2 text-right font-mono font-bold text-brand-dark">
                    {inr(data.grandTotal)}
                  </td>
                </tr>
                <tr>
                  <td className="py-1 text-success">Paid</td>
                  <td className="py-1 text-right font-mono text-success">{inr(data.advancePaid)}</td>
                </tr>
                <tr>
                  <td className="py-1 font-bold text-danger">Balance Due</td>
                  <td className="py-1 text-right font-mono font-bold text-danger">
                    {inr(data.balanceDue)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mt-5 pt-3 border-t border-borderc text-[10px] text-textSecondary leading-relaxed">
            Welcome to {data.hotel.name}. Please retain this slip for reference. Final invoice will
            be issued at check-out
            {data.hotel.checkOutTime ? ` (by ${formatTime(data.hotel.checkOutTime)})` : ""}. For any
            assistance, contact the front desk.
          </div>

          <div className="receipt-section mt-6 flex justify-between gap-3">
            <div className="text-[10px] text-textSecondary">
              <div className="mt-6 inline-block min-w-[120px] pt-1 border-t border-textSecondary/40">
                Guest Signature
              </div>
            </div>
            <div className="text-[10px] text-textSecondary text-right">
              <div className="mt-6 inline-block min-w-[120px] pt-1 border-t border-textSecondary/40">
                Authorised Signatory
              </div>
            </div>
          </div>
        </div>

        <div className="no-print flex justify-end gap-2 px-5 py-3 border-t border-borderc bg-bg">
          <button onClick={onClose} className="btn-secondary">
            Done
          </button>
          <button onClick={print} className="btn-primary inline-flex items-center gap-2">
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </div>
    </div>
  );
}
