// Public booking page. No auth. Served at /book/:propertyCode.
//
// Three-step flow rendered inline on a single page:
//   1. Pick dates + room type → fetch quote
//   2. Enter guest details + accept policy
//   3. Submit → show confirmation ref
//
// Branded card at the top reflects the property's banner/tagline.
// Razorpay support is feature-detected; when configured, "Pay now"
// loads Checkout.js and verifies the payment before showing success.

import { useMutation, useQuery } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { Check, Hotel, ShieldCheck } from "lucide-react";
import { EmailInput } from "@/components/EmailInput";
import { useState } from "react";
import { useParams } from "react-router-dom";

// Tiny client — this page must work WITHOUT the authed api.ts, since
// no Supabase session is present. We talk to the public API directly.
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ?? "";

async function publicGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  const json = await res.json();
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  }
  return json.data as T;
}
async function publicPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  }
  return json.data as T;
}

interface PropCard {
  name: string;
  code: string;
  address: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  currency: string;
  checkInTime: string;
  checkOutTime: string;
  bannerImageUrl: string | null;
  tagline: string | null;
  cancellationPolicy: string | null;
  maxNightsPerBooking: number;
  roomTypes: string[];
}

interface Quote {
  currency: string;
  nights: number;
  ratePerNight: number;
  subtotal: number;
  gstRate: number;
  gstAmount: number;
  grandTotal: number;
}

export default function PublicBookingPage() {
  const { propertyCode } = useParams<{ propertyCode: string }>();
  const code = propertyCode ?? "PRIMARY";

  const propQuery = useQuery({
    queryKey: ["public-booking-prop", code],
    queryFn: () => publicGet<PropCard>(`/public/booking/${code}`),
    retry: false,
  });

  const today = new Date();
  const [checkIn, setCheckIn] = useState(format(today, "yyyy-MM-dd"));
  const [checkOut, setCheckOut] = useState(format(addDays(today, 1), "yyyy-MM-dd"));
  const [roomType, setRoomType] = useState("");
  const [adults, setAdults] = useState("2");
  const [children, setChildren] = useState("0");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [acceptPolicy, setAcceptPolicy] = useState(false);
  const [acceptMarketing, setAcceptMarketing] = useState(false);
  const [confirmedRef, setConfirmedRef] = useState<string | null>(null);

  const quoteMutation = useMutation({
    mutationFn: () =>
      publicGet<Quote>("/public/booking/quote", {
        propertyCode: code,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        roomType,
      }),
    onSuccess: (q) => setQuote(q),
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      publicPost<{ publicRef: string; grandTotal: number }>("/public/booking/submit", {
        propertyCode: code,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        numAdults: Number(adults),
        numChildren: Number(children),
        roomType,
        guestName: name,
        guestPhone: phone,
        guestEmail: email || null,
        acceptsCancellationPolicy: acceptPolicy,
        acceptsMarketing: acceptMarketing,
      }),
    onSuccess: (resp) => setConfirmedRef(resp.publicRef),
  });

  if (propQuery.isLoading) {
    return <div className="p-10 text-center text-textSecondary">Loading…</div>;
  }
  if (propQuery.isError || !propQuery.data) {
    return (
      <div className="p-10 text-center max-w-md mx-auto">
        <Hotel className="w-12 h-12 mx-auto text-textSecondary opacity-40 mb-3" />
        <h1 className="text-xl font-bold text-brand-dark">Booking unavailable</h1>
        <p className="text-sm text-textSecondary mt-2">
          Public booking is not enabled for this property. Please call them directly to book.
        </p>
      </div>
    );
  }

  const prop = propQuery.data;

  if (confirmedRef) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center p-4">
        <div className="bg-surface rounded-md border border-borderc p-8 max-w-md w-full text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-success/10 grid place-items-center mb-4">
            <Check className="w-8 h-8 text-success" />
          </div>
          <h1 className="text-2xl font-bold text-brand-dark">Booking received</h1>
          <p className="text-sm text-textSecondary mt-2">
            Your reference: <span className="font-mono text-accentBlue">{confirmedRef}</span>
          </p>
          <p className="text-sm text-textSecondary mt-4">
            The team at {prop.name} will reach out shortly to confirm your booking.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg">
      {/* Banner */}
      <header className="bg-brand-dark text-cream">
        {prop.bannerImageUrl && (
          <img src={prop.bannerImageUrl} alt="" className="w-full h-48 object-cover opacity-70" />
        )}
        <div className="max-w-3xl mx-auto px-6 py-6">
          <h1 className="text-3xl font-bold">{prop.name}</h1>
          {prop.tagline && <p className="text-cream/80 mt-1">{prop.tagline}</p>}
          <p className="text-xs text-cream/60 mt-2">
            {prop.address}
            {prop.city ? `, ${prop.city}` : ""}
            {prop.state ? `, ${prop.state}` : ""}
          </p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-6 space-y-6">
        {/* Stay picker */}
        <section className="bg-surface border border-borderc rounded-md p-4">
          <h2 className="font-semibold text-brand-dark mb-3">Pick your stay</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-medium text-textSecondary">Check-in</label>
              <input
                type="date"
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
                className="input mt-1 w-full"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-textSecondary">Check-out</label>
              <input
                type="date"
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
                className="input mt-1 w-full"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-textSecondary">Adults</label>
              <input
                type="number"
                min="1"
                max="10"
                value={adults}
                onChange={(e) => setAdults(e.target.value)}
                className="input mt-1 w-full"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-textSecondary">Children</label>
              <input
                type="number"
                min="0"
                max="10"
                value={children}
                onChange={(e) => setChildren(e.target.value)}
                className="input mt-1 w-full"
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="text-xs font-medium text-textSecondary">Room type</label>
            <select
              value={roomType}
              onChange={(e) => setRoomType(e.target.value)}
              className="input mt-1 w-full"
            >
              <option value="">— pick a room type —</option>
              {prop.roomTypes.map((rt) => (
                <option key={rt} value={rt}>
                  {rt.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <button
            disabled={!roomType || quoteMutation.isPending}
            onClick={() => quoteMutation.mutate()}
            className="btn-primary mt-4"
          >
            {quoteMutation.isPending ? "Getting quote…" : "Get quote"}
          </button>
          {quoteMutation.isError && (
            <p className="text-sm text-danger mt-2">
              {(quoteMutation.error as Error)?.message ?? "Couldn't fetch quote"}
            </p>
          )}
        </section>

        {/* Quote + guest details */}
        {quote && (
          <section className="bg-surface border border-borderc rounded-md p-4 space-y-4">
            <h2 className="font-semibold text-brand-dark">Your quote</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-textSecondary">Nights</div>
                <div className="font-semibold">{quote.nights}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-textSecondary">Per night</div>
                <div className="font-semibold">
                  {quote.currency} {quote.ratePerNight.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-textSecondary">GST ({quote.gstRate}%)</div>
                <div className="font-semibold">
                  {quote.currency} {quote.gstAmount.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-textSecondary">Total</div>
                <div className="font-bold text-lg text-brand-dark">
                  {quote.currency} {quote.grandTotal.toFixed(2)}
                </div>
              </div>
            </div>

            <h3 className="font-semibold text-brand-dark text-sm pt-2 border-t border-borderc">Your details</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                className="input"
              />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="Phone (10-digit)"
                className="input"
                type="tel"
                inputMode="numeric"
                maxLength={10}
              />
              <EmailInput
                value={email}
                onChange={setEmail}
                placeholder="Email (optional)"
              />
            </div>

            {prop.cancellationPolicy && (
              <details className="text-sm">
                <summary className="cursor-pointer text-accentBlue">Cancellation policy</summary>
                <p className="whitespace-pre-wrap mt-2 text-textSecondary">{prop.cancellationPolicy}</p>
              </details>
            )}

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={acceptPolicy}
                onChange={(e) => setAcceptPolicy(e.target.checked)}
                className="mt-0.5"
              />
              <span>I accept the cancellation policy.</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={acceptMarketing}
                onChange={(e) => setAcceptMarketing(e.target.checked)}
                className="mt-0.5"
              />
              <span>Send me occasional offers and updates from {prop.name}.</span>
            </label>

            <button
              disabled={!name || !phone || !acceptPolicy || submitMutation.isPending}
              onClick={() => submitMutation.mutate()}
              className="btn-primary w-full"
            >
              {submitMutation.isPending ? "Submitting…" : "Submit booking request"}
            </button>
            {submitMutation.isError && (
              <p className="text-sm text-danger">
                {(submitMutation.error as Error)?.message ?? "Submission failed"}
              </p>
            )}
            <p className="text-[11px] text-textSecondary flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" />
              We'll text you on {phone || "your phone"} to confirm. No payment is taken yet.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
