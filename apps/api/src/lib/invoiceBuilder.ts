// Per-scope invoice builder.
//
// Builds line items + totals for an invoice that covers either:
//   - the FULL reservation (every reservation_room + every charge)
//   - a SUBSET of rooms (per-room invoice — only those rooms, plus
//     additional_charges that target one of those rooms, plus the
//     reservation-wide charges only when this invoice covers the
//     "last" remaining rooms)
//
// All callers go through this so the GST math + line shape are
// identical between the legacy "checkout generates one combined
// invoice" path and the new "per-room invoice" endpoint.

import { combinedRoomTypeLabel, type RoomTypeLabelMap } from "./roomTypeLabel.js";
import { calcGstBreakdown, getGstRate } from "./gst.js";
import type { AdditionalCharge } from "../db/schema/invoices.js";
import type { ReservationRoom } from "../db/schema/reservations.js";
import type { Room } from "../db/schema/rooms.js";

export interface ReservationLike {
  stayType: "overnight" | "short_stay";
  durationHours: string | null;
  checkInDate: string;
  checkOutDate: string;
  numNights: number;
  gstRate: string;
  gstMode: "exclusive" | "inclusive";
}

export interface BuilderArgs {
  reservation: ReservationLike;
  // The rooms IN SCOPE of this invoice. For combined: every
  // reservation_room. For per-room: just the one (or subset).
  rooms: Array<ReservationRoom & { room: Room }>;
  // Charges to include. The caller decides which charges apply (see
  // selectChargesForScope below).
  charges: AdditionalCharge[];
  // Slug → label map for the displayed "Ac Single Bed Rooms" labels.
  labelMap: RoomTypeLabelMap;
  // Per-property GST slab snapshot for additional-charge GST default.
  gstSlab: {
    exemptBelow: number;
    lowRate: number;
    lowMax: number;
    highRate: number;
  };
}

export interface BuiltLineItem {
  description: string;
  sacCode: string;
  quantity: number;
  rate: string;
  amount: string;
  gstRate: string;
  gstAmount: string;
  itemType: "room_charge" | "additional_charge";
}

export interface BuiltInvoice {
  lineItems: BuiltLineItem[];
  subtotal: number;
  totalGst: number;
  cgst: number;
  sgst: number;
  grandTotal: number;
  roomGstRate: number;
}

// Compute the line items + totals for the given scope. GST math
// follows the same exclusive/inclusive rules as the legacy checkout
// path, so per-room invoices produce numbers that sum to the
// combined invoice (give-or-take 1-2 paise rounding per line).
export function buildInvoice(args: BuilderArgs): BuiltInvoice {
  const { reservation, rooms, charges, labelMap, gstSlab } = args;
  const isShort = reservation.stayType === "short_stay";
  const shortStayHours = Number(reservation.durationHours ?? 0);
  // For overnight: priced per night. Short-stay: rate IS the per-room
  // flat short-stay price for the chosen duration; 'quantity' becomes
  // the hour count for display only.
  const nights = Math.max(1, Number(reservation.numNights));
  const roomGstRate = Number(reservation.gstRate);
  const gstMode = reservation.gstMode;

  const lineItems: BuiltLineItem[] = [];
  let subtotal = 0;
  let totalGst = 0;

  for (const rr of rooms) {
    const ratePerNight = Number(rr.ratePerNight);
    const displayType = combinedRoomTypeLabel(
      rr.room.roomType,
      rr.soldAsType ?? null,
      labelMap,
    );
    const roomUnits = isShort ? shortStayHours : nights;
    // The stored rate is per-night (overnight) or flat (short-stay).
    // The user input was either net (exclusive) or gross (inclusive);
    // calcGstBreakdown returns both the net subtotal and the gst.
    const userAmount = isShort ? ratePerNight : ratePerNight * nights;
    const { subtotal: netRoomSubtotal, gstAmount: roomGst } = calcGstBreakdown(
      userAmount,
      roomGstRate,
      gstMode,
    );
    const netRate = isShort ? netRoomSubtotal : netRoomSubtotal / nights;
    subtotal += netRoomSubtotal;
    totalGst += roomGst;
    lineItems.push({
      description: isShort
        ? `Room ${rr.room.roomNumber} - ${displayType} (Day use · ${shortStayHours} hours)`
        : `Room ${rr.room.roomNumber} - ${displayType} (${nights} nights)`,
      sacCode: "996311",
      quantity: roomUnits,
      rate: String(+netRate.toFixed(2)),
      amount: String(+netRoomSubtotal.toFixed(2)),
      gstRate: String(roomGstRate),
      gstAmount: String(+roomGst.toFixed(2)),
      itemType: "room_charge",
    });
  }

  for (const c of charges) {
    const amount = Number(c.amount);
    const gstRate = Number(c.gstRate);
    const gstAmount = +(amount * (gstRate / 100)).toFixed(2);
    subtotal += amount;
    totalGst += gstAmount;
    lineItems.push({
      description: c.description,
      sacCode: "9963",
      quantity: c.quantity,
      rate: String(c.rate),
      amount: String(+amount.toFixed(2)),
      gstRate: String(gstRate),
      gstAmount: String(gstAmount),
      itemType: "additional_charge",
    });
    // Touch gstSlab so importers don't drop it; it's reserved for
    // future "infer GST rate from settings when a charge is added
    // without one" logic.
    void gstSlab;
    void getGstRate;
  }

  subtotal = +subtotal.toFixed(2);
  totalGst = +totalGst.toFixed(2);
  const cgst = +(totalGst / 2).toFixed(2);
  const sgst = +(totalGst - cgst).toFixed(2);
  const grandTotal = +(subtotal + totalGst).toFixed(2);

  return { lineItems, subtotal, totalGst, cgst, sgst, grandTotal, roomGstRate };
}

// Pick which charges belong on a per-room invoice. Rules:
//   - charges with room_id IN the scope rooms → always included
//   - charges with room_id NOT NULL but NOT in scope → excluded
//   - charges with room_id NULL ("reservation-wide") → included only
//     when this invoice covers the LAST remaining un-invoiced rooms.
//     This guarantees they don't disappear, and don't get
//     double-counted.
export function selectChargesForScope(args: {
  allCharges: AdditionalCharge[];
  scopeRoomIds: string[];
  // Rooms that still have no invoice. If this invoice covers ALL of
  // them, attach the orphan (room-NULL) charges here.
  remainingUnInvoicedRoomIds: string[];
}): AdditionalCharge[] {
  const scopeSet = new Set(args.scopeRoomIds);
  const remainingSet = new Set(args.remainingUnInvoicedRoomIds);
  const coversAllRemaining =
    args.scopeRoomIds.length > 0 &&
    args.scopeRoomIds.every((id) => remainingSet.has(id)) &&
    args.remainingUnInvoicedRoomIds.every((id) => scopeSet.has(id));
  return args.allCharges.filter((c) => {
    if (c.roomId == null) return coversAllRemaining;
    return scopeSet.has(c.roomId);
  });
}
