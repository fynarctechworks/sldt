import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { reservationRooms, reservations } from "../db/schema/reservations.js";
import { rooms } from "../db/schema/rooms.js";

export async function findAvailableRooms(checkIn: string, checkOut: string) {
  const conflicts = db
    .select({ roomId: reservationRooms.roomId })
    .from(reservationRooms)
    .innerJoin(reservations, eq(reservations.id, reservationRooms.reservationId))
    .where(
      and(
        inArray(reservations.status, ["confirmed", "checked_in"]),
        sql`daterange(${reservations.checkInDate}, ${reservations.checkOutDate}, '[)') && daterange(${checkIn}::date, ${checkOut}::date, '[)')`,
      ),
    );

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
): Promise<boolean> {
  const overlap = and(
    eq(reservationRooms.roomId, roomId),
    inArray(reservations.status, ["confirmed", "checked_in"]),
    sql`daterange(${reservations.checkInDate}, ${reservations.checkOutDate}, '[)') && daterange(${checkIn}::date, ${checkOut}::date, '[)')`,
    excludeReservationId ? ne(reservations.id, excludeReservationId) : undefined,
  );
  const rows = await db
    .select({ id: reservations.id })
    .from(reservationRooms)
    .innerJoin(reservations, eq(reservations.id, reservationRooms.reservationId))
    .where(overlap)
    .limit(1);
  if (rows.length > 0) return false;

  const room = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1);
  if (!room.length) return false;
  return room[0]!.status !== "maintenance";
}

export async function nextDailySequence(prefix: string, like: string): Promise<number> {
  const result = await db.execute<{ max: number | null }>(
    sql`SELECT COALESCE(MAX(CAST(SPLIT_PART(reservation_number, '-', 3) AS INT)), 0) AS max FROM reservations WHERE reservation_number LIKE ${like}`,
  );
  const row = result[0] as { max: number | null } | undefined;
  return (row?.max ?? 0) + 1;
}

export async function nextInvoiceSequence(like: string): Promise<number> {
  const result = await db.execute<{ max: number | null }>(
    sql`SELECT COALESCE(MAX(CAST(SPLIT_PART(invoice_number, '-', 3) AS INT)), 0) AS max FROM invoices WHERE invoice_number LIKE ${like}`,
  );
  const row = result[0] as { max: number | null } | undefined;
  return (row?.max ?? 0) + 1;
}

export async function nextReceiptSequence(like: string): Promise<number> {
  const result = await db.execute<{ max: number | null }>(
    sql`SELECT COALESCE(MAX(CAST(SPLIT_PART(receipt_number, '-', 3) AS INT)), 0) AS max FROM payments WHERE receipt_number LIKE ${like}`,
  );
  const row = result[0] as { max: number | null } | undefined;
  return (row?.max ?? 0) + 1;
}

export { sql, or };
