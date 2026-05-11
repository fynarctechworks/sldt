import { nextReceiptSequence } from "./availability.js";
import { receiptNumber } from "./numbers.js";

export async function generateReceiptNumber(): Promise<string> {
  const seq = await nextReceiptSequence("SLDT-RCP-%");
  return receiptNumber(seq);
}
