import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  BedDouble,
  CalendarPlus,
  ChevronLeft,
  Clock,
  CreditCard,
  FileDown,
  Pencil,
  Plus,
  Printer,
  Receipt,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { CheckInReceiptModal, type CheckInReceiptData } from "@/components/CheckInReceiptModal";
import { KycModal } from "@/components/KycModal";
import { Loader } from "@/components/Loader";
import { OtpModal } from "@/components/OtpModal";
import { RoomActionPopover } from "@/components/RoomActionPopover";
import { StatusBadge } from "@/components/StatusBadge";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { inr } from "@/lib/utils";

interface Detail {
  id: string;
  reservationNumber: string;
  guestId: string;
  checkInDate: string;
  checkOutDate: string;
  numNights?: number;
  numAdults: number;
  numChildren: number;
  status: string;
  checkedInAt: string | null;
  specialRequests: string | null;
  subtotal: string;
  grandTotal: string;
  advancePaid: string;
  balanceDue: string;
  gstRate: string;
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
  };
  rooms: {
    id: string;
    roomNumber: string;
    roomType: string;
    ratePerNight: string;
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
  const qc = useQueryClient();
  const { profile } = useAuth();
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
        hotelGstin: string;
        hotelLogoUrl: string | null;
        checkInTime: string | null;
        checkOutTime: string | null;
      }>("/settings/public"),
    staleTime: 5 * 60 * 1000,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["reservation", id] });
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
    mutationFn: (reason: string) => api.post(`/reservations/${id}/cancel`, { reason }),
    onSuccess: invalidate,
    onError: (e: Error) => setErr(e.message),
  });

  async function downloadPdf(invoiceId: string, invoiceNumber: string) {
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    const res = await fetch(
      `${import.meta.env.VITE_API_URL}/invoices/${invoiceId}/pdf`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    if (!res.ok) {
      setErr(`PDF download failed (${res.status})`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${invoiceNumber}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadReceipt(paymentId: string, receiptNumber: string | null) {
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    const res = await fetch(
      `${import.meta.env.VITE_API_URL}/payments/${paymentId}/receipt`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    if (!res.ok) {
      setErr(`Receipt download failed (${res.status})`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${receiptNumber ?? "receipt-" + paymentId.slice(0, 8)}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
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
  const totalPaid = (Number(r.grandTotal) - Number(r.balanceDue)).toFixed(2);
  const kycVerified = !!guest?.kycVerifiedAt && !!guest?.idProofPhotoFront;
  const canCheckIn = r.status === "confirmed" && kycVerified;
  const canCheckOut = r.status === "checked_in";
  const canCancel = r.status === "confirmed" || r.status === "checked_in";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="btn-secondary !h-9 !px-2">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <h1 className="text-2xl font-bold text-navy font-mono">{r.reservationNumber}</h1>
        <StatusBadge status={r.status} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card">
          <div className="label">Guest</div>
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
        <div className="card">
          <div className="label">Dates</div>
          <div className="text-sm">
            <div>
              <strong>In:</strong> {format(new Date(r.checkInDate), "dd MMM yyyy")}{" "}
              <span className="text-textSecondary">· {formatTime(r.hotelCheckInTime)}</span>
            </div>
            <div>
              <strong>Out:</strong> {format(new Date(r.checkOutDate), "dd MMM yyyy")}{" "}
              <span className="text-textSecondary">· {formatTime(r.hotelCheckOutTime)}</span>
            </div>
            <div className="text-textSecondary text-xs mt-1">
              {nights} night{nights === 1 ? "" : "s"}
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
            onClick={() => setShowOtp(true)}
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
        {canCancel && (
          <button
            className="btn-danger inline-flex items-center gap-2"
            onClick={() => {
              const reason = prompt("Cancellation reason?");
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
              <th className="text-right">Rate/night</th>
              <th className="text-right">Total ({nights}n)</th>
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
                <th>GST%</th>
                <th>Added</th>
                <th className="text-right">Amount</th>
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
                onClick={() => downloadPdf(invoice.id, invoice.invoiceNumber)}
              >
                <FileDown className="w-4 h-4" /> PDF
              </button>
              {profile?.role === "admin" && invoice.status !== "voided" && (
                <>
                  <button
                    className="btn-secondary"
                    onClick={async () => {
                      const reason = prompt("Reissue reason (correction)?");
                      if (!reason) return;
                      try {
                        await api.post(`/invoices/${invoice.id}/reissue`, { reason });
                        invalidate();
                      } catch (e: unknown) {
                        setErr((e as Error).message);
                      }
                    }}
                  >
                    Reissue
                  </button>
                  <button
                    className="btn-danger"
                    onClick={async () => {
                      const reason = prompt("Void reason?");
                      if (!reason) return;
                      try {
                        await api.post(`/invoices/${invoice.id}/void`, { reason });
                        invalidate();
                      } catch (e: unknown) {
                        setErr((e as Error).message);
                      }
                    }}
                  >
                    Void
                  </button>
                </>
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
                <th className="text-right">Amount</th>
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
                  onPrintReceipt={() => downloadReceipt(p.id, p.receiptNumber)}
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

      {showCheckInReceipt && settingsQ.data && (
        <CheckInReceiptModal
          data={
            {
              reservationNumber: r.reservationNumber,
              checkInDate: r.checkInDate,
              checkOutDate: r.checkOutDate,
              checkedInAt: r.checkedInAt,
              numNights: nights,
              numAdults: r.numAdults,
              numChildren: r.numChildren,
              guest: {
                fullName: r.guest.fullName,
                phone: r.guest.phone,
                idProofType: r.guest.idProofType,
                idProofLast4: r.guest.idProofLast4,
              },
              rooms: r.rooms.map((rm) => ({
                roomNumber: rm.roomNumber,
                roomType: rm.roomType,
                ratePerNight: rm.ratePerNight,
              })),
              subtotal: r.subtotal,
              grandTotal: r.grandTotal,
              advancePaid: r.advancePaid,
              balanceDue: r.balanceDue,
              latestPayment:
                r.payments.length > 0
                  ? {
                      amount: r.payments[r.payments.length - 1]!.amount,
                      paymentMethod: r.payments[r.payments.length - 1]!.paymentMethod,
                      receiptNumber: r.payments[r.payments.length - 1]!.receiptNumber,
                      paymentDate: r.payments[r.payments.length - 1]!.paymentDate,
                    }
                  : null,
              hotel: {
                name: settingsQ.data.hotelName,
                address: settingsQ.data.hotelAddress,
                phone: settingsQ.data.hotelPhone,
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
    </div>
  );
}

function RoomRow(props: {
  reservationId: string;
  room: { id: string; roomNumber: string; roomType: string; ratePerNight: string; status?: string };
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
      </td>
      <td className="capitalize">{props.room.roomType}</td>
      <td className="text-right font-mono">
        {editing ? (
          <input
            className="input !h-8 !py-0 w-24 text-right"
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
      <td className="text-right font-mono">{inr(rate * props.nights)}</td>
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
      <td>{props.charge.gstRate}%</td>
      <td className="text-xs text-textSecondary">
        {format(new Date(props.charge.createdAt), "dd MMM HH:mm")}
      </td>
      <td className="text-right font-mono">
        {editing ? (
          <input
            className="input !h-8 !py-0 w-24 text-right"
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
              onClick={() => {
                if (confirm(`Delete charge "${props.charge.description}"?`)) del.mutate();
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
    paymentDate: string;
    notes: string | null;
    receiptNumber: string | null;
    voided?: boolean;
    createdAt: string;
  };
  isAdmin: boolean;
  onSaved: () => void;
  onPrintReceipt: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [paymentDate, setPaymentDate] = useState(
    new Date(props.payment.paymentDate).toISOString().slice(0, 16),
  );
  const [method, setMethod] = useState(props.payment.paymentMethod);
  const [notes, setNotes] = useState(props.payment.notes ?? "");

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/payments/${props.payment.id}`, {
        paymentDate: new Date(paymentDate).toISOString(),
        paymentMethod: method,
        notes: notes || null,
      }),
    onSuccess: () => {
      setEditing(false);
      props.onSaved();
    },
  });

  const voidPay = useMutation({
    mutationFn: (reason: string) => api.post(`/payments/${props.payment.id}/void`, { reason }),
    onSuccess: props.onSaved,
  });

  const within24h =
    Date.now() - new Date(props.payment.createdAt).getTime() < 24 * 60 * 60 * 1000;

  if (props.payment.voided) {
    return (
      <tr className="opacity-50">
        <td className="line-through">{format(new Date(props.payment.paymentDate), "dd MMM yyyy HH:mm")}</td>
        <td className="capitalize line-through">{props.payment.paymentMethod.replace("_", " ")}</td>
        <td className="text-xs text-danger">VOIDED</td>
        <td className="text-right font-mono line-through">{inr(props.payment.amount)}</td>
        <td></td>
      </tr>
    );
  }

  return (
    <tr>
      <td>
        {editing ? (
          <input
            className="input !h-8 !py-0"
            type="datetime-local"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
          />
        ) : (
          format(new Date(props.payment.paymentDate), "dd MMM yyyy HH:mm")
        )}
      </td>
      <td className="capitalize">
        {editing ? (
          <select
            className="input !h-8 !py-0"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="card">Card</option>
            <option value="bank_transfer">Bank Transfer</option>
            <option value="cheque">Cheque</option>
          </select>
        ) : (
          props.payment.paymentMethod.replace("_", " ")
        )}
      </td>
      <td className="font-mono text-xs">
        {editing ? (
          <input
            className="input !h-8 !py-0"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="UTR, last4, etc."
          />
        ) : (
          <div>
            {props.payment.receiptNumber && (
              <div className="text-[10px] text-navy">{props.payment.receiptNumber}</div>
            )}
            <div className="text-textSecondary">{props.payment.notes ?? ""}</div>
          </div>
        )}
      </td>
      <td className="text-right font-mono">{inr(props.payment.amount)}</td>
      <td className="text-right">
        {!editing && (
          <div className="inline-flex gap-1">
            <button
              className="btn-secondary !h-7 !px-2"
              onClick={props.onPrintReceipt}
              title={`Download receipt ${props.payment.receiptNumber ?? ""}`}
            >
              <Printer className="w-3.5 h-3.5" />
            </button>
            {props.isAdmin && within24h && (
              <button
                className="btn-secondary !h-7 !px-2"
                onClick={() => setEditing(true)}
                title="Edit (within 24h)"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            {props.isAdmin && (
              <button
                className="btn-secondary !h-7 !px-2 text-danger"
                onClick={() => {
                  const reason = prompt("Void reason?");
                  if (reason) voidPay.mutate(reason);
                }}
                title="Void"
              >
                <XCircle className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
        {editing && (
          <div className="inline-flex gap-1">
            <button
              className="btn-secondary !h-7 !px-2 text-xs"
              onClick={() => {
                setPaymentDate(new Date(props.payment.paymentDate).toISOString().slice(0, 16));
                setMethod(props.payment.paymentMethod);
                setNotes(props.payment.notes ?? "");
                setEditing(false);
              }}
            >
              Cancel
            </button>
            <button
              className="btn-primary !h-7 !px-2 text-xs"
              disabled={save.isPending}
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
      <div className="space-y-3">
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
            <label className="label block mb-1">End Date (reservation check-out)</label>
            <input className="input" type="date" value={props.checkOutDate} disabled />
          </div>
        </div>

        <div>
          <label className="label block mb-1">Available Rooms</label>
          {avail.isLoading ? (
            <div className="text-sm text-textSecondary">Checking availability…</div>
          ) : available.length === 0 ? (
            <div className="text-sm text-textSecondary">No rooms available for this range.</div>
          ) : (
            <div className="grid grid-cols-3 gap-2 max-h-52 overflow-y-auto">
              {available.map((rm) => (
                <button
                  key={rm.id}
                  type="button"
                  onClick={() => {
                    setSelectedRoomId(rm.id);
                    setRatePerNight(Number(rm.baseRate));
                  }}
                  className={`p-2 rounded border text-left ${
                    selectedRoomId === rm.id
                      ? "border-navy bg-navy/5"
                      : "border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  <div className="font-mono font-bold text-navy">{rm.roomNumber}</div>
                  <div className="text-xs capitalize text-textSecondary">{rm.roomType}</div>
                  <div className="text-xs font-mono">₹{Number(rm.baseRate).toFixed(0)}/n</div>
                </button>
              ))}
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
              value={ratePerNight}
              onChange={(e) => setRatePerNight(Number(e.target.value))}
            />
            <div className="text-xs text-textSecondary mt-1">
              Base rate: ₹{Number(selectedRoom.baseRate).toFixed(0)}
            </div>
          </div>
        )}

        {err && <div className="text-danger text-sm">{err}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={props.onClose}>Cancel</button>
          <button
            className="btn-primary"
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
          <label htmlFor="overrideRate" className="text-sm">Override rate per night</label>
        </div>
        {overrideRate && (
          <div>
            <label className="label block mb-1">Rate / night (₹)</label>
            <input
              className="input"
              type="number"
              min={0}
              step="0.01"
              value={ratePerNight}
              onChange={(e) => setRatePerNight(Number(e.target.value))}
            />
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
              value={fee}
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

  const save = useMutation({
    mutationFn: () =>
      api.post(`/reservations/${props.reservationId}/charges`, {
        description,
        amount,
        gstRate,
      }),
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
              value={amount}
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
  const [method, setMethod] = useState<"cash" | "card" | "upi" | "bank_transfer" | "cheque">("cash");
  const [reference, setReference] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api.post(`/payments`, {
        reservationId: props.reservationId,
        amount,
        paymentMethod: method,
        reference: reference || undefined,
      }),
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
            value={amount}
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
            <option value="cheque">Cheque</option>
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
  balance: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [finalAmount, setFinalAmount] = useState(0);
  const [method, setMethod] = useState<"cash" | "card" | "upi" | "bank_transfer">("cash");
  const [err, setErr] = useState<string | null>(null);

  const act = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      if (finalAmount > 0) {
        body.finalPayment = finalAmount;
        body.paymentMethod = method;
      }
      return api.post(`/reservations/${props.reservationId}/check-out`, body);
    },
    onSuccess: props.onDone,
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <ModalShell title="Check Out & Generate Invoice" onClose={props.onClose}>
      <div className="space-y-3">
        <div className="text-sm">
          Generating invoice will finalize all charges and close this stay. Balance before final
          payment: <strong>{inr(props.balance)}</strong>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label block mb-1">Final Payment (optional)</label>
            <input
              className="input"
              type="number"
              min={0}
              step="0.01"
              value={finalAmount}
              onChange={(e) => setFinalAmount(Number(e.target.value))}
            />
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
        </div>
        {err && <div className="text-danger text-sm">{err}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={props.onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => act.mutate()} disabled={act.isPending}>
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
