// Property-local calendar helpers. The hotel runs on IST regardless of
// where the server is hosted, so "today" must be derived from the
// property timezone, never the server clock's local date.
// (dashboard.ts has richer variants of these for its forecast windows.)

export const PROPERTY_TIMEZONE = "Asia/Kolkata";

export function propertyToday(): string {
  // en-CA gives yyyy-MM-dd reliably across runtimes.
  return new Date().toLocaleDateString("en-CA", { timeZone: PROPERTY_TIMEZONE });
}

// Inclusive timestamp bounds for a property-local calendar date.
// "2026-06-11" → 11 Jun 00:00 IST / 11 Jun 23:59:59.999 IST. Date
// filters that naively did `new Date("yyyy-MM-dd")` got midnight UTC
// for BOTH ends, so a single-day window ("Today") matched nothing.
export function propertyDayStart(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00+05:30`);
}
export function propertyDayEnd(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59.999+05:30`);
}
