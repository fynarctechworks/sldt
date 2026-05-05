import { useMutation, useQuery } from "@tanstack/react-query";
import { addDays, differenceInCalendarDays, format } from "date-fns";
import { ChevronLeft, FileText, ShieldCheck, Snowflake, Upload, X } from "lucide-react";
import { CheckInReceiptModal, type CheckInReceiptData } from "@/components/CheckInReceiptModal";
import { OtpModal } from "@/components/OtpModal";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader } from "@/components/Loader";
import { api } from "@/lib/api";
import { inr } from "@/lib/utils";

interface Guest {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  idProofType: string | null;
  idProofLast4: string | null;
}

interface AvailableRoom {
  id: string;
  roomNumber: string;
  floor: number;
  roomType: string;
  baseRate: string;
  maxOccupancy: number;
  hasAc: boolean;
}

const todayStr = format(new Date(), "yyyy-MM-dd");
const tomorrowStr = format(addDays(new Date(), 1), "yyyy-MM-dd");

function normalizeIndianPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

function formatTime(hhmm: string | undefined | null): string {
  if (!hhmm) return "";
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr);
  const m = mStr ?? "00";
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m.padStart(2, "0")} ${period}`;
}

export default function NewReservation() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectRoomId = searchParams.get("room");
  const preselectGuestId = searchParams.get("guestId");
  const initialMode = searchParams.get("mode") === "walkin" ? "walkin" : "reservation";

  const [mode, setMode] = useState<"reservation" | "walkin">(initialMode);
  const [checkInDate, setCheckInDate] = useState(todayStr);
  const [checkOutDate, setCheckOutDate] = useState(tomorrowStr);
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [purpose, setPurpose] = useState<"business" | "leisure" | "transit" | "other">("leisure");
  const [specialRequests, setSpecialRequests] = useState("");

  const [guestQuery, setGuestQuery] = useState("");
  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);
  const [newGuest, setNewGuest] = useState({
    fullName: "",
    phone: "",
    email: "",
    idProofType: "aadhaar" as "aadhaar" | "pan" | "passport" | "driver_license" | "voter_id",
    idProofNumber: "",
    address: "",
    nationality: "Indian",
  });
  const [useNewGuest, setUseNewGuest] = useState(false);

  const [selectedRooms, setSelectedRooms] = useState<
    { roomId: string; ratePerNight: number; roomNumber: string; soldAsType: string | null; nativeType: string }[]
  >([]);
  const [kycFront, setKycFront] = useState<File | null>(null);
  const [kycBack, setKycBack] = useState<File | null>(null);
  const [bookingSource, setBookingSource] = useState<
    "walkin" | "phone_whatsapp" | "complimentary"
  >("walkin");
  const [creditNotes, setCreditNotes] = useState("");
  const [advance, setAdvance] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<
    "cash" | "card" | "upi" | "bank_transfer" | "cheque"
  >("cash");
  const [error, setError] = useState<string | null>(null);
  const [acFilter, setAcFilter] = useState<"all" | "ac" | "non_ac">("all");
  const [walkInReceipt, setWalkInReceipt] = useState<CheckInReceiptData | null>(null);
  // OTP defaults: on for pre-booking (remote guest), off for walk-in (guest is physically present + KYC done)
  const [requireOtp, setRequireOtp] = useState(false);
  const [otpReservationId, setOtpReservationId] = useState<string | null>(null);
  const pendingPostOtp = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (mode === "walkin" && checkInDate !== todayStr) setCheckInDate(todayStr);
  }, [mode, checkInDate]);

  // Smart default: pre-booking → OTP on (remote guest, verify by phone). Walk-in → off (guest present + KYC).
  useEffect(() => {
    setRequireOtp(mode !== "walkin");
  }, [mode]);

  useEffect(() => {
    if (!preselectGuestId || selectedGuest) return;
    api.get<Guest>(`/guests/${preselectGuestId}`).then(setSelectedGuest).catch(() => {});
  }, [preselectGuestId, selectedGuest]);

  useEffect(() => {
    setBookingSource(mode === "walkin" ? "walkin" : "phone_whatsapp");
  }, [mode]);

  const isCreditBooking = bookingSource === "complimentary";

  const nights = useMemo(() => {
    const d = differenceInCalendarDays(new Date(checkOutDate), new Date(checkInDate));
    return Math.max(0, d);
  }, [checkInDate, checkOutDate]);

  const guestsSearch = useQuery({
    queryKey: ["guests-search", guestQuery],
    queryFn: () => api.get<Guest[]>("/guests", { q: guestQuery }),
    enabled: guestQuery.length >= 2 && !useNewGuest,
  });

  const roomTypesQ = useQuery({
    queryKey: ["room-types-active"],
    queryFn: () => api.get<{ id: string; slug: string; label: string; defaultRate: string }[]>("/settings/room-types"),
  });

  const publicSettings = useQuery({
    queryKey: ["settings-public"],
    queryFn: () => api.get<{ hotelName: string; checkInTime: string; checkOutTime: string } | null>("/settings/public"),
  });

  const availRooms = useQuery({
    queryKey: ["avail", checkInDate, checkOutDate],
    queryFn: () =>
      api.get<AvailableRoom[]>("/rooms/availability", {
        check_in: checkInDate,
        check_out: checkOutDate,
      }),
    enabled: nights > 0,
  });

  useEffect(() => {
    if (!preselectRoomId || !availRooms.data) return;
    const room = availRooms.data.find((r) => r.id === preselectRoomId);
    if (!room) return;
    setSelectedRooms((prev) =>
      prev.some((r) => r.roomId === room.id)
        ? prev
        : [
            ...prev,
            {
              roomId: room.id,
              ratePerNight: Number(room.baseRate),
              roomNumber: room.roomNumber,
              soldAsType: null,
              nativeType: room.roomType,
            },
          ],
    );
  }, [preselectRoomId, availRooms.data]);

  const subtotal = selectedRooms.reduce((a, r) => a + r.ratePerNight * nights, 0);

  const create = useMutation({
    mutationFn: async () => {
      let guestId = selectedGuest?.id;
      if (useNewGuest) {
        const g = await api.post<Guest>("/guests", {
          ...newGuest,
          phone: normalizeIndianPhone(newGuest.phone),
          email: newGuest.email || undefined,
        });
        guestId = g.id;
      }
      if (!guestId) throw new Error("Guest required");

      if (mode === "walkin" && !kycFront) {
        throw new Error("KYC front photo is required for walk-in check-in");
      }
      if (kycFront) {
        const form = new FormData();
        form.append("front", kycFront);
        if (kycBack) form.append("back", kycBack);
        await api.upload(`/guests/${guestId}/kyc`, form);
      }

      const reservation = await api.post<{ id: string }>("/reservations", {
        guestId,
        checkInDate,
        checkOutDate,
        numAdults: adults,
        numChildren: children,
        specialRequests: specialRequests || undefined,
        rooms: selectedRooms.map((r) => ({
          roomId: r.roomId,
          ratePerNight: r.ratePerNight,
          soldAsType: r.soldAsType ?? undefined,
        })),
        advancePaid: isCreditBooking ? 0 : advance > 0 ? advance : 0,
        advancePaymentMethod: isCreditBooking ? undefined : advance > 0 ? paymentMethod : undefined,
        bookingSource,
        creditNotes: isCreditBooking && creditNotes ? creditNotes : undefined,
      });

      if (mode === "walkin") {
        await api.post(`/reservations/${reservation.id}/check-in`);
      }
      return reservation;
    },
    onSuccess: async (res) => {
      // If OTP gating is on, hold the post-action and open the modal first
      const finalize = async () => {
        if (mode !== "walkin") {
          navigate(`/reservations/${res.id}`);
          return;
        }
        await buildAndShowReceipt(res.id);
      };
      if (requireOtp) {
        pendingPostOtp.current = finalize;
        setOtpReservationId(res.id);
        return;
      }
      await finalize();
    },
    onError: (e: Error) => setError(e.message),
  });

  async function buildAndShowReceipt(reservationId: string) {
    if (mode !== "walkin") {
      navigate(`/reservations/${reservationId}`);
      return;
    }
    try {
        const [detail, settings] = await Promise.all([
          api.get<{
            reservationNumber: string;
            checkInDate: string;
            checkOutDate: string;
            checkedInAt: string | null;
            numNights?: number;
            numAdults: number;
            numChildren: number;
            subtotal: string;
            grandTotal: string;
            advancePaid: string;
            balanceDue: string;
            guest: {
              fullName: string;
              phone: string;
              idProofType: string | null;
              idProofLast4: string | null;
            };
            rooms: { roomNumber: string; roomType: string; ratePerNight: string }[];
            payments: {
              amount: string;
              paymentMethod: string;
              receiptNumber: string | null;
              paymentDate: string;
            }[];
          }>(`/reservations/${reservationId}`),
          api.get<{
            hotelName: string;
            hotelAddress: string;
            hotelPhone: string;
            hotelGstin: string;
            hotelLogoUrl: string | null;
            checkInTime: string | null;
            checkOutTime: string | null;
          }>("/settings/public"),
        ]);

        const fallbackNights = Math.max(
          1,
          Math.round(
            (new Date(detail.checkOutDate).getTime() - new Date(detail.checkInDate).getTime()) /
              86400000,
          ),
        );

        setWalkInReceipt({
          reservationId,
          reservationNumber: detail.reservationNumber,
          checkInDate: detail.checkInDate,
          checkOutDate: detail.checkOutDate,
          checkedInAt: detail.checkedInAt,
          numNights: detail.numNights ?? fallbackNights,
          numAdults: detail.numAdults,
          numChildren: detail.numChildren,
          guest: {
            fullName: detail.guest.fullName,
            phone: detail.guest.phone,
            idProofType: detail.guest.idProofType,
            idProofLast4: detail.guest.idProofLast4,
          },
          rooms: detail.rooms.map((r) => ({
            roomNumber: r.roomNumber,
            roomType: r.roomType,
            ratePerNight: r.ratePerNight,
          })),
          subtotal: detail.subtotal,
          grandTotal: detail.grandTotal,
          advancePaid: detail.advancePaid,
          balanceDue: detail.balanceDue,
          latestPayment:
            detail.payments.length > 0
              ? {
                  amount: detail.payments[detail.payments.length - 1]!.amount,
                  paymentMethod: detail.payments[detail.payments.length - 1]!.paymentMethod,
                  receiptNumber: detail.payments[detail.payments.length - 1]!.receiptNumber,
                  paymentDate: detail.payments[detail.payments.length - 1]!.paymentDate,
                }
              : null,
          hotel: {
            name: settings.hotelName,
            address: settings.hotelAddress,
            phone: settings.hotelPhone,
            gstin: settings.hotelGstin,
            logoUrl: settings.hotelLogoUrl ?? "/logo.jpg",
            checkInTime: settings.checkInTime,
            checkOutTime: settings.checkOutTime,
          },
        });
      } catch {
        // If receipt build fails, fall back to navigation
        navigate(`/reservations/${reservationId}`);
      }
  }

  function toggleRoom(room: AvailableRoom) {
    setSelectedRooms((prev) => {
      const exists = prev.find((r) => r.roomId === room.id);
      if (exists) return prev.filter((r) => r.roomId !== room.id);
      return [
        ...prev,
        {
          roomId: room.id,
          ratePerNight: Number(room.baseRate),
          roomNumber: room.roomNumber,
          soldAsType: null,
          nativeType: room.roomType,
        },
      ];
    });
  }

  function updateRate(roomId: string, rate: number) {
    setSelectedRooms((prev) => prev.map((r) => (r.roomId === roomId ? { ...r, ratePerNight: rate } : r)));
  }

  function updateSoldAs(roomId: string, slug: string | null, rate: number | null) {
    setSelectedRooms((prev) =>
      prev.map((r) =>
        r.roomId === roomId ? { ...r, soldAsType: slug, ratePerNight: rate ?? r.ratePerNight } : r,
      ),
    );
  }

  const canSubmit =
    nights > 0 &&
    selectedRooms.length > 0 &&
    (selectedGuest || (useNewGuest && newGuest.fullName && newGuest.phone && newGuest.idProofNumber));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => navigate(-1)} className="btn-secondary !h-9 !px-2">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <h1 className="text-2xl font-bold text-brand-dark">
          {mode === "walkin" ? "Walk-in Check-in" : "Pre-booking"}
        </h1>
        <div className="ml-auto inline-flex rounded-sm border border-borderc overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => setMode("reservation")}
            className={`px-3 py-1.5 transition ${
              mode === "reservation" ? "bg-brand text-cream" : "bg-bg text-textSecondary hover:bg-borderc/40"
            }`}
          >
            Pre-booking
          </button>
          <button
            type="button"
            onClick={() => setMode("walkin")}
            className={`px-3 py-1.5 transition ${
              mode === "walkin" ? "bg-brand text-cream" : "bg-bg text-textSecondary hover:bg-borderc/40"
            }`}
          >
            Walk-in
          </button>
        </div>
      </div>

      {mode === "walkin" && (
        <div className="card bg-accentBlue/5 border-accentBlue/30 text-sm">
          <strong className="text-navy">Walk-in mode:</strong> Check-in is today. KYC documents are
          required, and the reservation will be checked in immediately.
        </div>
      )}

      <div className="card space-y-3">
        <h2 className="font-semibold text-navy">1. Stay Details</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="label block mb-1">Check-in</label>
            <input
              className="input"
              type="date"
              value={checkInDate}
              disabled={mode === "walkin"}
              min={mode === "walkin" ? todayStr : undefined}
              onChange={(e) => setCheckInDate(e.target.value)}
            />
            {publicSettings.data?.checkInTime && (
              <div className="text-[11px] text-textSecondary mt-1">
                at {formatTime(publicSettings.data.checkInTime)} (hotel policy)
              </div>
            )}
          </div>
          <div>
            <label className="label block mb-1">Check-out</label>
            <input
              className="input"
              type="date"
              value={checkOutDate}
              onChange={(e) => setCheckOutDate(e.target.value)}
            />
            {publicSettings.data?.checkOutTime && (
              <div className="text-[11px] text-textSecondary mt-1">
                by {formatTime(publicSettings.data.checkOutTime)} (hotel policy)
              </div>
            )}
          </div>
          <div>
            <label className="label block mb-1">Adults</label>
            <input
              className="input"
              type="number"
              min={1}
              value={adults}
              onChange={(e) => setAdults(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label block mb-1">Children</label>
            <input
              className="input"
              type="number"
              min={0}
              value={children}
              onChange={(e) => setChildren(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label block mb-1">Purpose</label>
            <select
              className="input"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value as typeof purpose)}
            >
              <option value="leisure">Leisure</option>
              <option value="business">Business</option>
              <option value="transit">Transit</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="label block mb-1">Special Requests</label>
            <input
              className="input"
              value={specialRequests}
              onChange={(e) => setSpecialRequests(e.target.value)}
              placeholder="Early check-in, extra bed, etc."
            />
          </div>
        </div>
        <div className="text-sm text-textSecondary">
          Nights: <span className="font-semibold text-navy">{nights}</span>
        </div>
      </div>

      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-navy">2. Guest</h2>
          <div className="flex gap-2 text-xs">
            <button
              onClick={() => setUseNewGuest(false)}
              className={`px-3 py-1 rounded-sm ${!useNewGuest ? "bg-navy text-white" : "bg-gray-100"}`}
            >
              Existing
            </button>
            <button
              onClick={() => {
                setUseNewGuest(true);
                setSelectedGuest(null);
              }}
              className={`px-3 py-1 rounded-sm ${useNewGuest ? "bg-navy text-white" : "bg-gray-100"}`}
            >
              New Guest
            </button>
          </div>
        </div>

        {!useNewGuest ? (
          <>
            <input
              className="input"
              placeholder="Search by phone or name (min 2 chars)"
              value={guestQuery}
              onChange={(e) => setGuestQuery(e.target.value)}
            />
            {selectedGuest && (
              <div className="bg-success/10 p-3 rounded-sm text-sm">
                Selected: <strong>{selectedGuest.fullName}</strong> ({selectedGuest.phone})
                <button
                  className="ml-3 text-xs text-danger hover:underline"
                  onClick={() => setSelectedGuest(null)}
                >
                  Clear
                </button>
              </div>
            )}
            {guestsSearch.data && guestsSearch.data.length > 0 && !selectedGuest && (
              <div className="max-h-48 overflow-auto border rounded-sm">
                {guestsSearch.data.map((g) => (
                  <button
                    key={g.id}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b last:border-b-0 text-sm"
                    onClick={() => setSelectedGuest(g)}
                  >
                    <div className="font-medium">{g.fullName}</div>
                    <div className="text-xs text-textSecondary">{g.phone}</div>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label block mb-1">Full Name</label>
              <input
                className="input"
                value={newGuest.fullName}
                onChange={(e) => setNewGuest({ ...newGuest, fullName: e.target.value })}
              />
            </div>
            <div>
              <label className="label block mb-1">Phone</label>
              <input
                className="input"
                value={newGuest.phone}
                onChange={(e) => setNewGuest({ ...newGuest, phone: e.target.value })}
                placeholder="+91 98765 43210"
              />
            </div>
            <div>
              <label className="label block mb-1">Email</label>
              <input
                className="input"
                value={newGuest.email}
                onChange={(e) => setNewGuest({ ...newGuest, email: e.target.value })}
              />
            </div>
            <div>
              <label className="label block mb-1">Nationality</label>
              <input
                className="input"
                value={newGuest.nationality}
                onChange={(e) => setNewGuest({ ...newGuest, nationality: e.target.value })}
              />
            </div>
            <div>
              <label className="label block mb-1">ID Type</label>
              <select
                className="input"
                value={newGuest.idProofType}
                onChange={(e) =>
                  setNewGuest({ ...newGuest, idProofType: e.target.value as typeof newGuest.idProofType })
                }
              >
                <option value="aadhaar">Aadhaar</option>
                <option value="pan">PAN</option>
                <option value="passport">Passport</option>
                <option value="driver_license">Driver License</option>
                <option value="voter_id">Voter ID</option>
              </select>
            </div>
            <div>
              <label className="label block mb-1">ID Number</label>
              <input
                className="input"
                value={newGuest.idProofNumber}
                onChange={(e) => setNewGuest({ ...newGuest, idProofNumber: e.target.value })}
              />
            </div>
            <div className="col-span-2">
              <label className="label block mb-1">Address</label>
              <input
                className="input"
                value={newGuest.address}
                onChange={(e) => setNewGuest({ ...newGuest, address: e.target.value })}
              />
            </div>
          </div>
        )}
      </div>

      <div className="card space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-accentBlue" />
          <h2 className="font-semibold text-navy">
            KYC Documents {mode === "walkin" ? "(required)" : "(optional now, required at check-in)"}
          </h2>
        </div>
        <div className="text-xs text-textSecondary -mt-1">
          {mode === "walkin"
            ? "Walk-in guests must upload a government ID photo now. Check-in cannot proceed without it."
            : "Upload a clear photo of the guest's government ID. You can skip now and upload later, but check-in will be blocked until KYC is verified."}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <KycFilePicker label="Front" file={kycFront} onChange={setKycFront} required={mode === "walkin"} />
          <KycFilePicker label="Back" file={kycBack} onChange={setKycBack} />
        </div>
      </div>

      <div className="card space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="font-semibold text-navy">3. Rooms</h2>
          {availRooms.data && availRooms.data.length > 0 && (
            <div className="inline-flex rounded-sm border border-borderc overflow-hidden text-xs">
              {(["all", "ac", "non_ac"] as const).map((opt) => {
                const count =
                  opt === "all"
                    ? availRooms.data!.length
                    : opt === "ac"
                    ? availRooms.data!.filter((r) => r.hasAc).length
                    : availRooms.data!.filter((r) => !r.hasAc).length;
                const label = opt === "all" ? "All" : opt === "ac" ? "AC" : "Non-AC";
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setAcFilter(opt)}
                    className={`px-3 py-1.5 transition ${
                      acFilter === opt
                        ? "bg-navy text-white"
                        : "bg-bg text-textSecondary hover:bg-borderc/40"
                    }`}
                  >
                    {label} <span className="opacity-70">({count})</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {nights === 0 ? (
          <div className="text-textSecondary text-sm">Select valid dates to see available rooms.</div>
        ) : availRooms.isLoading ? (
          <Loader label="Loading availability…" size="sm" />
        ) : !availRooms.data?.length ? (
          <div className="text-danger text-sm">No rooms available for these dates.</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {availRooms.data
              .filter((r) =>
                acFilter === "all" ? true : acFilter === "ac" ? r.hasAc : !r.hasAc,
              )
              .map((r) => {
              const selected = selectedRooms.find((s) => s.roomId === r.id);
              return (
                <div
                  key={r.id}
                  className={`border rounded-sm p-3 cursor-pointer transition ${
                    selected ? "border-accentBlue bg-accentBlue/5" : "border-borderc hover:border-navy"
                  }`}
                  onClick={() => toggleRoom(r)}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="font-mono font-bold">{r.roomNumber}</div>
                        {r.hasAc ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-semibold bg-accentBlue/15 text-accentBlue">
                            <Snowflake className="w-3 h-3" /> AC
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-semibold bg-gray-200 text-textSecondary">
                            Non-AC
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-textSecondary capitalize mt-0.5">
                        {r.roomType.replace(/_/g, " ")} · Floor {r.floor}
                      </div>
                    </div>
                    <div className="text-sm font-mono">{inr(r.baseRate)}</div>
                  </div>
                  {selected && (
                    <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                      <div>
                        <label className="label block mb-1">Sell as</label>
                        <select
                          className="input !h-8 text-sm"
                          value={selected.soldAsType ?? ""}
                          onChange={(e) => {
                            const slug = e.target.value || null;
                            const t = roomTypesQ.data?.find((x) => x.slug === slug);
                            updateSoldAs(r.id, slug, t ? Number(t.defaultRate) : null);
                          }}
                        >
                          <option value="">{selected.nativeType.replace(/_/g, " ")} (native)</option>
                          {roomTypesQ.data
                            ?.filter((t) => t.slug !== selected.nativeType)
                            .map((t) => (
                              <option key={t.id} value={t.slug}>
                                {t.label} ({inr(t.defaultRate)})
                              </option>
                            ))}
                        </select>
                      </div>
                      <div>
                        <label className="label block mb-1">Rate/night</label>
                        <input
                          className="input !h-8 text-sm"
                          type="number"
                          value={selected.ratePerNight}
                          onChange={(e) => updateRate(r.id, Number(e.target.value))}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold text-brand-dark">4. Booking Source</h2>
        <div className="grid grid-cols-3 gap-2">
          {([
            { v: "walkin", label: "Walk-in" },
            { v: "phone_whatsapp", label: "Phone / WhatsApp" },
            { v: "complimentary", label: "Complimentary" },
          ] as const).map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => setBookingSource(opt.v)}
              className={`px-3 py-2 rounded-sm border-2 text-sm font-medium transition ${
                bookingSource === opt.v
                  ? "bg-brand text-cream border-brand"
                  : "bg-bg text-textSecondary border-borderc hover:border-brand/60"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {isCreditBooking && (
          <>
            <div className="text-xs text-warning bg-warning/5 border border-warning/30 rounded-sm px-3 py-2">
              This stay is marked <strong>complimentary</strong>. It will be excluded from
              revenue reports and logged separately.
            </div>
            <div>
              <label className="label block mb-1">
                Complimentary notes (who authorized, purpose, etc.)
              </label>
              <input
                className="input"
                value={creditNotes}
                onChange={(e) => setCreditNotes(e.target.value)}
                placeholder="Owner approved · corporate stay · staff training…"
              />
            </div>
          </>
        )}

        <label className="flex items-start gap-3 px-3 py-2.5 border border-borderc rounded-sm bg-bg cursor-pointer hover:border-brand/40 select-none">
          <input
            type="checkbox"
            checked={requireOtp}
            onChange={(e) => setRequireOtp(e.target.checked)}
            className="w-4 h-4 mt-0.5 accent-brand"
          />
          <div className="text-sm">
            <div className="font-medium text-textPrimary">Verify guest by OTP before receipt</div>
            <div className="text-xs text-textSecondary mt-0.5">
              {mode === "walkin"
                ? "Off by default for walk-ins (guest is present + KYC done). Enable for extra verification."
                : "Recommended for pre-bookings. A code is sent to the guest's phone or email and must be entered before the booking is finalised."}
            </div>
          </div>
        </label>
      </div>

      {!isCreditBooking && (
        <div className="card space-y-3">
          <h2 className="font-semibold text-navy">5. Advance Payment (optional)</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label block mb-1">Amount (₹)</label>
              <input
                className="input"
                type="number"
                min={0}
                value={advance}
                onChange={(e) => setAdvance(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label block mb-1">Method</label>
              <select
                className="input"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)}
              >
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="cheque">Cheque</option>
              </select>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex justify-between text-sm">
          <span>Subtotal ({nights} × {selectedRooms.length} room{selectedRooms.length === 1 ? "" : "s"})</span>
          <span className="font-mono">{inr(subtotal)}</span>
        </div>
        <div className="flex justify-between text-xs text-textSecondary mt-1">
          <span>+ GST (calculated at check-out based on slab)</span>
        </div>
        {error && <div className="text-danger text-sm mt-3">{error}</div>}
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-secondary" onClick={() => navigate(-1)}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={!canSubmit || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending
              ? mode === "walkin"
                ? "Checking in…"
                : "Creating…"
              : mode === "walkin"
                ? "Check In Now"
                : "Create Reservation"}
          </button>
        </div>
      </div>

      {walkInReceipt && (
        <CheckInReceiptModal
          data={walkInReceipt}
          onClose={() => {
            const id = walkInReceipt.reservationId;
            setWalkInReceipt(null);
            navigate(id ? `/reservations/${id}` : "/reservations");
          }}
        />
      )}

      <OtpModal
        reservationId={otpReservationId ?? ""}
        open={!!otpReservationId}
        onClose={() => {
          // Cancel: leave reservation as created but skip OTP and continue
          const cb = pendingPostOtp.current;
          pendingPostOtp.current = null;
          setOtpReservationId(null);
          cb?.();
        }}
        onVerified={() => {
          const cb = pendingPostOtp.current;
          pendingPostOtp.current = null;
          setOtpReservationId(null);
          cb?.();
        }}
      />
    </div>
  );
}

function KycFilePicker({
  label,
  file,
  onChange,
  required = false,
}: {
  label: string;
  file: File | null;
  onChange: (f: File | null) => void;
  required?: boolean;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const isPdf = file?.type === "application/pdf";
  const sizeKb = file ? Math.round(file.size / 1024) : 0;
  const inputId = `kyc-${label.toLowerCase()}`;

  return (
    <div>
      <label htmlFor={inputId} className="label block mb-1">
        {label}
        {required && !file && <span className="text-danger ml-1">*</span>}
        {file && <span className="text-success ml-1">✓</span>}
      </label>

      <input
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="hidden"
      />

      {!file ? (
        <label
          htmlFor={inputId}
          className="flex flex-col items-center justify-center gap-1.5 h-32 border-2 border-dashed border-borderc rounded-md cursor-pointer hover:border-brand hover:bg-brand-soft/30 transition-colors text-textSecondary"
        >
          <Upload className="w-5 h-5" />
          <div className="text-xs">Click to upload {label.toLowerCase()}</div>
          <div className="text-[10px] text-textSecondary/70">JPG, PNG, WebP or PDF</div>
        </label>
      ) : (
        <div className="border border-borderc rounded-md overflow-hidden bg-surface">
          <div className="relative h-32 bg-bg flex items-center justify-center">
            {previewUrl ? (
              <img src={previewUrl} alt={label} className="max-h-full max-w-full object-contain" />
            ) : isPdf ? (
              <div className="flex flex-col items-center gap-1 text-textSecondary">
                <FileText className="w-7 h-7 text-brand" />
                <div className="text-xs font-mono">PDF document</div>
              </div>
            ) : (
              <div className="text-xs text-textSecondary">No preview</div>
            )}
            <button
              type="button"
              onClick={() => onChange(null)}
              className="absolute top-1.5 right-1.5 grid place-items-center w-6 h-6 rounded-full bg-surface border border-borderc text-textSecondary hover:text-danger hover:border-danger"
              aria-label="Remove"
              title="Remove"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px] border-t border-borderc">
            <div className="truncate text-textSecondary" title={file.name}>
              {file.name}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-textSecondary/70">{sizeKb} KB</span>
              <label htmlFor={inputId} className="text-brand cursor-pointer hover:underline">
                Replace
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
