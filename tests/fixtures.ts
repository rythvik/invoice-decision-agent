// Extraction FIXTURES — hand-authored ExtractedInvoice for each test PDF.
// These let us test the deterministic engine (rules, matching, decisions, pipeline,
// UI) with ZERO API calls — the correct way to test logic. Live Gemini extraction
// is verified separately (demo + a real golden pass when quota is available).
//
// Values mirror what each invoice actually prints (reference manifest + our generator).
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { putCached } from "../lib/db";
import type { ExtractedInvoice } from "../lib/types";

const HIGH = { vendor_name: "high", invoice_number: "high", total: "high", po_reference: "high" } as const;

function inv(p: Partial<ExtractedInvoice>): ExtractedInvoice {
  return {
    is_invoice: true, document_kind: "digital",
    vendor_name: null, vendor_email: null, invoice_number: null, invoice_date: "2026-07-01",
    due_date: null, po_reference: null, currency: "USD", line_items: [],
    subtotal: null, tax: null, discount: null, total: null,
    bank_account: null, remit_to_name: null, vendor_tax_id: null, payment_terms: null,
    urgency_language: [], field_confidence: { ...HIGH }, notes: null, ...p,
  };
}
const li = (description: string, qty: number, unit_price: number, amount: number) => ({ description, qty, unit_price, amount });

export const FIXTURES: Record<string, ExtractedInvoice> = {
  "INV_001_clean_acme_office.pdf": inv({
    vendor_name: "Acme Office Supplies", vendor_email: "billing@acmeoffice.com",
    invoice_number: "ACM-2026-0451", po_reference: "PO-2026-0100",
    subtotal: 4250, tax: 350.62, total: 4600.62,
    line_items: [li("Premium Copy Paper (Case)", 50, 45, 2250), li("Ink Cartridges - Black", 20, 65, 1300), li("Desk Organizer Set", 10, 70, 700)],
  }),
  "INV_002_clean_metro_cleaning.pdf": inv({
    vendor_name: "Metro Cleaning Services", vendor_email: "invoices@metrocleaning.com",
    invoice_number: "MC-2026-0312", po_reference: "PO-2026-0102",
    subtotal: 3600, tax: 0, total: 3600,
    line_items: [li("Monthly Office Cleaning - Floor 1", 1, 1200, 1200), li("Monthly Office Cleaning - Floor 2", 1, 1200, 1200), li("Monthly Office Cleaning - Floor 3", 1, 1200, 1200)],
  }),
  "INV_003_clean_datavault.pdf": inv({
    vendor_name: "DataVault Cloud Services", vendor_email: "billing@datavault.cloud",
    invoice_number: "DV-2026-1100", po_reference: "PO-2026-0104",
    subtotal: 800, tax: 0, total: 800,
    line_items: [li("Cloud Hosting - Production (monthly)", 1, 600, 600), li("Cloud Backup Service (monthly)", 1, 200, 200)],
  }),
  "INV_004_amount_mismatch_globaltech.pdf": inv({
    vendor_name: "GlobalTech Solutions", vendor_email: "ap@globaltech.io",
    invoice_number: "GT-2026-0088", po_reference: "PO-2026-0101",
    subtotal: 20450, tax: 1687.12, total: 22137.12,
    line_items: [li("Annual Software License - Enterprise", 1, 12000, 12000), li("Implementation Support (hours)", 65, 130, 8450)],
  }),
  "INV_005_amount_mismatch_prime.pdf": inv({
    vendor_name: "Prime Logistics Inc", vendor_email: "finance@primelogistics.com",
    invoice_number: "PL-2026-0776", po_reference: "PO-2026-0103",
    subtotal: 8232, tax: 0, total: 8232,
    line_items: [li("Freight Shipping - Domestic (pallets)", 12, 450, 5400), li("Warehouse Storage (monthly)", 1, 2400, 2400), li("Fuel Surcharge", 1, 432, 432)],
  }),
  "INV_006_duplicate_of_001.pdf": inv({
    vendor_name: "Acme Office Supplies", vendor_email: "billing@acmeoffice.com",
    invoice_number: "ACM-2026-0451", po_reference: "PO-2026-0100",
    subtotal: 4250, tax: 350.62, total: 4600.62,
    line_items: [li("Premium Copy Paper (Case)", 50, 45, 2250), li("Ink Cartridges - Black", 20, 65, 1300), li("Desk Organizer Set", 10, 70, 700)],
  }),
  "INV_007_unknown_vendor.pdf": inv({
    vendor_name: "NovaTech Consulting Group", vendor_email: "billing@novatechgroup.co",
    invoice_number: "NV-2026-0001", po_reference: null,
    subtotal: 17850, tax: 0, total: 17850,
    line_items: [li("Strategic Consulting (retainer)", 1, 12000, 12000), li("Market Analysis", 1, 3850, 3850), li("Advisory Sessions", 1, 2000, 2000)],
  }),
  "INV_008_bank_change_globaltech.pdf": inv({
    vendor_name: "GlobalTech Solutions", vendor_email: "ap@globaltech.io",
    invoice_number: "GT-2026-0095", po_reference: "PO-2026-0101",
    subtotal: 18500, tax: 1526.25, total: 20026.25, bank_account: "9900-1122-3388",
    line_items: [li("Annual Software License - Enterprise", 1, 12000, 12000), li("Implementation Support (hours)", 50, 130, 6500)],
  }),
  "INV_009_no_po_riverside.pdf": inv({
    vendor_name: "Riverside Catering Co", vendor_email: "orders@riversidecatering.com",
    invoice_number: "RC-2026-0200", po_reference: null,
    subtotal: 6500, tax: 536.25, total: 7036.25,
    line_items: [li("Event Catering - Annual Meeting", 1, 4500, 4500), li("Service Staff", 1, 1500, 1500), li("Equipment Rental", 1, 500, 500)],
  }),
  "INV_011_scanned_style_prime.pdf": inv({
    vendor_name: "Prime Logistics Inc", vendor_email: "finance@primelogistics.com",
    invoice_number: "PL-2026-0790", po_reference: "PO-2026-0106",
    subtotal: 15000, tax: 0, total: 15000,
    line_items: [li("International Freight - Container", 2, 5500, 11000), li("Customs Brokerage Fee", 2, 750, 1500), li("Insurance - Cargo", 2, 1250, 2500)],
  }),
  "INV_012_multicurrency_eur.pdf": inv({
    vendor_name: "GlobalTech Solutions", vendor_email: "ap@globaltech.io",
    invoice_number: "GT-EU-2026-0012", po_reference: "PO-2026-0101", currency: "EUR",
    subtotal: 14700, tax: 2793, total: 17493,
    line_items: [li("Annual Software License - Enterprise (EU)", 1, 11000, 11000), li("Implementation Support (hours)", 20, 185, 3700)],
  }),
  "INV_013_suspicious_round_amount.pdf": inv({
    vendor_name: "NovaTech Consulting Group", vendor_email: "billing@novatechgroup.co",
    invoice_number: "NV-2026-0002", po_reference: null,
    subtotal: 50000, tax: 0, total: 50000, payment_terms: "Due on receipt",
    line_items: [li("Consulting services", 1, 50000, 50000)],
  }),
  "GEN_scanned_acme.pdf": inv({
    document_kind: "scanned",
    vendor_name: "Acme Office Supplies", vendor_email: "billing@acmeoffice.com",
    invoice_number: "ACM-2026-0470", po_reference: "PO-2026-0105",
    subtotal: 1850, tax: 152.63, total: 2002.63,
    line_items: [li("Ergonomic Mouse", 25, 34, 850), li("USB-C Docking Station", 10, 100, 1000)],
  }),
  "GEN_split_metro_1.pdf": inv({
    vendor_name: "Metro Cleaning Services", vendor_email: "invoices@metrocleaning.com",
    invoice_number: "MC-2026-0401", po_reference: "PO-2026-0108",
    subtotal: 1200, tax: 0, total: 1200,
    line_items: [li("Quarterly Deep Cleaning - Q3 (July)", 1, 1200, 1200)],
  }),
  "GEN_split_metro_2.pdf": inv({
    vendor_name: "Metro Cleaning Services", vendor_email: "invoices@metrocleaning.com",
    invoice_number: "MC-2026-0402", po_reference: "PO-2026-0108",
    subtotal: 1200, tax: 0, total: 1200,
    line_items: [li("Quarterly Deep Cleaning - Q3 (August)", 1, 1200, 1200)],
  }),
  "GEN_split_metro_3.pdf": inv({
    vendor_name: "Metro Cleaning Services", vendor_email: "invoices@metrocleaning.com",
    invoice_number: "MC-2026-0403", po_reference: "PO-2026-0108",
    subtotal: 1560, tax: 0, total: 1560,
    line_items: [li("Quarterly Deep Cleaning - Q3 (September)", 1, 1200, 1200), li("Supplemental sanitization (client request)", 1, 360, 360)],
  }),
  "GEN_fraud_globaltech.pdf": inv({
    vendor_name: "GlobalTech Solutions", vendor_email: "accounts@globaltech-pay.com",
    invoice_number: "GT-2026-0099", po_reference: "PO-2026-0101",
    subtotal: 6500, tax: 536.25, total: 7036.25, bank_account: "8844-5562-10", payment_terms: "DUE IMMEDIATELY",
    urgency_language: ["URGENT — PAYMENT DUE IMMEDIATELY", "FINAL NOTICE"],
    line_items: [li("Implementation Support (hours)", 50, 130, 6500)],
    notes: "Banking details changed — remit to new account.",
  }),
  "GEN_missing_fields.pdf": inv({
    vendor_name: "QuickShip Logistics Ltd", vendor_email: "billing@quickship.example",
    invoice_number: null, po_reference: null, subtotal: null, tax: null, total: null,
    field_confidence: { vendor_name: "high", invoice_number: "low", total: "low", po_reference: "low" },
    line_items: [li("Express courier - 14 packages", 14, 0, 0)],
    notes: "Amounts to be confirmed per master service agreement.",
  }),
  "GEN_not_invoice.pdf": inv({
    is_invoice: false, vendor_name: null, invoice_number: null, total: null,
    field_confidence: {}, notes: "A building-management notice about parking garage closure.",
  }),
  // Implied PO: no PO printed; vendor ArgentoHome has one open PO (0107, 253.66) → inferred
  "GEN_implied_po_argento.pdf": inv({
    vendor_name: "ArgentoHome", vendor_email: "billing@argentohome.com",
    invoice_number: "AH-2026-0031", po_reference: null,
    subtotal: 253.66, tax: 0, total: 253.66,
    line_items: [li("Home Furnishing Items", 1, 253.66, 253.66)],
  }),
  // Bundled single line, tax folded into total, no explicit subtotal (DataVault, 800 vs PO-0104)
  "GEN_bundled_datavault.pdf": inv({
    vendor_name: "DataVault Cloud Services", vendor_email: "billing@datavault.cloud",
    invoice_number: "DV-2026-1180", po_reference: "PO-2026-0104",
    subtotal: null, tax: 66, total: 866,
    line_items: [li("Cloud services — August (bundled)", 1, 800, 800)],
  }),
};

/** Write every fixture into the SQLite extraction cache (hash = sha256(pdf).slice(0,16)). */
export function warmFixtures(): number {
  const dir = path.join(process.cwd(), "tests", "sample_invoices");
  let n = 0;
  for (const [file, extracted] of Object.entries(FIXTURES)) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) { console.warn("  ! missing PDF:", file); continue; }
    const hash = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 16);
    putCached(hash, file, extracted);
    n++;
  }
  return n;
}
