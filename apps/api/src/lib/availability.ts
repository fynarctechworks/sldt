import { and, asc, eq, gte, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { RESERVATION_BLOCKING_STATUSES } from "../db/schema/enums.js";
import { reservationRooms, reservations } from "../db/schema/reservations.js";
import { rooms } from "../db/schema/rooms.js";
import { guests } from "../db/schema/guests.js";

type Db = typeof db;
type Exec = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

// Drizzle's inArray wants a writable string[]. Materialise the readonly
// enum tuple once at module load so every availability query reuses it.
const BLOCKING_STATUSES = [...RESERVATION_BLOCKING_STATUSES];

export async function findAvailableRooms(checkIn: string, checkOut: string) {
  // See isRoomAvailable for the same guard rationale.
  if (checkOut <= checkIn) {
    throw new Error(
      `findAvailableRooms: invalid probe window [${checkIn}, ${checkOut}). ` +
        "For day-use bookings probe [d, d+1).",
    );
  }
  // Two-tier conflict check:
  //  - overnight bookings → standard half-open daterange overlap.
  //  - short_stay (day-use) bookings → checkInDate == checkOutDate,
  //    which collapses to an empty Postgres range and would silently
  //    miss the overlap. Treat them as conflicts when their stay date
  //    falls within the probe window [checkIn, checkOut).
  const conflicts = db
    .select({ roomId: reservationRooms.roomId })
    .from(reservationRooms)
    .innerJoin(reservations, eq(reservations.id, reservationRooms.reservationId))
    .where(
      and(
        inArray(reservations.status, BLOCKING_STATUSES),
        or(
          // Honour per-row effective_from/effective_to when present
          // (mid-stay room swaps narrow a single reservation_rooms row
          // to a sub-range of the parent reservation's stay). Falls
          // back to the parent's check-in/check-out for legacy rows
          // where the columns are NULL.
          sql`${reservations.stayType} = 'overnight' AND daterange(
            COALESCE(${reservationRooms.effectiveFrom}, ${reservations.checkInDate}),
            COALESCE(${reservationRooms.effectiveTo},   ${reservations.checkOutDate}),
            '[)'
          ) && daterange(${checkIn}::date, ${checkOut}::date, '[)')`,
          sql`${reservations.stayType} = 'short_stay' AND ${reservations.checkInDate} >= ${checkIn}::date AND ${reservations.checkInDate} < ${checkOut}::date`,
        ),
      ),
    );

  // Hard-block only rooms that physically cannot be sold:
  //   - occupied    → a guest is in there NOW
  //   - maintenance → out of inventory
  // Reserved rooms ARE included so same-day re-let works: the daterange
  // overlap check above already filters out any room whose existing
  // reservation conflicts with the probe window. A walk-in for tonight
  // [1 Jun, 2 Jun) does NOT overlap a reservation for [2 Jun, 3 Jun)
  // so the room is technically free tonight.
  // Dirty rooms also stay in the result; the UI surfaces a "Mark clean
  // & select" affordance per dirty card.
  const all = await db
    .select()
    .from(rooms)
    .where(sql`${rooms.status} NOT IN ('maintenance', 'occupied')`)
    // Order by floor then room number so the picker reads as a
    // natural floor-by-floor list (101, 102, 201, 202, 301, ...).
    // room_number is text — cast to int when it's purely numeric so
    // 10 sorts after 9, not after 1.
    .orderBy(
      sql`${rooms.floor} ASC NULLS LAST`,
      sql`CASE WHEN ${rooms.roomNumber} ~ '^[0-9]+$' THEN ${rooms.roomNumber}::int END ASC NULLS LAST`,
      sql`${rooms.roomNumber} ASC`,
    );
  const conflictRows = await conflicts;
  const blocked = new Set(conflictRows.map((r) => r.roomId));
  const candidates = all.filter((r) => !blocked.has(r.id));

  // For each candidate that has a FUTURE reservation starting on or
  // after the probe window's end, fetch the soonest one so the UI can
  // warn "Room reserved for [guest] arriving [date]". The walk-in
  // booking must vacate before that arrival.
  const candidateIds = candidates.map((c) => c.id);
  if (candidateIds.length === 0) return candidates;
  const nextRes = await db
    .select({
      roomId: reservationRooms.roomId,
      reservationId: reservations.id,
      reservationNumber: reservations.reservationNumber,
      checkInDate: reservations.checkInDate,
      checkOutDate: reservations.checkOutDate,
      guestName: guests.fullName,
    })
    .from(reservationRooms)
    .innerJoin(reservations, eq(reservations.id, reservationRooms.reservationId))
    .innerJoin(guests, eq(guests.id, reservations.guestId))
    .where(
      and(
        inArray(reservationRooms.roomId, candidateIds),
        inArray(reservations.status, BLOCKING_STATUSES),
        gte(reservations.checkInDate, checkOut),
      ),
    )
    .orderBy(asc(reservations.checkInDate));
  // Keep only the SOONEST next reservation per room.
  const nextByRoom = new Map<
    string,
    {
      reservationId: string;
      reservationNumber: string;
      checkInDate: string;
      checkOutDate: string;
      guestName: string;
    }
  >();
  for (const r of nextRes) {
    if (nextByRoom.has(r.roomId)) continue;
    nextByRoom.set(r.roomId, {
      reservationId: r.reservationId,
      reservationNumber: r.reservationNumber,
      checkInDate: r.checkInDate,
      checkOutDate: r.checkOutDate,
      guestName: r.guestName,
    });
  }
  return candidates.map((c) => ({
    ...c,
    nextReservation: nextByRoom.get(c.id) ?? null,
  }));
}

export async function isRoomAvailable(
  roomId: string,
  checkIn: string,
  checkOut: string,
  excludeReservationId?: string,
  exec: Exec = db,
): Promise<boolean> {
  // Hard guard against a degenerate probe window. Postgres collapses
  // daterange(X, X, '[)') to an empty range that overlaps nothing —
  // silently returning "available". Historical bug: callers passing
  // the parent reservation's check-in/check-out for a short_stay
  // booking (where they're equal) would bypass the conflict check.
  // Surface it loudly instead of pretending the room is free.
  if (checkOut <= checkIn) {
    throw new Error(
      `isRoomAvailable: invalid probe window [${checkIn}, ${checkOut}). ` +
        "For day-use bookings probe [d, d+1) so the short_stay branch fires.",
    );
  }
  const overlap = and(
    eq(reservationRooms.roomId, roomId),
    inArray(reservations.status, BLOCKING_STATUSES),
    // Mirror the findAvailableRooms split — overnight uses daterange,
    // short_stay (day-use) collapses to an empty range and needs an
    // explicit single-day check against the probe window.
    or(
      sql`${reservations.stayType} = 'overnight' AND daterange(
        COALESCE(${reservationRooms.effectiveFrom}, ${reservations.checkInDate}),
        COALESCE(${reservationRooms.effectiveTo},   ${reservations.checkOutDate}),
        '[)'
      ) && daterange(${checkIn}::date, ${checkOut}::date, '[)')`,
      sql`${reservations.stayType} = 'short_stay' AND ${reservations.checkInDate} >= ${checkIn}::date AND ${reservations.checkInDate} < ${checkOut}::date`,
    ),
    excludeReservationId ? ne(reservations.id, excludeReservationId) : undefined,
  );
  const rows = await exec
    .select({ id: reservations.id })
    .from(reservationRooms)
    .innerJoin(reservations, eq(reservations.id, reservationRooms.reservationId))
    .where(overlap)
    .limit(1);
  if (rows.length > 0) return false;

  const room = await exec.select().from(rooms).where(eq(rooms.id, roomId)).limit(1);
  if (!room.length) return false;
  return room[0]!.status !== "maintenance";
}

// Acquire a transaction-scoped advisory lock keyed by a string. The lock is
// auto-released at COMMIT/ROLLBACK. We use this to serialize concurrent
// reservation creates and number-sequence allocations, eliminating races
// without DDL-level constraints.
export async function lockKey(exec: Exec, key: string): Promise<void> {
  await exec.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key})::bigint)`);
}

// Sequence allocators. Phase 1 replaced the prior MAX(...)+advisory-lock
// approach with real Postgres sequences (migration 0011). nextval() is
// transaction-safe, contention-free, and gap-tolerant (a rolled-back tx
// consumes the number, but for SLDT-RES/INV/RCP that's auditor-acceptable
// and arguably *desirable* — gaps make a deleted reservation visible).
//
// The `like` parameter is now ignored at the DB level but kept in the
// signature so callers don't have to change. If we ever introduce a
// second numbering domain (e.g. SLDT-CN- for credit notes) we'll add a
// new sequence rather than parameterising the LIKE.
export async function nextDailySequence(
  _like: string,
  exec: Exec = db,
): Promise<number> {
  const result = await exec.execute<{ nextval: string | number }>(
    sql`SELECT nextval('sldt_reservation_seq') AS nextval`,
  );
  const row = result[0] as { nextval: string | number } | undefined;
  return Number(row?.nextval ?? 0);
}

export async function nextInvoiceSequence(_like: string, exec: Exec = db): Promise<number> {
  const result = await exec.execute<{ nextval: string | number }>(
    sql`SELECT nextval('sldt_invoice_seq') AS nextval`,
  );
  const row = result[0] as { nextval: string | number } | undefined;
  return Number(row?.nextval ?? 0);
}

export async function nextReceiptSequence(_like: string, exec: Exec = db): Promise<number> {
  const result = await exec.execute<{ nextval: string | number }>(
    sql`SELECT nextval('sldt_receipt_seq') AS nextval`,
  );
  const row = result[0] as { nextval: string | number } | undefined;
  return Number(row?.nextval ?? 0);
}

// Per-room advisory lock for double-booking prevention. Hold inside a tx
// across the availability check and the insert.
export async function lockRoom(exec: Exec, roomId: string): Promise<void> {
  await lockKey(exec, `room:${roomId}`);
}

export { sql, or };
