import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  BedDouble,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  Clock,
  CreditCard,
  Eye,
  FileDown,
  Gift,
  Pencil,
  Plus,
  Snowflake,
  Tv,
  Wallet,
  Wifi,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { ApplyWalletCreditModal } from "@/components/ApplyWalletCreditModal";
import { CheckInReceiptModal, type CheckInReceiptData } from "@/components/CheckInReceiptModal";
import { EarlyCheckInModal } from "@/components/EarlyCheckInModal";
import { EditInvoiceModal } from "@/components/EditInvoiceModal";
import { EditReceiptModal } from "@/components/EditReceiptModal";
import { useDialog } from "@/components/Dialog";
import { KycModal } from "@/components/KycModal";
import { PdfPreviewModal } from "@/components/PdfPreviewModal";
import { Loader } from "@/components/Loader";
import { OtpModal } from "@/components/OtpModal";
import { RoomActionPopover } from "@/components/RoomActionPopover";
import { StatusBadge } from "@/components/StatusBadge";
import { useToast } from "@/components/Toast";
import { ApiError, api, newIdempotencyKey } from "@/lib/api";
import { invalidateReservationData } from "@/lib/invalidate";
import { inr } from "@/lib/utils";

interface Detail {
  id: string;
  reservationNumber: string;
  guestId: string;
  checkInDate: string;
  checkOutDate: string;
  numNights?: number;
  // Day-use bookings: stayType='short_stay' + durationHours holds the
  // booked block length. effective check-out = checkedInAt + durationHours.
  stayType?: "overnight" | "short_stay";
  durationHours?: string | null;
  numAdults: number;
  numChildren: number;
  status: string;
  // Booking source. Drives the Make Complimentary button (hidden when
  // already 'complimentary') and the booking-source pill on the page.
  bookingSource?: "walkin" | "phone_whatsapp" | "complimentary";
  checkedInAt: string | null;
  specialRequests: string | null;
  subtotal: string;
  grandTotal: string;
  advancePaid: string;
  balanceDue: string;
  gstRate: string;
  gstAmount: string;
  hotelCheckInTime: string;
  hotelCheckOutTime: string;
  guest: {
    id: string;
    fullName: string;
    phone: string;
    kycVerifiedAt: string | null;
    idProofPhotoFront: string | null;
    idProofType: string | null;
    idProofLast4: string | null;
    photoUrl: string | null;
  };
  rooms: {
    id: string;
    roomNumber: string;
    roomType: string;
    soldAsType: string | null;
    // Pre-rendered by the API. See lib/roomTypeLabel.ts on the server.
    displayType: string;
    ratePerNight: string;
    hasAc?: boolean;
    hasTv?: boolean;
    hasWifi?: boolean;
    status?: string;
  }[];
  additionalCharges: {
    id: string;
    description: string;
    amount: string;
    gstRate: string;
    createdAt: string;
  }[];
  invoice: {
    id: string;
    invoiceNumber: string;
    status: string;
    grandTotal: string;
    balanceDue: string;
  } | null;
  payments: {
    id: string;
    amount: string;
    paymentMethod: string;
    status?: string;
    paymentDate: string;
    notes: string | null;
    receiptNumber: string | null;
    voided?: boolean;
    createdAt: string;
  }[];
}

export default function ReservationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const dialog = useDialog();
  const [err, setErr] = useState<string | null>(null);

  const [showCharge, setShowCharge] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [showKyc, setShowKyc] = useState(false);
  const [showExtend, setShowExtend] = useState(false);
  const [showLate, setShowLate] = useState(false);
  const [showAddRoom, setShowAddRoom] = useState(false);
  const [showEditDates, setShowEditDates] = useState(false);
  const [showOtp, setShowOtp] = useState(false);
  const [showCheckInReceipt, setShowCheckInReceipt] = useState(false);
  // When set, opens the on-screen slip for a specific payment (booking advance
  // or any later payment). Independent from the check-in receipt auto-popup.
  const [slipPaymentId, setSlipPaymentId] = useState<string | null>(null);
  const [editPaymentId, setEditPaymentId] = useState<string | null>(null);
  const [showEarlyCheckIn, setShowEarlyCheckIn] = useState(false);
  const [showApplyCredit, setShowApplyCredit] = useState(false);
  const [showInvoiceEdit, setShowInvoiceEdit] = useState(false);
  const [showMakeComp, setShowMakeComp] = useState(false);
  const [pdfPreview, setPdfPreview] = useState<{ url: string; title: string; filename: string } | null>(null);
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ["reservation", id],
    queryFn: () => api.get<Detail>(`/reservations/${id}`),
    enabled: !!id,
  });

  const settingsQ = useQuery({
    queryKey: ["settings-public"],
    queryFn: () =>
      api.get<{
        hotelName: string;
        hotelAddress: string;
        hotelPhone: string;
        ownerPhone: string | null;
        hotelGstin: string;
        hotelLogoUrl: string | null;
        checkInTime: string | null;
        checkOutTime: string | null;
      }>("/settings/public"),
    staleTime: 5 * 60 * 1000,
  });

  function invalidate() {
    invalidateReservationData(qc, { reservationId: id, guestId: data?.guestId });
  }

  // Deep-link from CheckoutAlerts: visiting /reservations/:id?action=checkout
  // auto-opens the check-out modal as soon as the reservation has loaded
  // and is in a checkable state. We strip the param immediately so a page
  // reload doesn't keep reopening the modal.
  useEffect(() => {
    if (searchParams.get("action") !== "checkout") return;
    if (!data) return;
    if (data.status === "checked_in") {
      setShowCheckout(true);
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("action");
        return next;
      },
      { replace: true },
    );
  }, [data, searchParams, setSearchParams]);

  function handleStartCheckIn() {
    setErr(null);
    const today = format(new Date(), "yyyy-MM-dd");
    if (r && r.checkInDate > today) {
      // Two-step flow: open the EarlyCheckInModal which shows the financial
      // impact (old vs new totals) and only commits the date shift after the
      // user confirms a second time. When that finishes, we continue to OTP.
      setShowEarlyCheckIn(true);
      return;
    }
    setShowOtp(true);
  }

  const checkIn = useMutation({
    mutationFn: () => api.post(`/reservations/${id}/check-in`),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["reservation", id] });
      const prev = qc.getQueryData(["reservation", id]);
      qc.setQueryData(["reservation", id], (old: unknown) => {
        if (!old || typeof old !== "object") return old;
        return { ...(old as Record<string, unknown>), status: "checked_in", checkedInAt: new Date().toISOString() };
      });
      return { prev };
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["reservation", id], ctx.prev);
      if (e instanceof ApiError && e.code === "EARLY_CHECK_IN") {
        // Pre-check should normally catch this; if it slips through (e.g. day
        // rollover between page load and submit), point the user to retry —
        // handleStartCheckIn will re-prompt + run the early-check-in flow.
        setErr(`${e.message} Click "Verify & Check In" again to confirm early check-in.`);
        return;
      }
      setErr(e.message);
    },
    onSuccess: () => {
      toast("Guest checked in", "success");
      setShowCheckInReceipt(true);
    },
    onSettled: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const cancel = useMutation({
    // The cancel endpoint's zod schema (cancelSchema) expects the field
    // `cancellationReason`, not `reason` — sending the wrong key made the
    // server receive undefined and fail validation ("Invalid request
    // payload").
    mutationFn: (cancellationReason: string) =>
      api.post(`/reservations/${id}/cancel`, { cancellationReason }),
    onSuccess: invalidate,
    onError: (e: Error) => setErr(e.message),
  });

  // Reclassifies the booking as complimentary. Existing payments are left
  // alone — see API route for the rationale. The Complimentary report
  // shows the gap between billed and already-paid.
  const makeComp = useMutation({
    mutationFn: (vars: { reason: string; approver?: string }) =>
      api.post(`/reservations/${id}/make-complimentary`, vars),
    onSuccess: () => {
      invalidate();
      toast("Booking marked as complimentary", "success");
    },
    onError: (e: Error) => setErr(e.message),
  });

  function previewInvoice(invoiceId: string, invoiceNumber: string) {
    setPdfPreview({
      url: `${import.meta.env.VITE_API_URL}/invoices/${invoiceId}/pdf`,
      title: `Invoice · ${invoiceNumber}`,
      filename: `${invoiceNumber}.pdf`,
    });
  }

  function previewReceipt(paymentId: string, receiptNumber: string | null) {
    setPdfPreview({
      url: `${import.meta.env.VITE_API_URL}/payments/${paymentId}/receipt`,
      title: `Receipt · ${receiptNumber ?? paymentId.slice(0, 8)}`,
      filename: `${receiptNumber ?? "receipt-" + paymentId.slice(0, 8)}.pdf`,
    });
  }

  if (isLoading) return <Loader size="lg" />;
  if (!data) return <div>Not found</div>;

  const r = data;
  const rooms = data.rooms;
  const charges = data.additionalCharges;
  const invoice = data.invoice;
  const payments = data.payments;
  const guest = data.guest;
  const nights = r.numNights ?? Math.max(
    1,
    Math.round(
      (new Date(r.checkOutDate).getTime() - new Date(r.checkInDate).getTime()) /
        (1000 * 60 * 60 * 24),
    ),
  );
  const isShortStay = r.stayType === "short_stay";
  const durationHours = Number(r.durationHours ?? 0);
  // For day-use bookings the actual exit datetime is checkedInAt + duration.
  // If the guest isn't checked in yet, anchor to checkInDate + hotelCheckInTime.
  const shortStayCheckoutAt = (() => {
    if (!isShortStay) return null;
    const startMs = r.checkedInAt
      ? new Date(r.checkedInAt).getTime()
      : (() => {
          const [hh, mm] = (r.hotelCheckInTime ?? "12:00").split(":");
          return new Date(
            `${r.checkInDate}T${(hh ?? "12").padStart(2, "0")}:${(mm ?? "00").padStart(2, "0")}:00`,
          ).getTime();
        })();
    return new Date(startMs + Math.round(durationHours * 3600 * 1000));
  })();
  const totalPaid = (Number(r.grandTotal) - Number(r.balanceDue)).toFixed(2);
  const kycVerified = !!guest?.kycVerifiedAt && !!guest?.idProofPhotoFront;
  const canCheckIn = r.status === "confirmed" && kycVerified;
  const canCheckOut = r.status === "checked_in";
  const canCancel = r.status === "confirmed" || r.status === "checked_in";

  const overdueDays = (() => {
    if (r.status !== "checked_in") return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const out = new Date(r.checkOutDate + "T00:00:00");
    const diff = Math.floor((today.getTime() - out.getTime()) / 86400000);
    return Math.max(0, diff);
  })();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => navigate(-1)} className="btn-secondary !h-9 !px-2">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <h1 className="text-2xl font-bold text-navy font-mono">{r.reservationNumber}</h1>
        <StatusBadge status={r.status} />
        {overdueDays > 0 && (
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-sm bg-danger/10 text-danger text-[11px] font-bold uppercase tracking-wider">
            Overdue · {overdueDays}d
          </span>
        )}
      </div>

      {overdueDays > 0 && (
        <div className="card border-danger/40 bg-danger/5 flex items-start gap-3">
          <div className="text-danger text-lg leading-none mt-0.5">⚠</div>
          <div className="flex-1">
            <div className="font-semibold text-danger">
              Stay was scheduled to end {format(new Date(r.checkOutDate), "dd MMM yyyy")} —{" "}
              {overdueDays} day{overdueDays === 1 ? "" : "s"} ago.
            </div>
            <div className="text-xs text-textSecondary mt-0.5">
              Check the guest out now, extend the stay, or add a late charge.
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card">
          <div className="label">Guest</div>
          <div className="flex items-start gap-3">
            {guest?.photoUrl && (
              <img
                src={guest.photoUrl}
                alt=""
                className="w-14 h-16 object-cover rounded border border-borderc shrink-0"
              />
            )}
            <div className="min-w-0">
              <button
                onClick={() => navigate(`/guests/${r.guestId}`)}
                className="font-semibold text-navy hover:underline text-left"
              >
                {guest?.fullName}
              </button>
              <div className="text-sm text-textSecondary">{guest?.phone}</div>
              <div className="text-xs text-textSecondary mt-1">
                {r.numAdults} adult{r.numAdults === 1 ? "" : "s"}
                {r.numChildren > 0 && `, ${r.numChildren} child${r.numChildren === 1 ? "" : "ren"}`}
              </div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="label">Dates</div>
          <div className="text-sm">
            <div>
              <strong>In:</strong>{" "}
              {format(
                r.checkedInAt ? new Date(r.checkedInAt) : new Date(r.checkInDate),
                "dd MMM yyyy",
              )}{" "}
              <span className="text-textSecondary">
                ·{" "}
                {r.checkedInAt
                  ? format(new Date(r.checkedInAt), "h:mm a")
                  : formatTime(r.hotelCheckInTime)}
              </span>
            </div>
            <div>
              <strong>Out:</strong>{" "}
              {format(
                shortStayCheckoutAt ?? new Date(r.checkOutDate),
                "dd MMM yyyy",
              )}{" "}
              <span className="text-textSecondary">
                ·{" "}
                {shortStayCheckoutAt
                  ? format(shortStayCheckoutAt, "h:mm a")
                  : formatTime(r.hotelCheckOutTime)}
              </span>
            </div>
            <div className="text-textSecondary text-xs mt-1">
              {isShortStay
                ? `Day use · ${durationHours} hour${durationHours === 1 ? "" : "s"}`
                : `${nights} night${nights === 1 ? "" : "s"}`}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="label">Balance</div>
          <div className="text-2xl font-bold font-mono text-navy">{inr(r.balanceDue)}</div>
          <div className="text-xs text-textSecondary">
            of {inr(r.grandTotal)} · paid {inr(totalPaid)}
          </div>
        </div>
      </div>

      {r.specialRequests && (
        <div className="card bg-warning/5 border-warning/30">
          <div className="label mb-1">Special Requests</div>
          <div className="text-sm">{r.specialRequests}</div>
        </div>
      )}

      <div
        className={`card flex items-center justify-between ${
          kycVerified ? "bg-success/5 border-success/30" : "bg-danger/5 border-danger/40"
        }`}
      >
        <div className="flex items-center gap-3">
          {kycVerified ? (
            <ShieldCheck className="w-6 h-6 text-success" />
          ) : (
            <ShieldAlert className="w-6 h-6 text-danger" />
          )}
          <div>
            <div className="font-semibold text-navy">
              KYC {kycVerified ? "Verified" : "Required"}
            </div>
            <div className="text-xs text-textSecondary">
              {kycVerified
                ? `${guest?.idProofType?.toUpperCase() ?? "ID"} ending ••••${guest?.idProofLast4 ?? ""}`
                : "Upload guest ID proof photo before check-in (Form C / Foreigners Order compliance)."}
            </div>
          </div>
        </div>
        <button className="btn-secondary" onClick={() => setShowKyc(true)}>
          {kycVerified ? "View / Replace" : "Upload Documents"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {r.status === "confirmed" && (
          <button
            className="btn-primary"
            onClick={handleStartCheckIn}
            disabled={!canCheckIn || checkIn.isPending}
            title={!kycVerified ? "Upload KYC documents first" : undefined}
          >
            {checkIn.isPending ? "Checking in…" : "Verify & Check In"}
          </button>
        )}
        {canCheckOut && (
          <button className="btn-primary" onClick={() => setShowCheckout(true)}>
            Check Out & Generate Invoice
          </button>
        )}
        {canCheckOut && (
          <button
            className="btn-secondary inline-flex items-center gap-2"
            onClick={() =>
              setPdfPreview({
                url: `${import.meta.env.VITE_API_URL}/reservations/${r.id}/invoice-preview`,
                title: `Invoice Preview · ${r.reservationNumber}`,
                filename: `${r.reservationNumber}-preview.pdf`,
              })
            }
          >
            <FileDown className="w-4 h-4" /> Preview Invoice
          </button>
        )}
        {(r.status === "checked_in" || r.status === "confirmed") && (
          <button className="btn-secondary inline-flex items-center gap-2" onClick={() => setShowCharge(true)}>
            <Plus className="w-4 h-4" /> Add Charge
          </button>
        )}
        {(r.status === "checked_in" || r.status === "confirmed") && (
          <button className="btn-secondary inline-flex items-center gap-2" onClick={() => setShowExtend(true)}>
            <CalendarPlus className="w-4 h-4" /> Extend Stay
          </button>
        )}
        {(r.status === "checked_in" || r.status === "confirmed") && (
          <button className="btn-secondary inline-flex items-center gap-2" onClick={() => setShowAddRoom(true)}>
            <BedDouble className="w-4 h-4" /> Add Room
          </button>
        )}
        {!invoice && (r.status === "checked_in" || r.status === "confirmed") && (
          <button className="btn-secondary inline-flex items-center gap-2" onClick={() => setShowEditDates(true)}>
            <Pencil className="w-4 h-4" /> Edit Dates
          </button>
        )}
        {r.status === "checked_in" && (
          <button className="btn-secondary inline-flex items-center gap-2" onClick={() => setShowLate(true)}>
            <Clock className="w-4 h-4" /> Late Checkout
          </button>
        )}
        {Number(r.balanceDue) > 0.009 && r.status !== "cancelled" && (
          <button className="btn-secondary inline-flex items-center gap-2" onClick={() => setShowPay(true)}>
            <CreditCard className="w-4 h-4" /> Record Payment
          </button>
        )}
        {Number(r.balanceDue) > 0.009 && r.status !== "cancelled" && (
          <button
            className="btn-secondary inline-flex items-center gap-2"
            onClick={() => setShowApplyCredit(true)}
            title="Apply wallet credit from the guest's balance"
          >
            <Wallet className="w-4 h-4" /> Apply Wallet Credit
          </button>
        )}
        {/* Make Complimentary — available on confirmed / checked_in /
            checked_out reservations that aren't already comped. Pure
            reclassification: the booking is removed from every revenue
            surface and appears only in Reports → Complimentary. No
            invoice/payment changes. Cancelled bookings are excluded. */}
        {["confirmed", "checked_in", "checked_out"].includes(r.status)
          && r.bookingSource !== "complimentary" && (
          <button
            className="btn-secondary inline-flex items-center gap-2"
            onClick={() => setShowMakeComp(true)}
            title="Move this booking into the Complimentary section"
          >
            <Gift className="w-4 h-4" /> Make Complimentary
          </button>
        )}
        {canCancel && (
          <button
            className="btn-danger inline-flex items-center gap-2"
            onClick={async () => {
              const reason = await dialog.prompt({
                title: "Cancel reservation",
                message: "This cannot be undone. Please provide a reason for the records.",
                placeholder: "e.g. Guest requested, no-show, duplicate booking",
                okLabel: "Cancel reservation",
                cancelLabel: "Keep it",
                tone: "danger",
                required: true,
                multiline: true,
              });
              if (reason) cancel.mutate(reason);
            }}
          >
            <XCircle className="w-4 h-4" /> Cancel
          </button>
        )}
      </div>

      {err && <div className="card bg-danger/5 border-danger text-danger text-sm">{err}</div>}

      <div className="card p-0">
        <div className="px-4 py-3 border-b"><strong>Rooms</strong></div>
        <table className="table-base">
          <thead>
            <tr>
              <th>Room #</th>
              <th>Type</th>
              <th className="tabular-nums">Rate/night</th>
              <th className="tabular-nums">Subtotal ({nights}n)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((room) => (
              <RoomRow
                key={room.id}
                reservationId={r.id}
                room={room}
                nights={nights}
                canEdit={!invoice}
                onSaved={invalidate}
              />
            ))}
          </tbody>
        </table>
      </div>

      {charges.length > 0 && (
        <div className="card p-0">
          <div className="px-4 py-3 border-b"><strong>Additional Charges</strong></div>
          <table className="table-base">
            <thead>
              <tr>
                <th>Description</th>
                <th className="tabular-nums">GST%</th>
                <th>Added</th>
                <th className="tabular-nums">Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {charges.map((c) => (
                <ChargeRow
                  key={c.id}
                  reservationId={r.id}
                  charge={c}
                  canEdit={!invoice}
                  onSaved={invalidate}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {invoice && (
        <div className="card">
          <div className="flex justify-between items-start">
            <div>
              <div className="label">Invoice</div>
              <div className="font-mono font-bold text-lg text-navy">{invoice.invoiceNumber}</div>
              <div className="text-sm">
                <StatusBadge status={invoice.status} /> · Grand Total{" "}
                <span className="font-mono">{inr(invoice.grandTotal)}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                className="btn-secondary inline-flex items-center gap-2"
                onClick={() => previewInvoice(invoice.id, invoice.invoiceNumber)}
              >
                <FileDown className="w-4 h-4" /> Preview
              </button>
              {profile?.role === "admin" && invoice.status !== "voided" && (
                <button
                  className="btn-secondary inline-flex items-center gap-2"
                  onClick={() => setShowInvoiceEdit(true)}
                  title="Make a correction to this invoice"
                >
                  <Pencil className="w-4 h-4" /> Edit
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {payments.length > 0 && (
        <div className="card p-0">
          <div className="px-4 py-3 border-b"><strong>Payment History</strong></div>
          <table className="table-base">
            <thead>
              <tr>
                <th>Date</th>
                <th>Method</th>
                <th>Notes</th>
                <th className="tabular-nums">Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <PaymentRow
                  key={p.id}
                  payment={p}
                  isAdmin={profile?.role === "admin"}
                  onSaved={invalidate}
                  onPrintReceipt={() => previewReceipt(p.id, p.receiptNumber)}
                  onEdit={() => setEditPaymentId(p.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCharge && (
        <ChargeModal
          reservationId={r.id}
          onClose={() => setShowCharge(false)}
          onSaved={() => {
            setShowCharge(false);
            invalidate();
          }}
        />
      )}
      {showPay && (
        <PaymentModal
          reservationId={r.id}
          balance={Number(r.balanceDue)}
          onClose={() => setShowPay(false)}
          onSaved={() => {
            setShowPay(false);
            invalidate();
          }}
        />
      )}
      {showCheckout && (
        <CheckoutModal
          reservationId={r.id}
          reservationNumber={r.reservationNumber}
          guestId={r.guestId}
          balance={Number(r.balanceDue)}
          onClose={() => setShowCheckout(false)}
          onDone={() => {
            setShowCheckout(false);
            invalidate();
          }}
        />
      )}
      {showKyc && (
        <KycModal
          guestId={r.guestId}
          onClose={() => setShowKyc(false)}
          onUploaded={() => {
            invalidate();
          }}
        />
      )}
      <OtpModal
        reservationId={r.id}
        open={showOtp}
        onClose={() => setShowOtp(false)}
        onVerified={() => {
          setShowOtp(false);
          checkIn.mutate();
        }}
      />

      {showEarlyCheckIn && (
        <EarlyCheckInModal
          reservationId={r.id}
          reservationNumber={r.reservationNumber}
          onClose={() => setShowEarlyCheckIn(false)}
          onConfirmed={() => {
            setShowEarlyCheckIn(false);
            toast("Booking dates shifted for early check-in", "success");
            invalidate();
            // Continue straight into the OTP step.
            setShowOtp(true);
          }}
        />
      )}

      {showApplyCredit && (
        <ApplyWalletCreditModal
          reservationId={r.id}
          onClose={() => setShowApplyCredit(false)}
          onApplied={() => {
            setShowApplyCredit(false);
            toast("Wallet credit applied", "success");
            invalidate();
          }}
        />
      )}

      {showMakeComp && (
        <MakeCompModal
          reservationNumber={r.reservationNumber}
          grandTotal={r.grandTotal}
          totalPaid={totalPaid}
          pending={makeComp.isPending}
          onClose={() => setShowMakeComp(false)}
          onSubmit={(vars) => {
            makeComp.mutate(vars, {
              onSuccess: () => setShowMakeComp(false),
            });
          }}
        />
      )}

      {showInvoiceEdit && invoice && (
        <EditInvoiceModal
          invoiceId={invoice.id}
          onClose={() => setShowInvoiceEdit(false)}
          onSaved={() => {
            invalidate();
            toast("Invoice updated", "success");
          }}
        />
      )}

      {showCheckInReceipt && settingsQ.data && (
        <CheckInReceiptModal
          data={
            {
              reservationNumber: r.reservationNumber,
              checkInDate: r.checkInDate,
              checkOutDate: r.checkOutDate,
              checkedInAt: r.checkedInAt,
              numNights: nights,
              stayType: r.stayType,
              durationHours: durationHours || null,
              numAdults: r.numAdults,
              numChildren: r.numChildren,
              guest: {
                fullName: r.guest.fullName,
                phone: r.guest.phone,
                idProofType: r.guest.idProofType,
                idProofLast4: r.guest.idProofLast4,
                photoUrl: r.guest.photoUrl,
              },
              rooms: r.rooms.map((rm) => ({
                roomNumber: rm.roomNumber,
                roomType: rm.roomType,
                soldAsType: rm.soldAsType ?? null,
                displayType: rm.displayType,
                ratePerNight: rm.ratePerNight,
              })),
              subtotal: r.subtotal,
              gstRate: r.gstRate,
              gstAmount: r.gstAmount ?? "",
              grandTotal: r.grandTotal,
              advancePaid: r.advancePaid,
              balanceDue: r.balanceDue,
              latestPayment:
                r.payments.length > 0
                  ? {
                      id: r.payments[r.payments.length - 1]!.id,
                      amount: r.payments[r.payments.length - 1]!.amount,
                      paymentMethod: r.payments[r.payments.length - 1]!.paymentMethod,
                      receiptNumber: r.payments[r.payments.length - 1]!.receiptNumber,
                      paymentDate: r.payments[r.payments.length - 1]!.paymentDate,
                    }
                  : null,
              allPayments: r.payments.map((p) => ({
                amount: p.amount,
                paymentDate: p.paymentDate,
                voided: p.voided,
                status: p.status,
              })),
              hotel: {
                name: settingsQ.data.hotelName,
                address: settingsQ.data.hotelAddress,
                phone: settingsQ.data.hotelPhone,
                ownerPhone: settingsQ.data.ownerPhone,
                gstin: settingsQ.data.hotelGstin,
                logoUrl: settingsQ.data.hotelLogoUrl ?? "/logo.jpg",
                checkInTime: settingsQ.data.checkInTime,
                checkOutTime: settingsQ.data.checkOutTime,
              },
            } satisfies CheckInReceiptData
          }
          onClose={() => setShowCheckInReceipt(false)}
        />
      )}

      {slipPaymentId && settingsQ.data && (() => {
        const pay = r.payments.find((p) => p.id === slipPaymentId);
        if (!pay) return null;
        // If this slip is being viewed before check-in, label it as the
        // booking-advance variant; once checked in, it's effectively a
        // check-in receipt for whichever payment row the user clicked.
        const variant = r.status === "confirmed" ? "booking_advance" : "checkin";
        return (
          <CheckInReceiptModal
            variant={variant}
            data={
              {
                reservationNumber: r.reservationNumber,
                checkInDate: r.checkInDate,
                checkOutDate: r.checkOutDate,
                checkedInAt: r.checkedInAt,
                numNights: nights,
                stayType: r.stayType,
                durationHours: durationHours || null,
                numAdults: r.numAdults,
                numChildren: r.numChildren,
                guest: {
                  fullName: r.guest.fullName,
                  phone: r.guest.phone,
                  idProofType: r.guest.idProofType,
                  idProofLast4: r.guest.idProofLast4,
                  photoUrl: r.guest.photoUrl,
                },
                rooms: r.rooms.map((rm) => ({
                  roomNumber: rm.roomNumber,
                  roomType: rm.roomType,
                  ratePerNight: rm.ratePerNight,
                })),
                subtotal: r.subtotal,
                gstRate: r.gstRate,
                gstAmount: r.gstAmount ?? "",
                grandTotal: r.grandTotal,
                advancePaid: r.advancePaid,
                balanceDue: r.balanceDue,
                latestPayment: {
                  id: pay.id,
                  amount: pay.amount,
                  paymentMethod: pay.paymentMethod,
                  receiptNumber: pay.receiptNumber,
                  paymentDate: pay.paymentDate,
                },
                allPayments: r.payments.map((p) => ({
                  amount: p.amount,
                  paymentDate: p.paymentDate,
                  voided: p.voided,
                  status: p.status,
                })),
                hotel: {
                  name: settingsQ.data.hotelName,
                  address: settingsQ.data.hotelAddress,
                  phone: settingsQ.data.hotelPhone,
                  ownerPhone: settingsQ.data.ownerPhone,
                  gstin: settingsQ.data.hotelGstin,
                  logoUrl: settingsQ.data.hotelLogoUrl ?? "/logo.jpg",
                  checkInTime: settingsQ.data.checkInTime,
                  checkOutTime: settingsQ.data.checkOutTime,
                },
              } satisfies CheckInReceiptData
            }
            onClose={() => setSlipPaymentId(null)}
          />
        );
      })()}

      {editPaymentId && settingsQ.data && (() => {
        const pay = r.payments.find((p) => p.id === editPaymentId);
        if (!pay) return null;
        const variant = r.status === "confirmed" ? "booking_advance" : "checkin";
        return (
          <EditReceiptModal
            paymentId={pay.id}
            variant={variant}
            initial={{
              paymentDate: pay.paymentDate,
              paymentMethod: pay.paymentMethod,
              notes: pay.notes,
            }}
            data={
              {
                reservationNumber: r.reservationNumber,
                checkInDate: r.checkInDate,
                checkOutDate: r.checkOutDate,
                checkedInAt: r.checkedInAt,
                numNights: nights,
                stayType: r.stayType,
                durationHours: durationHours || null,
                numAdults: r.numAdults,
                numChildren: r.numChildren,
                guest: {
                  fullName: r.guest.fullName,
                  phone: r.guest.phone,
                  idProofType: r.guest.idProofType,
                  idProofLast4: r.guest.idProofLast4,
                  photoUrl: r.guest.photoUrl,
                },
                rooms: r.rooms.map((rm) => ({
                  roomNumber: rm.roomNumber,
                  roomType: rm.roomType,
                  ratePerNight: rm.ratePerNight,
                })),
                subtotal: r.subtotal,
                gstRate: r.gstRate,
                gstAmount: r.gstAmount ?? "",
                grandTotal: r.grandTotal,
                advancePaid: r.advancePaid,
                balanceDue: r.balanceDue,
                latestPayment: {
                  id: pay.id,
                  amount: pay.amount,
                  paymentMethod: pay.paymentMethod,
                  receiptNumber: pay.receiptNumber,
                  paymentDate: pay.paymentDate,
                },
                allPayments: r.payments.map((p) => ({
                  amount: p.amount,
                  paymentDate: p.paymentDate,
                  voided: p.voided,
                  status: p.status,
                })),
                hotel: {
                  name: settingsQ.data.hotelName,
                  address: settingsQ.data.hotelAddress,
                  phone: settingsQ.data.hotelPhone,
                  ownerPhone: settingsQ.data.ownerPhone,
                  gstin: settingsQ.data.hotelGstin,
                  logoUrl: settingsQ.data.hotelLogoUrl ?? "/logo.jpg",
                  checkInTime: settingsQ.data.checkInTime,
                  checkOutTime: settingsQ.data.checkOutTime,
                },
              } satisfies CheckInReceiptData
            }
            onClose={() => setEditPaymentId(null)}
            onSaved={invalidate}
          />
        );
      })()}

      {showExtend && (
        <ExtendModal
          reservationId={r.id}
          currentCheckOut={r.checkOutDate}
          currentRate={rooms[0]?.ratePerNight ?? "0"}
          onClose={() => setShowExtend(false)}
          onSaved={() => {
            setShowExtend(false);
            invalidate();
          }}
        />
      )}
      {showLate && (
        <LateCheckoutModal
          reservationId={r.id}
          onClose={() => setShowLate(false)}
          onSaved={() => {
            setShowLate(false);
            invalidate();
          }}
        />
      )}
      {showAddRoom && (
        <AddRoomModal
          reservationId={r.id}
          checkInDate={r.checkInDate}
          checkOutDate={r.checkOutDate}
          existingRoomIds={rooms.map((rm) => rm.id)}
          onClose={() => setShowAddRoom(false)}
          onSaved={() => {
            setShowAddRoom(false);
            invalidate();
          }}
        />
      )}
      {showEditDates && (
        <EditDatesModal
          reservationId={r.id}
          checkInDate={r.checkInDate}
          checkOutDate={r.checkOutDate}
          onClose={() => setShowEditDates(false)}
          onSaved={() => {
            setShowEditDates(false);
            invalidate();
          }}
        />
      )}
      <PdfPreviewModal
        open={!!pdfPreview}
        url={pdfPreview?.url ?? null}
        title={pdfPreview?.title ?? ""}
        filename={pdfPreview?.filename ?? "document.pdf"}
        onClose={() => setPdfPreview(null)}
      />
    </div>
  );
}

function RoomRow(props: {
  reservationId: string;
  room: {
    id: string;
    roomNumber: string;
    roomType: string;
    soldAsType?: string | null;
    displayType?: string;
    ratePerNight: string;
    status?: string;
    hasAc?: boolean;
    hasTv?: boolean;
    hasWifi?: boolean;
  };
  nights: number;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [rate, setRate] = useState(Number(props.room.ratePerNight));
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/reservations/${props.reservationId}/rooms/${props.room.id}`, {
        ratePerNight: rate,
      }),
    onSuccess: () => {
      setEditing(false);
      props.onSaved();
    },
  });
  const status = props.room.status;
  const isHousekeeping =
    status === "dirty" ||
    status === "clean" ||
    status === "inspected" ||
    status === "maintenance" ||
    status === "available";

  const statusBadge =
    status && status !== "occupied" && status !== "reserved"
      ? {
          dirty: "bg-warning/15 text-warning border-warning/30",
          clean: "bg-cream text-brand-dark border-brass/40",
          inspected: "bg-brand/10 text-brand border-brand/30",
          available: "bg-success/10 text-success border-success/30",
          maintenance: "bg-danger/10 text-danger border-danger/30",
        }[status as "dirty" | "clean" | "inspected" | "available" | "maintenance"]
      : null;

  const hasAnyAmenity =
    props.room.hasAc !== undefined ||
    props.room.hasTv !== undefined ||
    props.room.hasWifi !== undefined;

  return (
    <tr>
      <td className="font-mono">
        <div className="flex items-center gap-2">
          {props.room.roomNumber}
          {statusBadge && (
            <span className={`text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border ${statusBadge}`}>
              {status}
            </span>
          )}
        </div>
        {hasAnyAmenity && (
          <div className="flex flex-wrap gap-1 mt-1">
            {props.room.hasAc ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-semibold bg-accentBlue/15 text-accentBlue">
                <Snowflake className="w-2.5 h-2.5" /> AC
              </span>
            ) : (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-semibold bg-gray-200 text-textSecondary">
                Non-AC
              </span>
            )}
            {props.room.hasTv && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-semibold bg-brand-soft text-brand-dark">
                <Tv className="w-2.5 h-2.5" /> TV
              </span>
            )}
            {props.room.hasWifi && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-semibold bg-success/15 text-success">
                <Wifi className="w-2.5 h-2.5" /> Wi-Fi
              </span>
            )}
          </div>
        )}
      </td>
      <td className="capitalize">
        {props.room.displayType ?? props.room.roomType.replace(/_/g, " ")}
      </td>
      <td className="font-mono tabular-nums">
        {editing ? (
          <input
            className="input !h-8 !py-0 w-24"
            type="number"
            min={0}
            step="0.01"
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
          />
        ) : (
          inr(props.room.ratePerNight)
        )}
      </td>
      <td className="font-mono tabular-nums">{inr(rate * props.nights)}</td>
      <td className="text-right">
        <div className="inline-flex gap-1 items-center">
          {isHousekeeping && status && !editing && (
            <RoomActionPopover
              roomId={props.room.id}
              roomNumber={props.room.roomNumber}
              status={status as "dirty" | "clean" | "inspected" | "available" | "maintenance"}
              onChanged={props.onSaved}
              invalidateKeys={[["reservation"], ["dashboard"]]}
              trigger={
                <span
                  className="inline-block !h-7 !px-2 text-xs font-medium rounded-sm border border-borderc bg-surface hover:bg-bg cursor-pointer leading-[1.5rem] capitalize"
                  title="Change room status"
                >
                  Status…
                </span>
              }
            />
          )}
          {props.canEdit && !editing && (
            <button
              className="btn-secondary !h-7 !px-2"
              onClick={() => setEditing(true)}
              title="Edit rate"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          {editing && (
            <>
              <button
                className="btn-secondary !h-7 !px-2 text-xs"
                onClick={() => {
                  setRate(Number(props.room.ratePerNight));
                  setEditing(false);
                }}
              >
                Cancel
              </button>
              <button
                className="btn-primary !h-7 !px-2 text-xs"
                disabled={save.isPending || rate <= 0}
                onClick={() => save.mutate()}
              >
                {save.isPending ? "…" : "Save"}
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function ChargeRow(props: {
  reservationId: string;
  charge: { id: string; description: string; amount: string; gstRate: string; createdAt: string; quantity?: number; rate?: string };
  canEdit: boolean;
  onSaved: () => void;
}) {
  const dialog = useDialog();
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(props.charge.description);
  const [amount, setAmount] = useState(Number(props.charge.amount));
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/reservations/${props.reservationId}/charges/${props.charge.id}`, {
        description,
        quantity: 1,
        rate: amount,
      }),
    onSuccess: () => {
      setEditing(false);
      props.onSaved();
    },
  });
  const del = useMutation({
    mutationFn: () =>
      api.del(`/reservations/${props.reservationId}/charges/${props.charge.id}`),
    onSuccess: props.onSaved,
  });
  return (
    <tr>
      <td>
        {editing ? (
          <input
            className="input !h-8 !py-0"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        ) : (
          props.charge.description
        )}
      </td>
      <td className="tabular-nums">{props.charge.gstRate}%</td>
      <td className="text-xs text-textSecondary">
        {format(new Date(props.charge.createdAt), "dd MMM HH:mm")}
      </td>
      <td className="font-mono tabular-nums">
        {editing ? (
          <input
            className="input !h-8 !py-0 w-24"
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
        ) : (
          inr(props.charge.amount)
        )}
      </td>
      <td className="text-right">
        {props.canEdit && !editing && (
          <div className="inline-flex gap-1">
            <button
              className="btn-secondary !h-7 !px-2"
              onClick={() => setEditing(true)}
              title="Edit"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              className="btn-secondary !h-7 !px-2 text-danger"
              onClick={async () => {
                const ok = await dialog.confirm({
                  title: "Delete charge",
                  message: `Remove "${props.charge.description}" from this reservation?`,
                  okLabel: "Delete",
                  tone: "danger",
                });
                if (ok) del.mutate();
              }}
              title="Delete"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {editing && (
          <div className="inline-flex gap-1">
            <button
              className="btn-secondary !h-7 !px-2 text-xs"
              onClick={() => {
                setDescription(props.charge.description);
                setAmount(Number(props.charge.amount));
                setEditing(false);
              }}
            >
              Cancel
            </button>
            <button
              className="btn-primary !h-7 !px-2 text-xs"
              disabled={save.isPending || amount <= 0 || !description.trim()}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "…" : "Save"}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

function PaymentRow(props: {
  payment: {
    id: string;
    amount: string;
    paymentMethod: string;
    status?: string;
    paymentDate: string;
    notes: string | null;
    receiptNumber: string | null;
    voided?: boolean;
    createdAt: string;
  };
  isAdmin: boolean;
  onSaved: () => void;
  onPrintReceipt: () => void;
  onEdit: () => void;
}) {
  const dialog = useDialog();
  const { toast } = useToast();
  const isPending = props.payment.status === "pending";

  const markReceived = useMutation({
    mutationFn: (chosenMethod: string) =>
      api.post(`/payments/${props.payment.id}/mark-received`, { paymentMethod: chosenMethod }),
    onSuccess: props.onSaved,
    onError: (e: Error) => toast(e.message, "error"),
  });

  const within24h =
    Date.now() - new Date(props.payment.createdAt).getTime() < 24 * 60 * 60 * 1000;

  if (props.payment.voided) {
    return (
      <tr className="opacity-50">
        <td className="line-through">{format(new Date(props.payment.paymentDate), "dd MMM yyyy HH:mm")}</td>
        <td className="capitalize line-through">{props.payment.paymentMethod.replace("_", " ")}</td>
        <td className="text-xs text-danger">VOIDED</td>
        <td className="font-mono tabular-nums line-through">{inr(props.payment.amount)}</td>
        <td></td>
      </tr>
    );
  }

  return (
    <tr>
      <td>{format(new Date(props.payment.paymentDate), "dd MMM yyyy HH:mm")}</td>
      <td className="capitalize">
        <div className="flex items-center gap-2">
          <span>{props.payment.paymentMethod.replace("_", " ")}</span>
          {isPending && (
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold bg-warning/20 text-warning">
              Pending
            </span>
          )}
        </div>
      </td>
      <td className="font-mono text-xs">
        <div>
          {props.payment.receiptNumber && (
            <div className="text-[10px] text-navy">{props.payment.receiptNumber}</div>
          )}
          <div className="text-textSecondary">{props.payment.notes ?? ""}</div>
        </div>
      </td>
      <td className="font-mono tabular-nums">{inr(props.payment.amount)}</td>
      <td className="text-right">
        <div className="inline-flex gap-1">
            {isPending && (
              <button
                className="!h-7 !px-2 text-xs font-semibold rounded-sm bg-success text-white border-2 border-success hover:opacity-90 inline-flex items-center gap-1"
                onClick={async () => {
                  const chosen = await dialog.prompt({
                    title: "Mark payment received",
                    message: `Confirm collection of ${inr(props.payment.amount)}.`,
                    okLabel: "Mark received",
                    tone: "success",
                    required: true,
                    defaultValue: "cash",
                    options: [
                      { value: "cash", label: "Cash" },
                      { value: "upi", label: "UPI" },
                      { value: "card", label: "Card" },
                      { value: "bank_transfer", label: "Bank transfer" },
                    ],
                  });
                  if (chosen) markReceived.mutate(chosen);
                }}
                disabled={markReceived.isPending}
                title="Mark as received"
              >
                Mark Received
              </button>
            )}
            <button
              className="btn-secondary !h-7 !px-2"
              onClick={props.onPrintReceipt}
              title={`Preview receipt ${props.payment.receiptNumber ?? ""}`}
            >
              <Eye className="w-3.5 h-3.5" />
            </button>
            {props.isAdmin && within24h && (
              <button
                className="btn-secondary !h-7 !px-2"
                onClick={props.onEdit}
                title="Edit receipt (within 24h)"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            {/* Per-payment void removed by product decision — use Cancel
                Reservation if the booking shouldn't have been collected at all.
                Cancel auto-voids associated payments inside one flow. */}
          </div>
      </td>
    </tr>
  );
}

function EditDatesModal(props: {
  reservationId: string;
  checkInDate: string;
  checkOutDate: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [checkInDate, setCheckInDate] = useState(props.checkInDate);
  const [checkOutDate, setCheckOutDate] = useState(props.checkOutDate);
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/reservations/${props.reservationId}/dates`, {
        checkInDate,
        checkOutDate,
      }),
    onSuccess: props.onSaved,
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <ModalShell title="Edit Reservation Dates" onClose={props.onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label block mb-1">Check-in</label>
            <input
              className="input"
              type="date"
              value={checkInDate}
              onChange={(e) => setCheckInDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label block mb-1">Check-out</label>
            <input
              className="input"
              type="date"
              value={checkOutDate}
              onChange={(e) => setCheckOutDate(e.target.value)}
            />
          </div>
        </div>
        <div className="text-xs text-textSecondary">
          Changing dates recalculates subtotal, GST, and balance. Rooms must be available for new dates.
        </div>
        {err && <div className="text-danger text-sm">{err}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={props.onClose}>Cancel</button>
          <button
            className="btn-primary"
            disabled={save.isPending || new Date(checkOutDate) <= new Date(checkInDate)}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Update Dates"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function AddRoomModal(props: {
  reservationId: string;
  checkInDate: string;
  checkOutDate: string;
  existingRoomIds: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const defaultStart = props.checkInDate > today ? props.checkInDate : today;
  const [startDate, setStartDate] = useState(defaultStart);
  const [selectedRoomId, setSelectedRoomId] = useState<string>("");
  const [ratePerNight, setRatePerNight] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const avail = useQuery({
    queryKey: ["availability", startDate, props.checkOutDate],
    queryFn: () =>
      api.get<{ id: string; roomNumber: string; roomType: string; baseRate: string }[]>(
        "/rooms/availability",
        { check_in: startDate, check_out: props.checkOutDate },
      ),
    enabled: startDate < props.checkOutDate,
  });

  const available = (avail.data ?? []).filter((r) => !props.existingRoomIds.includes(r.id));

  const save = useMutation({
    mutationFn: () =>
      api.post(`/reservations/${props.reservationId}/add-room`, {
        roomId: selectedRoomId,
        ratePerNight,
        startDate,
      }),
    onSuccess: props.onSaved,
    onError: (e: Error) => setErr(e.message),
  });

  const selectedRoom = available.find((r) => r.id === selectedRoomId);

  return (
    <ModalShell title="Add Room to Reservation" onClose={props.onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label block mb-1">Start Date</label>
            <input
              className="input"
              type="date"
              min={today < props.checkInDate ? props.checkInDate : today}
              max={props.checkOutDate}
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setSelectedRoomId("");
              }}
            />
          </div>
          <div>
            <label className="label block mb-1">End Date (check-out)</label>
            <input
              className="input bg-bg/50 cursor-not-allowed"
              type="date"
              value={props.checkOutDate}
              disabled
            />
          </div>
        </div>

        <div>
          <label className="label block mb-1.5">Available Rooms</label>
          {avail.isLoading ? (
            <div className="text-sm text-textSecondary py-3">Checking availability…</div>
          ) : available.length === 0 ? (
            <div className="text-sm text-textSecondary py-3">
              No rooms available for this range.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-56 overflow-y-auto pr-1">
              {available.map((rm) => {
                const active = selectedRoomId === rm.id;
                return (
                  <button
                    key={rm.id}
                    type="button"
                    onClick={() => {
                      setSelectedRoomId(rm.id);
                      setRatePerNight(Number(rm.baseRate));
                    }}
                    className={`p-2.5 rounded-sm border-2 text-left transition-colors ${
                      active
                        ? "border-brand-dark bg-brand-soft"
                        : "border-borderc hover:border-brand-dark hover:bg-bg"
                    }`}
                  >
                    <div className="font-mono font-bold text-brand-dark text-sm leading-tight">
                      {rm.roomNumber}
                    </div>
                    <div className="text-[11px] capitalize text-textSecondary mt-0.5 truncate">
                      {rm.roomType}
                    </div>
                    <div className="text-xs font-mono text-textPrimary mt-1">
                      ₹{Number(rm.baseRate).toFixed(0)}/n
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {selectedRoom && (
          <div>
            <label className="label block mb-1">Rate / night (₹)</label>
            <input
              className="input"
              type="number"
              min={0}
              step="0.01"
              value={ratePerNight || ""}
              placeholder="0"
              onChange={(e) => setRatePerNight(Number(e.target.value))}
            />
            <div className="text-xs text-textSecondary mt-1">
              Base rate: ₹{Number(selectedRoom.baseRate).toFixed(0)}/night
            </div>
          </div>
        )}

        {err && <div className="text-danger text-sm">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            className="px-4 h-9 text-sm font-semibold rounded-sm border-2 border-borderc text-textSecondary hover:border-textSecondary hover:text-textPrimary transition-colors"
            onClick={props.onClose}
          >
            Cancel
          </button>
          <button
            className="px-4 h-9 text-sm font-semibold rounded-sm bg-brand-dark text-cream border-2 border-brand-dark hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={!selectedRoomId || ratePerNight <= 0 || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Adding…" : "Add Room"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function ExtendModal(props: {
  reservationId: string;
  currentCheckOut: string;
  currentRate: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const minDate = new Date(new Date(props.currentCheckOut).getTime() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const [newCheckOutDate, setNewCheckOutDate] = useState(minDate);
  const [overrideRate, setOverrideRate] = useState(false);
  const [ratePerNight, setRatePerNight] = useState(Number(props.currentRate));
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api.post(`/reservations/${props.reservationId}/extend`, {
        newCheckOutDate,
        ratePerNight: overrideRate ? ratePerNight : undefined,
      }),
    onSuccess: props.onSaved,
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <ModalShell title="Extend Stay" onClose={props.onClose}>
      <div className="space-y-3">
        <div className="text-sm text-textSecondary">
          Current check-out: <strong>{format(new Date(props.currentCheckOut), "dd MMM yyyy")}</strong>
        </div>
        <div>
          <label className="label block mb-1">New Check-out Date</label>
          <input
            className="input"
            type="date"
            min={minDate}
            value={newCheckOutDate}
            onChange={(e) => setNewCheckOutDate(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="overrideRate"
            checked={overrideRate}
            onChange={(e) => setOverrideRate(e.target.checked)}
          />
          <label htmlFor="overrideRate" className="text-sm">
            Set a different rate for the new night(s)
          </label>
        </div>
        {overrideRate && (
          <div>
            <label className="label block mb-1">Rate / night for the extension (₹)</label>
            <input
              className="input"
              type="number"
              min={0}
              step="0.01"
              value={ratePerNight}
              onChange={(e) => setRatePerNight(Number(e.target.value))}
            />
            {/* Live preview so staff see exactly what the guest pays for
                the extension. Existing nights are NOT re-priced — only
                the new nights bill at this rate. */}
            {(() => {
              const extraNights = Math.max(
                0,
                Math.round(
                  (new Date(newCheckOutDate).getTime() -
                    new Date(props.currentCheckOut).getTime()) /
                    86400000,
                ),
              );
              if (extraNights <= 0) return null;
              return (
                <p className="text-[11px] text-textSecondary mt-1">
                  {extraNights} new night{extraNights === 1 ? "" : "s"} × ₹
                  {ratePerNight.toFixed(2)} = <strong>₹{(extraNights * ratePerNight).toFixed(2)}</strong>.
                  Existing nights stay at ₹{Number(props.currentRate).toFixed(2)}.
                </p>
              );
            })()}
          </div>
        )}
        {err && <div className="text-danger text-sm">{err}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={props.onClose}>Cancel</button>
          <button
            className="btn-primary"
            disabled={!newCheckOutDate || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Extending…" : "Extend"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function LateCheckoutModal(props: {
  reservationId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [hours, setHours] = useState(2);
  const [fee, setFee] = useState(0);
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api.post(`/reservations/${props.reservationId}/late-checkout`, {
        hours,
        fee,
        notes: notes || undefined,
      }),
    onSuccess: props.onSaved,
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <ModalShell title="Late Checkout" onClose={props.onClose}>
      <div className="space-y-3">
        <div className="text-sm text-textSecondary">
          Add a grace period with an optional fee. This adds a charge to the reservation.
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label block mb-1">Extra Hours</label>
            <input
              className="input"
              type="number"
              min={1}
              max={24}
              step="0.5"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label block mb-1">Fee (₹)</label>
            <input
              className="input"
              type="number"
              min={0}
              step="0.01"
              value={fee || ""}
              placeholder="0"
              onChange={(e) => setFee(Number(e.target.value))}
            />
          </div>
        </div>
        <div>
          <label className="label block mb-1">Notes (optional)</label>
          <input
            className="input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Guest requested late checkout…"
          />
        </div>
        {err && <div className="text-danger text-sm">{err}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={props.onClose}>Cancel</button>
          <button
            className="btn-primary"
            disabled={hours <= 0 || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Add Late Checkout"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function ChargeModal(props: {
  reservationId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState(0);
  const [gstRate, setGstRate] = useState(18);
  const [err, setErr] = useState<string | null>(null);
  const idempotencyKey = useMemo(() => newIdempotencyKey(), []);

  const save = useMutation({
    mutationFn: () =>
      api.post(
        `/reservations/${props.reservationId}/charges`,
        { description, quantity: 1, rate: amount, gstRate },
        { idempotencyKey },
      ),
    onSuccess: props.onSaved,
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <ModalShell title="Add Charge" onClose={props.onClose}>
      <div className="space-y-3">
        <div>
          <label className="label block mb-1">Description</label>
          <input
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Laundry, restaurant, extra bed…"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label block mb-1">Amount (₹)</label>
            <input
              className="input"
              type="number"
              min={0}
              step="0.01"
              value={amount || ""}
              placeholder="0"
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label block mb-1">GST %</label>
            <select
              className="input"
              value={gstRate}
              onChange={(e) => setGstRate(Number(e.target.value))}
            >
              <option value={0}>0%</option>
              <option value={5}>5%</option>
              <option value={18}>18%</option>
            </select>
          </div>
        </div>
        {err && <div className="text-danger text-sm">{err}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={props.onClose}>Cancel</button>
          <button
            className="btn-primary"
            disabled={!description || amount <= 0 || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Add Charge"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function PaymentModal(props: {
  reservationId: string;
  balance: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(props.balance);
  const [method, setMethod] = useState<"cash" | "card" | "upi" | "bank_transfer">("cash");
  const [reference, setReference] = useState("");
  const [err, setErr] = useState<string | null>(null);
  // One key per modal mount: double-click → server replays the first
  // response. Closing and reopening the modal generates a fresh key.
  const idempotencyKey = useMemo(() => newIdempotencyKey(), []);

  const save = useMutation({
    mutationFn: () =>
      api.post(
        `/reservations/${props.reservationId}/payments`,
        { amount, paymentMethod: method, notes: reference || undefined },
        { idempotencyKey },
      ),
    onSuccess: props.onSaved,
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <ModalShell title="Record Payment" onClose={props.onClose}>
      <div className="space-y-3">
        <div>
          <label className="label block mb-1">Amount (₹)</label>
          <input
            className="input"
            type="number"
            min={0}
            step="0.01"
            value={amount || ""}
            placeholder="0"
            onChange={(e) => setAmount(Number(e.target.value))}
          />
          <div className="text-xs text-textSecondary mt-1">Balance due: {inr(props.balance)}</div>
        </div>
        <div>
          <label className="label block mb-1">Method</label>
          <select
            className="input"
            value={method}
            onChange={(e) => setMethod(e.target.value as typeof method)}
          >
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="card">Card</option>
            <option value="bank_transfer">Bank Transfer</option>
          </select>
        </div>
        <div>
          <label className="label block mb-1">Reference (optional)</label>
          <input
            className="input"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="UTR / card last4 / cheque #"
          />
        </div>
        {err && <div className="text-danger text-sm">{err}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={props.onClose}>Cancel</button>
          <button
            className="btn-primary"
            disabled={amount <= 0 || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Record"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function CheckoutModal(props: {
  reservationId: string;
  // Human-readable number (e.g. "SLDT-RES-0019") used in payment notes
  // so the Payment History UI on the OTHER reservation reads cleanly
  // instead of showing a raw UUID.
  reservationNumber: string;
  guestId: string;
  balance: number;
  onClose: () => void;
  onDone: () => void;
}) {
  // Pull the guest's previous unpaid balances so we can offer to collect
  // them in the same visit. Two streams:
  //  - `invoices`        : balances on already-issued invoices
  //  - `preInvoiceReservations`: balances on active reservations that
  //    haven't been checked out yet (no invoice issued)
  // We strip out anything tied to the CURRENT reservation since its bill
  // goes through the /check-out route itself.
  const outstandingQ = useQuery({
    queryKey: ["guest-outstanding", props.guestId],
    queryFn: () =>
      api.get<{
        total: number;
        invoices: {
          invoiceId: string;
          invoiceNumber: string;
          reservationId: string;
          reservationNumber: string;
          balanceDue: number;
          issuedAt: string;
        }[];
        preInvoiceReservations: {
          reservationId: string;
          reservationNumber: string;
          balanceDue: number;
          createdAt: string;
        }[];
      }>(`/guests/${props.guestId}/outstanding`),
    staleTime: 30_000,
  });
  // Unified list. Each item carries enough info for the POST to know
  // which endpoint to hit: invoiceId is set when it's a real invoice,
  // null when it's a pre-invoice reservation. Both go through
  // POST /reservations/:reservationId/payments which handles both cases.
  type PreviousItem = {
    kind: "invoice" | "pre_invoice";
    label: string; // "SLDT-INV-0007" or "SLDT-RES-0014 (no invoice yet)"
    reservationId: string;
    reservationNumber: string;
    invoiceId: string | null;
    invoiceNumber: string | null;
    balanceDue: number;
    sortKey: string; // for FIFO oldest-first
  };
  const previousItems: PreviousItem[] = [
    ...(outstandingQ.data?.invoices ?? []).map<PreviousItem>((i) => ({
      kind: "invoice",
      label: i.invoiceNumber,
      reservationId: i.reservationId,
      reservationNumber: i.reservationNumber,
      invoiceId: i.invoiceId,
      invoiceNumber: i.invoiceNumber,
      balanceDue: i.balanceDue,
      sortKey: i.issuedAt,
    })),
    ...(outstandingQ.data?.preInvoiceReservations ?? []).map<PreviousItem>((r) => ({
      kind: "pre_invoice",
      label: r.reservationNumber,
      reservationId: r.reservationId,
      reservationNumber: r.reservationNumber,
      invoiceId: null,
      invoiceNumber: null,
      balanceDue: r.balanceDue,
      sortKey: r.createdAt,
    })),
  ]
    .filter((i) => i.reservationId !== props.reservationId)
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  const previousTotal = +previousItems.reduce((s, i) => s + i.balanceDue, 0).toFixed(2);
  const hasPrevious = previousTotal > 0.009;

  const [collectPrevious, setCollectPrevious] = useState(true);
  const previousToCollect = hasPrevious && collectPrevious ? previousTotal : 0;
  const suggestedTotal = +(Math.max(0, props.balance) + previousToCollect).toFixed(2);

  const [finalAmount, setFinalAmount] = useState(suggestedTotal);
  const [method, setMethod] = useState<"cash" | "card" | "upi" | "bank_transfer" | "unpaid">("cash");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [refundMode, setRefundMode] = useState<"cash" | "credit">("credit");
  const [refundNote, setRefundNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  // Keep the Final Payment auto-suggestion in sync with the checkbox until
  // the staff manually edits it. We detect "manual edit" by whether the
  // amount differs from the last suggested value.
  const [userEdited, setUserEdited] = useState(false);
  useEffect(() => {
    if (!userEdited) setFinalAmount(suggestedTotal);
  }, [suggestedTotal, userEdited]);

  const isUnpaid = method === "unpaid";
  const balanceRemaining = props.balance > 0.009;
  const mightOverpay = props.balance <= 0.009 && !hasPrevious;
  // Split the entered amount between current and previous bills.
  // Rule (decided with the user): apply to CURRENT first, then FIFO oldest
  // previous invoices.
  const currentBillTarget = Math.max(0, props.balance);
  const appliedToCurrent = Math.min(finalAmount, currentBillTarget);
  const remainderForPrevious = Math.max(0, +(finalAmount - appliedToCurrent).toFixed(2));

  // Disable submit if:
  //  - This bill has a balance AND no amount entered.
  //  - This bill has a balance AND method is "unpaid" but no reason note.
  //  - Staff turned on "Collect previous" but picked the unpaid method —
  //    a previous payment can't be recorded as unpaid; that money is
  //    real cash coming in. Surfaced as an inline warning below.
  const collectingPreviousWithUnpaid =
    hasPrevious && collectPrevious && isUnpaid && remainderForPrevious > 0.009;
  const submitDisabled =
    (balanceRemaining && (finalAmount <= 0.009 || (isUnpaid && paymentNotes.trim() === ""))) ||
    collectingPreviousWithUnpaid;

  const act = useMutation({
    mutationFn: async () => {
      // Step 1: check this reservation out. Only the portion that lands
      // against the current bill goes through here.
      const body: Record<string, unknown> = {};
      if (balanceRemaining && appliedToCurrent > 0) {
        body.finalPayment = appliedToCurrent;
        body.paymentMethod = method;
        if (isUnpaid) body.paymentNotes = paymentNotes;
      }
      body.refundMode = refundMode;
      if (refundNote.trim()) body.refundNote = refundNote.trim();
      await api.post(`/reservations/${props.reservationId}/check-out`, body);

      // Step 2: FIFO-distribute any remainder across the previous unpaid
      // items (real invoices + pre-invoice reservations). Both types are
      // posted through POST /reservations/:resId/payments — the server
      // attaches to the invoice if one exists, otherwise it bumps the
      // reservation's advancePaid. Each post gets its own idempotency
      // key so retries don't double-record.
      if (remainderForPrevious > 0.009 && !isUnpaid) {
        let left = remainderForPrevious;
        for (const item of previousItems) {
          if (left <= 0.009) break;
          const slice = Math.min(left, item.balanceDue);
          await api.post(
            `/reservations/${item.reservationId}/payments`,
            {
              amount: slice,
              paymentMethod: method,
              // Human-readable marker. Server scans the notes for this
              // prefix when rendering the companion-footer block on the
              // source reservation's invoice/receipt PDFs. See
              // collectCompanionCollections in routes/invoices.ts.
              notes: `Collected at check-out of ${props.reservationNumber}`,
            },
            { idempotencyKey: newIdempotencyKey() },
          );
          left = +(left - slice).toFixed(2);
        }
      }
    },
    onSuccess: props.onDone,
    onError: (e: Error) => setErr(e.message),
  });

  // Compact "nothing to collect" branch: balance is fully paid AND no
  // previous unpaid bookings. Skip the payment/method form entirely — the
  // only meaningful action is to close the stay and (rarely) handle an
  // overpay refund if charges were recomputed downward at check-out.
  const fullyPaidAlready = !balanceRemaining && !hasPrevious;

  if (fullyPaidAlready) {
    return (
      <ModalShell title="Check Out & Generate Invoice" onClose={props.onClose}>
        <div className="space-y-4">
          <div className="rounded-sm border-2 border-success/40 bg-success/5 p-4 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-success mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold text-success">Bill fully paid</div>
              <div className="text-sm text-textPrimary mt-1">
                Nothing to collect. Closing the stay will generate the final invoice,
                release the room, and complete check-out.
              </div>
            </div>
          </div>

          {err && <div className="text-danger text-sm">{err}</div>}
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={props.onClose}>
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={() => act.mutate()}
              disabled={act.isPending}
            >
              {act.isPending ? "Processing…" : "Complete Check-out"}
            </button>
          </div>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell title="Check Out & Generate Invoice" onClose={props.onClose}>
      <div className="space-y-3">
        <div className="text-sm">
          Generating invoice will finalize all charges and close this stay. Balance before final
          payment: <strong>{inr(props.balance)}</strong>
        </div>

        {hasPrevious && (
          <div className="rounded-sm border-2 border-danger/40 bg-danger/5 p-3 space-y-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 accent-danger"
                checked={collectPrevious}
                onChange={(e) => {
                  setCollectPrevious(e.target.checked);
                  setUserEdited(false);
                }}
              />
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-bold text-danger uppercase tracking-wider text-xs">
                  Previous unpaid balance
                </div>
                <div className="text-textPrimary mt-0.5">
                  Guest also owes{" "}
                  <span className="font-mono font-bold text-danger">{inr(previousTotal)}</span>{" "}
                  from {previousItems.length === 1
                    ? "1 previous booking"
                    : `${previousItems.length} previous bookings`}
                  . Collect along with this checkout?
                </div>
                <ul className="text-xs text-textSecondary mt-1 space-y-0.5">
                  {previousItems.map((it) => (
                    <li
                      key={`${it.kind}-${it.invoiceId ?? it.reservationId}`}
                      className="font-mono"
                    >
                      {it.invoiceNumber ?? it.reservationNumber}
                      {it.invoiceNumber && ` (${it.reservationNumber})`}
                      {it.kind === "pre_invoice" && (
                        <span className="text-textSecondary italic ml-1">
                          · advance (not invoiced yet)
                        </span>
                      )}
                      {" · "}
                      <span className="text-danger">{inr(it.balanceDue)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </label>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label block mb-1">
              Final Payment {balanceRemaining && <span className="text-danger">*</span>}
            </label>
            <input
              className="input"
              type="number"
              min={0}
              step="0.01"
              value={finalAmount || ""}
              placeholder={balanceRemaining ? String(suggestedTotal) : "0"}
              onChange={(e) => {
                setFinalAmount(Number(e.target.value));
                setUserEdited(true);
              }}
              disabled={!balanceRemaining && !hasPrevious}
            />
            {hasPrevious && collectPrevious && finalAmount > 0.009 && (
              <div className="text-[11px] text-textSecondary mt-1 leading-tight">
                Apply: <span className="font-mono">{inr(appliedToCurrent)}</span> to this bill
                {remainderForPrevious > 0.009 && (
                  <>
                    {" + "}
                    <span className="font-mono text-danger">{inr(remainderForPrevious)}</span> to
                    previous
                  </>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="label block mb-1">Method</label>
            <select
              className="input"
              value={method}
              onChange={(e) => setMethod(e.target.value as typeof method)}
              disabled={!balanceRemaining && !hasPrevious}
            >
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="unpaid">Unpaid · Collect later</option>
            </select>
          </div>
        </div>
        {collectingPreviousWithUnpaid && (
          <div className="rounded-sm border border-danger/40 bg-danger/5 p-3 text-xs text-danger">
            Can't record an "unpaid" method while collecting previous balance. Pick Cash / UPI /
            Card / Bank Transfer, or uncheck "Collect previous balance".
          </div>
        )}
        {isUnpaid && (
          <div className="rounded-sm border border-warning/40 bg-warning/5 p-3 space-y-2">
            <div className="text-xs text-warning font-semibold uppercase tracking-wider">
              Unpaid checkout
            </div>
            <div className="text-xs text-textSecondary">
              Invoice will be issued as unpaid. Mark it received from the guest profile or the
              reservation page when the guest pays.
            </div>
            <div>
              <label className="label block mb-1">
                Reason / notes <span className="text-danger">*</span>
              </label>
              <input
                className="input"
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                placeholder="e.g. trusted regular, will pay next visit"
              />
            </div>
          </div>
        )}
        {mightOverpay && (
          <div className="rounded-sm border border-accentBlue/30 bg-accentBlue/5 p-3 space-y-2">
            <div className="text-xs text-accentBlue font-semibold uppercase tracking-wider">
              If guest overpaid (e.g. early check-out)
            </div>
            <div className="text-xs text-textSecondary">
              Charges are recomputed at check-out. If the guest paid more than the actual bill, choose
              how to handle the refund.
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className={`flex items-center gap-2 px-3 py-2 rounded-sm border cursor-pointer ${refundMode === "credit" ? "border-brand bg-brand/5" : "border-borderc"}`}>
                <input
                  type="radio"
                  name="refundMode"
                  checked={refundMode === "credit"}
                  onChange={() => setRefundMode("credit")}
                  className="accent-brand"
                />
                <div className="text-sm">
                  <div className="font-medium">Wallet credit</div>
                  <div className="text-[11px] text-textSecondary">Saved against guest, no expiry</div>
                </div>
              </label>
              <label className={`flex items-center gap-2 px-3 py-2 rounded-sm border cursor-pointer ${refundMode === "cash" ? "border-brand bg-brand/5" : "border-borderc"}`}>
                <input
                  type="radio"
                  name="refundMode"
                  checked={refundMode === "cash"}
                  onChange={() => setRefundMode("cash")}
                  className="accent-brand"
                />
                <div className="text-sm">
                  <div className="font-medium">Cash refund</div>
                  <div className="text-[11px] text-textSecondary">Paid out from cash drawer</div>
                </div>
              </label>
            </div>
            <input
              className="input"
              value={refundNote}
              onChange={(e) => setRefundNote(e.target.value)}
              placeholder="Refund note (optional)"
            />
          </div>
        )}
        {err && <div className="text-danger text-sm">{err}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={props.onClose}>Cancel</button>
          <button
            className="btn-primary"
            onClick={() => act.mutate()}
            disabled={act.isPending || submitDisabled}
          >
            {act.isPending ? "Processing…" : "Complete Check-out"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function formatTime(hhmm: string): string {
  if (!hhmm) return "";
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr);
  const m = mStr ?? "00";
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m.padStart(2, "0")} ${period}`;
}

// Mark an existing booking as complimentary. Reason is required; approver
// is optional. Pure reclassification — no invoice voiding, no payment
// changes. The booking is REMOVED from every revenue surface (Dashboard /
// Revenue / GST / Collections / Room Performance / Reservations list)
// and appears ONLY in the Complimentary report. The guest's URL still
// resolves so the stay history isn't lost.
function MakeCompModal(props: {
  reservationNumber: string;
  grandTotal: string;
  totalPaid: string;
  onClose: () => void;
  onSubmit: (vars: { reason: string; approver?: string }) => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState("");
  const [approver, setApprover] = useState("");
  return (
    <ModalShell title="Make Complimentary" onClose={props.onClose}>
      <div className="space-y-3 text-sm">
        <div className="rounded-sm border border-warning/40 bg-warning/5 p-3 text-xs text-textPrimary leading-snug">
          <div className="font-bold text-warning uppercase tracking-wider text-[10px] mb-1">
            What this does
          </div>
          Moves <strong>{props.reservationNumber}</strong> out of every revenue view —
          Dashboard, Revenue report, GST, Collections, Room Performance, and the main
          Reservations list. It only appears in <strong>Reports → Complimentary</strong>{" "}
          from then on (value <span className="font-mono">{inr(props.grandTotal)}</span>,
          already collected <span className="font-mono">{inr(props.totalPaid)}</span>).
          <div className="mt-2 text-textSecondary">
            No invoices are voided. No payments are touched. The guest's stay history
            still shows the stay. The reservation URL still opens directly.
          </div>
        </div>
        <div>
          <label className="label block mb-1">
            Reason <span className="text-danger">*</span>
          </label>
          <textarea
            className="input !h-auto !py-2 leading-snug resize-y min-h-[64px]"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Owner comp · VIP guest · Compensation for AC failure"
            autoFocus
          />
        </div>
        <div>
          <label className="label block mb-1">Approved by (optional)</label>
          <input
            className="input"
            value={approver}
            onChange={(e) => setApprover(e.target.value)}
            placeholder="Owner name, manager on duty, etc."
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-secondary" onClick={props.onClose} disabled={props.pending}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={props.pending || !reason.trim()}
            onClick={() =>
              props.onSubmit({
                reason: reason.trim(),
                approver: approver.trim() || undefined,
              })
            }
          >
            {props.pending ? "Saving…" : "Mark as Complimentary"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-md w-full max-w-lg p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-navy mb-3">{title}</h2>
        {children}
      </div>
    </div>
  );
}
