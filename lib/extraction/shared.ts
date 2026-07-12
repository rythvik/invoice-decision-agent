// Shared extraction prompt + defensive JSON normalization, used by every provider.
import type { ExtractedInvoice } from "../types";

export const PROMPT = `You are an invoice data extractor for an accounts-payable system.
Read the attached document and return ONLY a JSON object with exactly this shape:

{
  "is_invoice": boolean,            // false if this is not an invoice (letter, resume, etc.)
  "document_kind": "digital" | "scanned",
  "vendor_name": string | null,     // the party ISSUING the invoice (not the bill-to / not the customer)
  "vendor_email": string | null,
  "invoice_number": string | null,
  "invoice_date": string | null,    // ISO yyyy-mm-dd
  "due_date": string | null,
  "po_reference": string | null,    // purchase order number if printed anywhere
  "currency": string,               // ISO code (USD, EUR, INR...). Infer from symbols if needed.
  "line_items": [ { "description": string, "qty": number|null, "unit_price": number|null, "amount": number } ],
  "subtotal": number | null,        // pre-tax sum if shown
  "tax": number | null,
  "discount": number | null,        // positive number if a discount is applied
  "total": number | null,
  "bank_account": string | null,    // any bank/remittance account number shown
  "remit_to_name": string | null,   // ONLY if a distinct "remit to / make checks payable to" PAYEE name is shown that differs from the vendor; else null
  "vendor_tax_id": string | null,
  "payment_terms": string | null,
  "urgency_language": string[],     // verbatim pressure phrases: "URGENT", "pay immediately", "final notice", "due immediately"...
  "field_confidence": { "vendor_name": "high|medium|low", "invoice_number": "...", "total": "...", "po_reference": "..." },
  "notes": string | null
}

Rules:
- Extract what is PRINTED. Never invent values. Missing → null.
- vendor_name is who is BILLING us (the sender/issuer). Do not confuse with the "Bill To" customer.
- remit_to_name: leave null unless there is an explicit separate payee. Do NOT echo the vendor name here.
- Numbers: plain numbers, no currency symbols or thousands separators.
- field_confidence reflects how clearly you could read each field.
- If the page is an image/scan, still extract; set document_kind accordingly.`;

export function sanitizeExtraction(p: any): ExtractedInvoice {
  const num = (v: unknown): number | null => {
    if (v == null) return null;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
  return {
    is_invoice: Boolean(p.is_invoice),
    document_kind: p.document_kind === "scanned" ? "scanned" : "digital",
    vendor_name: str(p.vendor_name),
    vendor_email: str(p.vendor_email),
    invoice_number: str(p.invoice_number),
    invoice_date: str(p.invoice_date),
    due_date: str(p.due_date),
    po_reference: str(p.po_reference),
    currency: (str(p.currency) || "USD").toUpperCase(),
    line_items: Array.isArray(p.line_items)
      ? p.line_items
          .filter((li: any) => li && (li.description || li.amount != null))
          .map((li: any) => ({
            description: String(li.description ?? ""),
            qty: num(li.qty),
            unit_price: num(li.unit_price),
            amount: num(li.amount) ?? 0,
          }))
      : [],
    subtotal: num(p.subtotal),
    tax: num(p.tax),
    discount: num(p.discount),
    total: num(p.total),
    bank_account: str(p.bank_account),
    remit_to_name: str(p.remit_to_name),
    vendor_tax_id: str(p.vendor_tax_id),
    payment_terms: str(p.payment_terms),
    urgency_language: Array.isArray(p.urgency_language) ? p.urgency_language.map(String) : [],
    field_confidence: typeof p.field_confidence === "object" && p.field_confidence ? p.field_confidence : {},
    notes: str(p.notes),
  };
}
