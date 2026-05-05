export interface GstSlabs {
  exemptBelow: number;
  lowRate: number;
  lowMax: number;
  highRate: number;
}

export const DEFAULT_SLABS: GstSlabs = {
  exemptBelow: 1000,
  lowRate: 5,
  lowMax: 7500,
  highRate: 18,
};

export function getGstRate(ratePerNight: number, slabs: GstSlabs = DEFAULT_SLABS): number {
  if (ratePerNight < slabs.exemptBelow) return 0;
  if (ratePerNight <= slabs.lowMax) return slabs.lowRate;
  return slabs.highRate;
}

export function calcGstBreakdown(subtotal: number, gstRate: number) {
  const gstAmount = +(subtotal * (gstRate / 100)).toFixed(2);
  const cgstAmount = +(gstAmount / 2).toFixed(2);
  const sgstAmount = +(gstAmount - cgstAmount).toFixed(2);
  return {
    gstAmount,
    cgstRate: gstRate / 2,
    sgstRate: gstRate / 2,
    cgstAmount,
    sgstAmount,
    grandTotal: +(subtotal + gstAmount).toFixed(2),
  };
}
