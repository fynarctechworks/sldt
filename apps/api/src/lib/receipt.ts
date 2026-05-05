import { format } from "date-fns";
import { nextReceiptSequence } from "./availability.js";
import { receiptNumber } from "./numbers.js";

export async function generateReceiptNumber(date = new Date()): Promise<string> {
  const like = `RCP-${format(date, "yyyyMMdd")}-%`;
  const seq = await nextReceiptSequence(like);
  return receiptNumber(seq, date);
}
