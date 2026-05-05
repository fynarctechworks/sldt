import { format } from "date-fns";

const fmt4 = (n: number) => String(n).padStart(4, "0");

export function reservationNumber(seq: number, date = new Date()) {
  return `RES-${format(date, "yyyyMMdd")}-${fmt4(seq)}`;
}

export function invoiceNumber(prefix: string, seq: number, date = new Date()) {
  return `${prefix}-${format(date, "yyyyMM")}-${fmt4(seq)}`;
}

export function receiptNumber(seq: number, date = new Date()) {
  return `RCP-${format(date, "yyyyMMdd")}-${fmt4(seq)}`;
}
