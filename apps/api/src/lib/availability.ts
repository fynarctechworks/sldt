import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { RESERVATION_BLOCKING_STATUSES } from "../db/schema/enums.js";
import { reservationRooms, reservations } from "../db/schema/reservations.js";
import { rooms } from "../db/schema/rooms.js";

type Db = typeof db;
type Exec = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

// Drizzle's inArray wants a writable string[]. Materialise the readonly
// enum tuple once at module load so every availability query reuses it.
const BLOCKING_STATUSES = [...RESERVATION_BLOCKING_STATUSES];

export async function findAvailableRooms(checkIn: string, checkOut: string) {
  const conflicts = db
    .select({ roomId: reservationRooms.roomId })
    .from(reservationRooms)
    .innerJoin(reservations, eq(reservations.id, reservationRooms.reservationId))
    .where(
      and(
        inArray(reservations.status, BLOCKING_STATUSES),
        sql`daterange(${reservations.checkInDate}, ${reservations.checkOutDate}, '[)') && daterange(${checkIn}::date, ${checkOut}::date, '[)')`,
      ),
    );

  // Dirty rooms remain in the result so the front desk can still
  // re-let them after acknowledging a quick clean-up. The UI surfaces
  // a "Mark clean & select" affordance per dirty card. Maintenance is
  // still hard-blocked.
  const all = await db.select().from(rooms).where(ne(rooms.status, "maintenance"));
  const conflictRows = await conflicts;
  const blocked = new Set(conflictRows.map((r) => r.roomId));
  return all.filter((r) => !blocked.has(r.id));
}

export async function isRoomAvailable(
  roomId: string,
  checkIn: string,
  checkOut: string,
  excludeReservationId?: string,
  exec: Exec = db,
): Promise<boolean> {
  const overlap = and(
    eq(reservationRooms.roomId, roomId),
    inArray(reservations.status, BLOCKING_STATUSES),
    sql`daterange(${reservations.checkInDate}, ${reservations.checkOutDate}, '[)') && daterange(${checkIn}::date, ${checkOut}::date, '[)')`,
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
