import fs from "fs";
import path from "path";
import { loadEnv } from "./env";
loadEnv();
import { getProvider } from "../lib/extraction";

(async () => {
  const pdf = fs.readFileSync(path.join(process.cwd(), "data/inbox/INV_001_clean_acme_office.pdf"));
  console.log("Provider:", process.env.EXTRACTION_PROVIDER, "· model:", process.env.GEMINI_MODEL);
  console.log("Calling Gemini…");
  const inv = await getProvider().extract(pdf, { kind: "digital" });
  console.log(JSON.stringify({
    is_invoice: inv.is_invoice, vendor: inv.vendor_name, number: inv.invoice_number,
    po: inv.po_reference, subtotal: inv.subtotal, tax: inv.tax, total: inv.total, currency: inv.currency,
    lines: inv.line_items.length, confidence: inv.field_confidence,
  }, null, 2));
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
