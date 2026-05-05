import { format } from "date-fns";
import puppeteer, { type Browser, type PaperFormat } from "puppeteer";
import type { InvoiceLineItem, Invoice, Payment } from "../db/schema/invoices.js";
import type { Guest } from "../db/schema/guests.js";
import type { Reservation } from "../db/schema/reservations.js";
import type { Settings } from "../db/schema/settings.js";
import { logger } from "./logger.js";

let browserPromise: Promise<Browser> | null = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}

function esc(s: string | null | undefined) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function inr(n: string | number, symbol = "₹") {
  const v = typeof n === "string" ? Number(n) : n;
  return `${symbol}${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function asPaper(s: string): PaperFormat {
  const x = s.toUpperCase();
  if (x === "A4" || x === "A5" || x === "A6" || x === "LETTER") return x.toLowerCase() as PaperFormat;
  return "a4";
}

interface DocLayout {
  primary: string;
  accent: string;
  invoiceTitle: string;
  receiptTitle: string;
  footerText: string;
  termsText: string | null;
  signatoryLabel: string;
  showLogo: boolean;
  showGstin: boolean;
  showTerms: boolean;
  showSignature: boolean;
  logoUrl: string | null;
  currency: string;
}

function layoutFromSettings(s: Settings): DocLayout {
  return {
    primary: s.docPrimaryColor,
    accent: s.docAccentColor,
    invoiceTitle: s.docInvoiceTitle,
    receiptTitle: s.docReceiptTitle,
    footerText: s.docFooterText,
    termsText: s.docTermsText,
    signatoryLabel: s.docSignatoryLabel,
    showLogo: s.docShowLogo,
    showGstin: s.docShowGstin,
    showTerms: s.docShowTerms,
    showSignature: s.docShowSignature,
    logoUrl: s.hotelLogoUrl ?? null,
    currency: s.currencySymbol,
  };
}

function commonStyles(L: DocLayout) {
  return `
    * { box-sizing: border-box; }
    @page { margin: 0; }
    html, body { background: #FAF7F0; }
    body {
      font-family: 'Helvetica Neue', -apple-system, 'Segoe UI', Roboto, sans-serif;
      color: #1C2620;
      margin: 0;
      padding: 28px 32px;
      font-size: 11.5px;
      line-height: 1.45;
      position: relative;
    }

    /* Watermark logo behind content */
    .watermark {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      z-index: 0;
      opacity: 0.045;
    }
    .watermark img { width: 320px; height: 320px; object-fit: contain; }
    .page { position: relative; z-index: 1; }

    /* Top brass band */
    .top-rule { height: 4px; background: ${L.accent}; margin: -28px -32px 24px; }

    /* Header */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      margin-bottom: 22px;
      padding-bottom: 18px;
      border-bottom: 1px solid ${L.accent};
    }
    .brand { display: flex; gap: 14px; align-items: flex-start; max-width: 62%; }
    .brand .logo-tile {
      width: 64px; height: 64px;
      background: #FFFFFF;
      border-radius: 10px;
      padding: 4px;
      box-shadow: 0 0 0 1px ${L.accent}55, 0 2px 4px rgba(15,61,46,0.08);
      display: grid; place-items: center;
    }
    .brand .logo-tile img { width: 100%; height: 100%; object-fit: contain; }
    .brand h1 {
      margin: 0;
      font-size: 22px;
      color: ${L.primary};
      letter-spacing: 0.3px;
      font-weight: 700;
    }
    .brand .tagline {
      font-size: 10px;
      color: ${L.accent};
      letter-spacing: 0.25em;
      text-transform: uppercase;
      margin-top: 2px;
      font-weight: 600;
    }
    .addr { margin-top: 6px; color: #4A554F; font-size: 11px; }
    .gstin { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 10.5px; color: #4A554F; margin-top: 2px; }

    .meta { text-align: right; min-width: 32%; }
    .meta .doc-label {
      display: inline-block;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.3em;
      color: ${L.accent};
      font-weight: 700;
      padding: 4px 10px;
      border: 1px solid ${L.accent};
      border-radius: 999px;
    }
    .meta .doc-no {
      font-size: 18px;
      font-weight: 700;
      color: ${L.primary};
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      margin-top: 8px;
      letter-spacing: 0.5px;
    }
    .meta .doc-date { font-size: 11px; color: #4A554F; margin-top: 2px; }
    .meta .status-pill {
      display: inline-block;
      margin-top: 6px;
      padding: 2px 8px;
      font-size: 9.5px;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      font-weight: 600;
      background: ${L.primary};
      color: #FFF;
      border-radius: 3px;
    }

    /* Two-column info */
    .info-grid { display: flex; gap: 14px; margin: 18px 0 22px; }
    .info-card {
      flex: 1;
      background: #FFFFFF;
      border: 1px solid #E2DCCD;
      border-top: 3px solid ${L.accent};
      border-radius: 5px;
      padding: 12px 14px;
    }
    .info-card .label {
      font-size: 9px;
      color: ${L.accent};
      text-transform: uppercase;
      letter-spacing: 0.22em;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .info-card .name { font-weight: 700; color: ${L.primary}; font-size: 13px; }
    .info-card .sub { color: #4A554F; margin-top: 2px; }
    .info-card .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; }

    /* Section heading */
    .section-title {
      font-size: 10px;
      color: ${L.accent};
      text-transform: uppercase;
      letter-spacing: 0.3em;
      font-weight: 700;
      margin: 22px 0 8px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .section-title::after {
      content: '';
      flex: 1;
      height: 1px;
      background: ${L.accent}55;
    }

    /* Line items */
    .items {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
    }
    .items thead th {
      text-align: left;
      padding: 10px 10px;
      font-weight: 700;
      font-size: 9.5px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: #FFFFFF;
      background: ${L.primary};
    }
    .items thead th:first-child { border-top-left-radius: 4px; }
    .items thead th:last-child { border-top-right-radius: 4px; }
    .items tbody td {
      padding: 9px 10px;
      border-bottom: 1px solid #E8E2D3;
      font-size: 11px;
      vertical-align: top;
    }
    .items tbody tr:nth-child(even) td { background: #FBF8F0; }
    .items .num { text-align: right; }
    .items .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
    .items .desc-main { font-weight: 600; color: ${L.primary}; }

    /* Totals */
    .totals-wrap { display: flex; justify-content: flex-end; margin-top: 14px; }
    .totals {
      width: 56%;
      border-collapse: collapse;
    }
    .totals td { padding: 5px 10px; border: none; font-size: 11px; }
    .totals tr.sub td { color: #4A554F; }
    .totals tr.tax td { color: #4A554F; }
    .totals tr.divider td { border-top: 1px dashed ${L.accent}; padding-top: 8px; }
    .totals tr.grand td {
      border-top: 2px solid ${L.primary};
      border-bottom: 2px solid ${L.primary};
      font-weight: 700;
      font-size: 14px;
      padding: 10px 10px;
      color: ${L.primary};
      background: #FFFFFF;
    }
    .totals tr.paid td { color: #2E7D32; padding-top: 8px; }
    .totals tr.balance td {
      font-weight: 700;
      font-size: 12.5px;
      color: #B23A2E;
    }
    .totals tr.balance td.paid { color: #2E7D32; }

    /* Hero amount (receipts) */
    .amount-box {
      margin: 18px 0;
      padding: 22px 20px;
      background: ${L.primary};
      color: #FFF;
      border-radius: 8px;
      text-align: center;
      position: relative;
      overflow: hidden;
    }
    .amount-box::before, .amount-box::after {
      content: '';
      position: absolute;
      width: 60px; height: 60px;
      border: 1px solid ${L.accent}66;
      border-radius: 50%;
    }
    .amount-box::before { top: -25px; left: -20px; }
    .amount-box::after { bottom: -25px; right: -20px; }
    .amount-box .lbl {
      font-size: 9.5px;
      text-transform: uppercase;
      letter-spacing: 0.32em;
      color: ${L.accent};
      font-weight: 700;
    }
    .amount-box .amt {
      font-size: 36px;
      font-weight: 700;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      margin-top: 6px;
      letter-spacing: 0.5px;
    }
    .amount-box .method {
      font-size: 11px;
      margin-top: 8px;
      letter-spacing: 0.1em;
      text-transform: capitalize;
      opacity: 0.95;
    }

    /* Terms */
    .terms {
      margin-top: 22px;
      padding: 12px 14px;
      background: #FFFFFF;
      border: 1px solid #E2DCCD;
      border-left: 3px solid ${L.accent};
      font-size: 10.5px;
      color: #4A554F;
      white-space: pre-wrap;
      border-radius: 0 4px 4px 0;
    }
    .terms .terms-title {
      font-size: 9.5px;
      letter-spacing: 0.25em;
      text-transform: uppercase;
      color: ${L.accent};
      font-weight: 700;
      margin-bottom: 4px;
    }

    /* Footer */
    .footer {
      margin-top: 36px;
      padding-top: 14px;
      border-top: 1px solid ${L.accent};
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 16px;
    }
    .footer .thanks {
      font-size: 10.5px;
      color: #4A554F;
      max-width: 60%;
    }
    .footer .thanks .signoff {
      font-style: italic;
      color: ${L.primary};
      font-size: 12px;
      margin-bottom: 2px;
    }
    .sign { text-align: center; min-width: 200px; }
    .sign .line {
      margin-top: 36px;
      border-top: 1px solid ${L.accent};
      padding-top: 4px;
      color: #4A554F;
      font-size: 10px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
    }
    .doc-id-strip {
      position: absolute;
      left: 32px; right: 32px; bottom: 12px;
      text-align: center;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: #B0AB99;
      font-size: 8.5px;
      letter-spacing: 0.2em;
    }
  `;
}

function brandHeader(L: DocLayout, hotelName: string, hotelAddress: string, hotelGstin: string) {
  return `
    <div class="brand">
      ${L.showLogo && L.logoUrl ? `<div class="logo-tile"><img src="${esc(L.logoUrl)}" alt="logo" /></div>` : ""}
      <div>
        <h1>${esc(hotelName)}</h1>
        <div class="tagline">Hospitality &amp; Stays</div>
        <div class="addr">${esc(hotelAddress)}</div>
        ${L.showGstin && hotelGstin ? `<div class="gstin">GSTIN&nbsp;·&nbsp;${esc(hotelGstin)}</div>` : ""}
      </div>
    </div>
  `;
}

function renderInvoiceHtml(data: {
  invoice: Invoice;
  lineItems: InvoiceLineItem[];
  payments: Payment[];
  settings: Settings;
}) {
  const { invoice, lineItems, payments, settings } = data;
  const L = layoutFromSettings(settings);

  const itemRows = lineItems
    .map(
      (li) => `
    <tr>
      <td><div class="desc-main">${esc(li.description)}</div></td>
      <td class="mono">${esc(li.sacCode)}</td>
      <td class="num">${li.quantity}</td>
      <td class="num mono">${inr(li.rate, L.currency)}</td>
      <td class="num mono">${inr(li.amount, L.currency)}</td>
    </tr>`,
    )
    .join("");

  const payRows = payments.length
    ? payments
        .map(
          (p) => `
    <tr>
      <td>${format(new Date(p.paymentDate), "dd MMM yyyy")}</td>
      <td class="capitalize">${p.paymentMethod.replace("_", " ")}</td>
      <td class="num mono">${inr(p.amount, L.currency)}</td>
    </tr>`,
        )
        .join("")
    : `<tr><td colspan="3" style="color:#999;text-align:center;padding:14px;">No payments yet</td></tr>`;

  const balanceClass = Number(invoice.balanceDue) <= 0.009 ? "paid" : "";

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>${commonStyles(L)}</style></head>
<body>

${L.showLogo && L.logoUrl ? `<div class="watermark"><img src="${esc(L.logoUrl)}" alt="" /></div>` : ""}

<div class="page">
  <div class="top-rule"></div>

  <div class="header">
    ${brandHeader(L, invoice.hotelName, invoice.hotelAddress, invoice.hotelGstin)}
    <div class="meta">
      <div class="doc-label">${esc(L.invoiceTitle)}</div>
      <div class="doc-no">${esc(invoice.invoiceNumber)}</div>
      <div class="doc-date">Date: ${format(new Date(invoice.createdAt), "dd MMM yyyy")}</div>
      <div class="status-pill">${esc(invoice.status)}</div>
    </div>
  </div>

  <div class="info-grid">
    <div class="info-card">
      <div class="label">Billed To</div>
      <div class="name">${esc(invoice.guestName)}</div>
      ${invoice.guestAddress ? `<div class="sub">${esc(invoice.guestAddress)}</div>` : ""}
      ${invoice.guestGstin ? `<div class="sub mono">GSTIN: ${esc(invoice.guestGstin)}</div>` : ""}
    </div>
    <div class="info-card">
      <div class="label">Stay</div>
      <div class="sub mono">Invoice ${esc(invoice.invoiceNumber)}</div>
      <div class="sub">Issued ${format(new Date(invoice.createdAt), "dd MMM yyyy")}</div>
    </div>
  </div>

  <div class="section-title">Line Items</div>
  <table class="items">
    <thead>
      <tr>
        <th style="width:48%">Description</th>
        <th style="width:12%">SAC</th>
        <th class="num" style="width:8%">Qty</th>
        <th class="num" style="width:16%">Rate</th>
        <th class="num" style="width:16%">Amount</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="totals-wrap">
    <table class="totals">
      <tr class="sub"><td>Subtotal</td><td class="num mono">${inr(invoice.subtotal, L.currency)}</td></tr>
      <tr class="tax"><td>CGST @ ${invoice.cgstRate}%</td><td class="num mono">${inr(invoice.cgstAmount, L.currency)}</td></tr>
      <tr class="tax"><td>SGST @ ${invoice.sgstRate}%</td><td class="num mono">${inr(invoice.sgstAmount, L.currency)}</td></tr>
      <tr class="grand"><td>Grand Total</td><td class="num mono">${inr(invoice.grandTotal, L.currency)}</td></tr>
      <tr class="paid"><td>Total Paid</td><td class="num mono">${inr(invoice.totalPaid, L.currency)}</td></tr>
      <tr class="balance"><td>Balance Due</td><td class="num mono ${balanceClass}">${inr(invoice.balanceDue, L.currency)}</td></tr>
    </table>
  </div>

  <div class="section-title">Payment History</div>
  <table class="items">
    <thead>
      <tr>
        <th style="width:30%">Date</th>
        <th style="width:40%">Method</th>
        <th class="num" style="width:30%">Amount</th>
      </tr>
    </thead>
    <tbody>${payRows}</tbody>
  </table>

  ${
    L.showTerms && L.termsText
      ? `<div class="terms"><div class="terms-title">Terms &amp; Conditions</div>${esc(L.termsText)}</div>`
      : ""
  }

  <div class="footer">
    <div class="thanks">
      <div class="signoff">${esc(L.footerText)}</div>
      <div>This is a system-generated tax invoice. No physical signature is required for validity.</div>
    </div>
    ${L.showSignature ? `<div class="sign"><div class="line">${esc(L.signatoryLabel)}</div></div>` : ""}
  </div>

  <div class="doc-id-strip">${esc(invoice.invoiceNumber)} &middot; ${format(new Date(), "dd MMM yyyy HH:mm")}</div>
</div>

</body></html>`;
}

export async function renderInvoicePdf(data: {
  invoice: Invoice;
  lineItems: InvoiceLineItem[];
  payments: Payment[];
  settings: Settings;
}): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const html = renderInvoiceHtml(data);
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 15_000 });
    const pdf = await page.pdf({
      format: asPaper(data.settings.docInvoicePageSize),
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
      timeout: 15_000,
    });
    return Buffer.from(pdf);
  } catch (err) {
    logger.error({ err }, "PDF rendering failed");
    throw err;
  } finally {
    await page.close();
  }
}

function renderReceiptHtml(data: {
  payment: Payment;
  reservation: Reservation;
  guest: Guest;
  invoice: Invoice | null;
  settings: Settings;
}) {
  const { payment, reservation, guest, invoice, settings } = data;
  const L = layoutFromSettings(settings);

  const isAdvance = !invoice;
  const sublabel = isAdvance
    ? "Receipt Voucher (Rule 50, CGST Rules). Full GST invoice will be issued at check-out."
    : "Payment received against tax invoice.";
  const grandTotal = invoice ? Number(invoice.grandTotal) : Number(reservation.grandTotal);
  const paidSoFar = invoice ? Number(invoice.totalPaid) : Number(reservation.advancePaid);
  const balanceDue = Math.max(0, +(grandTotal - paidSoFar).toFixed(2));

  const balanceClass = balanceDue <= 0.009 ? "paid" : "";

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>${commonStyles(L)}</style></head>
<body>

${L.showLogo && L.logoUrl ? `<div class="watermark"><img src="${esc(L.logoUrl)}" alt="" /></div>` : ""}

<div class="page">
  <div class="top-rule"></div>

  <div class="header">
    ${brandHeader(L, settings.hotelName, settings.hotelAddress, settings.hotelGstin)}
    <div class="meta">
      <div class="doc-label">${esc(L.receiptTitle)}</div>
      <div class="doc-no">${esc(payment.receiptNumber ?? "(no number)")}</div>
      <div class="doc-date">${format(new Date(payment.paymentDate), "dd MMM yyyy · HH:mm")}</div>
    </div>
  </div>

  <div class="info-grid">
    <div class="info-card">
      <div class="label">Received From</div>
      <div class="name">${esc(guest.fullName)}</div>
      <div class="sub mono">${esc(guest.phone)}</div>
    </div>
    <div class="info-card">
      <div class="label">Reference</div>
      <div class="name mono" style="font-size:12px;">${esc(reservation.reservationNumber)}</div>
      ${invoice ? `<div class="sub mono">Invoice ${esc(invoice.invoiceNumber)}</div>` : `<div class="sub">Advance · pre-invoice</div>`}
    </div>
  </div>

  <div class="amount-box">
    <div class="lbl">Amount Received</div>
    <div class="amt">${inr(payment.amount, L.currency)}</div>
    <div class="method">via ${esc(payment.paymentMethod.replace("_", " "))}${payment.notes ? ` · ${esc(payment.notes)}` : ""}</div>
  </div>

  <div class="section-title">Account Summary</div>
  <div class="totals-wrap">
    <table class="totals" style="width:100%">
      <tr class="sub"><td>${isAdvance ? "Estimated Stay Total" : "Invoice Grand Total"}</td><td class="num mono">${inr(grandTotal, L.currency)}</td></tr>
      <tr class="paid"><td>Total Paid${isAdvance ? " (incl. this receipt)" : ""}</td><td class="num mono">${inr(paidSoFar, L.currency)}</td></tr>
      <tr class="balance"><td>Balance Due</td><td class="num mono ${balanceClass}">${inr(balanceDue, L.currency)}</td></tr>
    </table>
  </div>

  ${
    L.showTerms && L.termsText
      ? `<div class="terms"><div class="terms-title">Terms &amp; Conditions</div>${esc(L.termsText)}</div>`
      : `<div class="terms"><div class="terms-title">Note</div>${esc(sublabel)}</div>`
  }

  <div class="footer">
    <div class="thanks">
      <div class="signoff">${esc(L.footerText)}</div>
      <div>This receipt acknowledges payment received as listed above.</div>
    </div>
    ${L.showSignature ? `<div class="sign"><div class="line">${esc(L.signatoryLabel)}</div></div>` : ""}
  </div>

  <div class="doc-id-strip">${esc(payment.receiptNumber ?? "")} &middot; ${format(new Date(), "dd MMM yyyy HH:mm")}</div>
</div>

</body></html>`;
}

export async function renderReceiptPdf(data: {
  payment: Payment;
  reservation: Reservation;
  guest: Guest;
  invoice: Invoice | null;
  settings: Settings;
}): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const html = renderReceiptHtml(data);
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 15_000 });
    const pdf = await page.pdf({
      format: asPaper(data.settings.docReceiptPageSize),
      printBackground: true,
      margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" },
      timeout: 15_000,
    });
    return Buffer.from(pdf);
  } catch (err) {
    logger.error({ err }, "Receipt PDF rendering failed");
    throw err;
  } finally {
    await page.close();
  }
}

export const docRenderHelpers = { layoutFromSettings, renderInvoiceHtml, renderReceiptHtml };
