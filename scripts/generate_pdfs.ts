// Generates the GEN_* test PDFs (SPEC §9) into data/sample_invoices/.
// GEN_scanned_acme is rasterized to an image-only PDF (true "scanned" document).
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const OUT = path.join(process.cwd(), "tests", "sample_invoices");

interface Line { desc: string; qty: string; unit: string; amount: string }
interface InvoiceSpec {
  file: string;
  vendor: string; vendorAddr: string; vendorEmail: string;
  invNo: string | null; date: string; due: string;
  po: string | null;
  lines: Line[];
  subtotal: string | null; tax: string | null; total: string | null;
  terms: string;
  bank?: string;
  banner?: string; // urgency banner
  extra?: string[];
}

async function drawInvoice(spec: InvoiceSpec): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0.1, 0.1, 0.12);
  const gray = rgb(0.45, 0.45, 0.5);
  const red = rgb(0.75, 0.1, 0.1);
  let y = 740;
  const text = (s: string, x: number, size = 10, f = font, color = black) => page.drawText(s, { x, y, size, font: f, color });

  text(spec.vendor, 50, 18, bold); y -= 16;
  text(spec.vendorAddr, 50, 9, font, gray); y -= 12;
  text(spec.vendorEmail, 50, 9, font, gray);

  y = 740;
  text("INVOICE", 430, 20, bold); y -= 22;
  if (spec.invNo) { text(`Invoice #: ${spec.invNo}`, 430, 10); y -= 14; }
  text(`Date: ${spec.date}`, 430, 10); y -= 14;
  text(`Due: ${spec.due}`, 430, 10); y -= 14;
  if (spec.po) { text(`PO Number: ${spec.po}`, 430, 10, bold); }

  if (spec.banner) {
    y = 660;
    page.drawRectangle({ x: 50, y: y - 6, width: 512, height: 24, color: rgb(1, 0.92, 0.92) });
    text(spec.banner, 58, 12, bold, red);
  }

  y = 620;
  text("Bill To: TechCorp Inc., 456 Innovation Way, Austin, TX 78701", 50, 10);

  y = 580;
  page.drawLine({ start: { x: 50, y: y + 14 }, end: { x: 562, y: y + 14 }, thickness: 1, color: gray });
  text("Description", 50, 10, bold); text("Qty", 380, 10, bold); text("Unit", 430, 10, bold); text("Amount", 500, 10, bold);
  y -= 6;
  page.drawLine({ start: { x: 50, y }, end: { x: 562, y }, thickness: 0.5, color: gray });
  y -= 18;
  for (const li of spec.lines) {
    text(li.desc, 50, 10); text(li.qty, 380, 10); text(li.unit, 430, 10); text(li.amount, 500, 10);
    y -= 18;
  }
  y -= 10;
  page.drawLine({ start: { x: 350, y: y + 8 }, end: { x: 562, y: y + 8 }, thickness: 0.5, color: gray });
  if (spec.subtotal) { text("Subtotal:", 430, 10, bold); text(spec.subtotal, 500, 10); y -= 16; }
  if (spec.tax) { text("Tax:", 430, 10, bold); text(spec.tax, 500, 10); y -= 16; }
  if (spec.total) { text("TOTAL:", 430, 12, bold); text(spec.total, 500, 12, bold); y -= 16; }

  y -= 24;
  text(`Payment Terms: ${spec.terms}`, 50, 10);
  y -= 16;
  if (spec.bank) { text(spec.bank, 50, 10, bold); y -= 16; }
  for (const line of spec.extra ?? []) { text(line, 50, 10, font, red); y -= 14; }

  return doc.save();
}

async function makeLetter(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  let y = 720;
  const put = (s: string, size = 11, f = font) => { page.drawText(s, { x: 60, y, size, font: f }); y -= size + 8; };
  put("Meridian Office Park — Building Management", 14, bold);
  y -= 10;
  put("July 8, 2026");
  y -= 6;
  put("Dear Tenant,", 11, bold);
  y -= 4;
  for (const line of [
    "Please be advised that the parking garage on Level B2 will be closed for resurfacing",
    "from July 21 through July 25. During this period, tenants may use the overflow lot",
    "on Congress Avenue at no additional charge.",
    "",
    "We appreciate your patience while we complete these improvements. If you have any",
    "questions, please contact the building office.",
  ]) put(line);
  y -= 6;
  put("Sincerely,");
  put("Meridian Building Management", 11, bold);
  return doc.save();
}

async function rasterizeToScanned(digitalPdf: Uint8Array, outFile: string): Promise<void> {
  // digital PDF → PNG (macOS sips) → image-only PDF = a true "scanned" document (no text layer)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scan-"));
  const pdfPath = path.join(tmp, "in.pdf");
  const pngPath = path.join(tmp, "page.png");
  fs.writeFileSync(pdfPath, digitalPdf);
  execSync(`sips -s format png -s dpiHeight 200 -s dpiWidth 200 --resampleWidth 1700 "${pdfPath}" --out "${pngPath}"`, { stdio: "pipe" });
  const png = fs.readFileSync(pngPath);
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(png);
  const page = doc.addPage([612, 792]);
  page.drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
  fs.writeFileSync(outFile, await doc.save());
  fs.rmSync(tmp, { recursive: true, force: true });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  // ── split-PO series: Metro Cleaning vs PO-2026-0108 ($3,600) ──
  const splits: Array<[string, string, string, Line[], string]> = [
    ["GEN_split_metro_1.pdf", "MC-2026-0401", "2026-07-01",
      [{ desc: "Quarterly Deep Cleaning - Q3 (July)", qty: "1", unit: "1,200.00", amount: "1,200.00" }], "1,200.00"],
    ["GEN_split_metro_2.pdf", "MC-2026-0402", "2026-08-01",
      [{ desc: "Quarterly Deep Cleaning - Q3 (August)", qty: "1", unit: "1,200.00", amount: "1,200.00" }], "1,200.00"],
    ["GEN_split_metro_3.pdf", "MC-2026-0403", "2026-09-01",
      [{ desc: "Quarterly Deep Cleaning - Q3 (September)", qty: "1", unit: "1,200.00", amount: "1,200.00" },
       { desc: "Supplemental sanitization (client request)", qty: "1", unit: "360.00", amount: "360.00" }], "1,560.00"],
  ];
  for (const [file, invNo, date, lines, total] of splits) {
    const bytes = await drawInvoice({
      file, vendor: "Metro Cleaning Services", vendorAddr: "88 Industry Dr, Austin, TX", vendorEmail: "invoices@metrocleaning.com",
      invNo, date, due: date.replace("-01", "-15"), po: "PO-2026-0108",
      lines, subtotal: total, tax: "0.00", total, terms: "Net 15",
    });
    fs.writeFileSync(path.join(OUT, file), bytes);
    console.log("wrote", file);
  }

  // ── BEC fraud composite: bank change + urgency + lookalike domain ──
  {
    const bytes = await drawInvoice({
      file: "GEN_fraud_globaltech.pdf",
      vendor: "GlobalTech Solutions", vendorAddr: "500 Tech Plaza, San Jose, CA", vendorEmail: "accounts@globaltech-pay.com",
      invNo: "GT-2026-0099", date: "2026-07-10", due: "2026-07-11", po: "PO-2026-0101",
      lines: [{ desc: "Implementation Support (hours)", qty: "50", unit: "130.00", amount: "6,500.00" }],
      subtotal: "6,500.00", tax: "536.25", total: "7,036.25",
      terms: "DUE IMMEDIATELY",
      bank: "NEW REMITTANCE DETAILS — Bank: First Meridian Bank · Account No: 8844556210 · Routing: 021000765",
      banner: "URGENT — PAYMENT DUE IMMEDIATELY. FINAL NOTICE.",
      extra: ["Note: Our banking details have changed. Please update your records and remit to the account above without delay."],
    });
    fs.writeFileSync(path.join(OUT, "GEN_fraud_globaltech.pdf"), bytes);
    console.log("wrote GEN_fraud_globaltech.pdf");
  }

  // ── missing critical fields: no invoice number, no total ──
  {
    const bytes = await drawInvoice({
      file: "GEN_missing_fields.pdf",
      vendor: "QuickShip Logistics Ltd", vendorAddr: "12 Harbor Rd, Houston, TX", vendorEmail: "billing@quickship.example",
      invNo: null, date: "2026-07-09", due: "2026-07-30", po: null,
      lines: [
        { desc: "Express courier - 14 packages", qty: "14", unit: "—", amount: "see contract" },
        { desc: "Fuel surcharge", qty: "1", unit: "—", amount: "TBD" },
      ],
      subtotal: null, tax: null, total: null,
      terms: "Amount to be confirmed per master service agreement",
    });
    fs.writeFileSync(path.join(OUT, "GEN_missing_fields.pdf"), bytes);
    console.log("wrote GEN_missing_fields.pdf");
  }

  // ── implied PO: no PO number printed (inferred from vendor + amount) ──
  {
    const bytes = await drawInvoice({
      file: "GEN_implied_po_argento.pdf",
      vendor: "ArgentoHome", vendorAddr: "77 Design Blvd, Portland, OR", vendorEmail: "billing@argentohome.com",
      invNo: "AH-2026-0031", date: "2026-07-09", due: "2026-08-08", po: null,
      lines: [{ desc: "Home Furnishing Items", qty: "1", unit: "253.66", amount: "253.66" }],
      subtotal: "253.66", tax: "0.00", total: "253.66", terms: "Net 30",
    });
    fs.writeFileSync(path.join(OUT, "GEN_implied_po_argento.pdf"), bytes);
    console.log("wrote GEN_implied_po_argento.pdf");
  }

  // ── bundled single line, tax folded into total, no explicit subtotal ──
  {
    const bytes = await drawInvoice({
      file: "GEN_bundled_datavault.pdf",
      vendor: "DataVault Cloud Services", vendorAddr: "1 Cloud Way, Seattle, WA", vendorEmail: "billing@datavault.cloud",
      invNo: "DV-2026-1180", date: "2026-08-01", due: "2026-08-31", po: "PO-2026-0104",
      lines: [{ desc: "Cloud services — August (all-inclusive)", qty: "1", unit: "", amount: "800.00" }],
      subtotal: null, tax: "66.00", total: "866.00", terms: "Net 30",
    });
    fs.writeFileSync(path.join(OUT, "GEN_bundled_datavault.pdf"), bytes);
    console.log("wrote GEN_bundled_datavault.pdf");
  }

  // ── not an invoice: building-management letter ──
  fs.writeFileSync(path.join(OUT, "GEN_not_invoice.pdf"), await makeLetter());
  console.log("wrote GEN_not_invoice.pdf");

  // ── scanned edge case: Acme invoice rasterized to image-only PDF ──
  {
    const digital = await drawInvoice({
      file: "GEN_scanned_acme.pdf",
      vendor: "Acme Office Supplies", vendorAddr: "200 Commerce St, Dallas, TX", vendorEmail: "billing@acmeoffice.com",
      invNo: "ACM-2026-0470", date: "2026-07-07", due: "2026-08-06", po: "PO-2026-0105",
      lines: [
        { desc: "Ergonomic Mouse", qty: "25", unit: "34.00", amount: "850.00" },
        { desc: "USB-C Docking Station", qty: "10", unit: "100.00", amount: "1,000.00" },
      ],
      subtotal: "1,850.00", tax: "152.63", total: "2,002.63", terms: "Net 30",
    });
    await rasterizeToScanned(digital, path.join(OUT, "GEN_scanned_acme.pdf"));
    console.log("wrote GEN_scanned_acme.pdf (image-only)");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
