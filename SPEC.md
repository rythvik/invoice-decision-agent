# SPEC — invoice-decision-agent

Single source of truth. Code is verified against this document.

---

## 1. Assumptions (referenced in the live pitch)

1. **2-way match** (invoice ↔ PO). No goods-receipt data exists, so 3-way match is out of scope.
2. **Single legal entity** receives all invoices ("TechCorp Inc."). Multi-entity routing out of scope.
3. **Base currency USD.** An invoice in another currency is never numerically compared to a USD PO — it routes to REVIEW (`CURRENCY_MISMATCH`). FX conversion is a production concern, not simulated.
4. **Cumulative billed on a PO** = sum of totals of previously APPROVEd invoices matched to that PO. REVIEW/HOLD/REJECT items don't count until resolved as approved.
5. **The process decides firmly.** Policy (revised from an earlier "never hard-reject" stance): **REJECT is the dominant negative outcome** — anything confidently wrong (duplicate, bank change, unregistered vendor, no PO, large overage, fraud signals, inconsistent math) is auto-rejected. **REVIEW is a small residual bucket** reserved for genuinely soft/ambiguous findings (a borderline 5–10% overage, a currency mismatch, a missing date, a document that's readable but incomplete or the wrong type). **HOLD** is reserved for true extraction failure only — we couldn't read the document at all, so we can't even attempt a decision. A human can always override any REJECT/REVIEW/HOLD from the dashboard.
6. **Duplicate** = same normalized invoice number + same vendor as any previously processed run (any outcome except HOLD).
7. Ingestion is real email (Gmail OAuth or IMAP app-password), connected on-screen; manual upload is also supported.

## 2. Decision object (the output)

```ts
type Outcome = "APPROVE" | "REVIEW" | "REJECT" | "HOLD";

interface Decision {
  outcome: Outcome;
  priority: "normal" | "high";        // high = REJECT, any fraud rule, or ≥3 reasons
  security: boolean;                   // true if any fraud-category rule fired
  headline: string;                    // one plain-English sentence, e.g.
                                       // "Approved — matched PO-2026-0100, all 11 checks passed."
  reasons: Reason[];                   // every rule that fired (empty for clean APPROVE)
  checks: { code: string; label: string; passed: boolean }[]; // full check list, for the compact glance-checklist
  checksPassed: number; checksTotal: number;
  matchedPo: string | null;
}
// The full extracted invoice (§3) is persisted on the run record and in the
// extract stage event — not duplicated on the decision object.

interface Reason {
  code: string;                        // e.g. "BANK_ACCOUNT_CHANGED"
  category: "data" | "business" | "fraud";
  severity: "HOLD" | "REJECT" | "REVIEW";
  message: string;                     // plain English with evidence, from §5 templates
  evidence: Record<string, unknown>;   // the numbers/values behind the message
}
```

## 3. Extracted invoice schema (what the vision model must return)

```ts
interface ExtractedInvoice {
  is_invoice: boolean;                 // false → NOT_AN_INVOICE
  document_kind: "digital" | "scanned";
  vendor_name: string | null;
  vendor_email: string | null;         // for lookalike-domain check
  invoice_number: string | null;
  invoice_date: string | null;         // ISO
  due_date: string | null;
  po_reference: string | null;         // explicit PO number if printed
  currency: string;                    // ISO code, default USD if unambiguous
  line_items: { description: string; qty: number | null; unit_price: number | null; amount: number }[];
  subtotal: number | null;
  tax: number | null;
  discount: number | null;
  total: number | null;
  bank_account: string | null;         // any payment/remit-to account shown
  remit_to_name: string | null;
  vendor_tax_id: string | null;        // vendor's tax id if printed

  payment_terms: string | null;
  urgency_language: string[];          // verbatim phrases like "URGENT", "pay immediately"
  field_confidence: Record<string, "high" | "medium" | "low">; // per critical field
  notes: string | null;
}
```

Critical fields: `vendor_name`, `invoice_number`, `total`. Missing → REVIEW (readable, just incomplete — see §5). `invoice_date` missing → REVIEW.

## 4. StageEvent (the visibility contract)

```ts
interface StageEvent {
  runId: string;
  stage: 1|2|3|4|5|6|7|8;
  name: string;                        // machine name, e.g. "extract"
  title: string;                       // plain UI title, e.g. "Pulled out the details"
  status: "running" | "done" | "warning" | "hold" | "error";
  summary: string;                     // plain-English one-liner with real values
  details: Record<string, unknown>;    // technical payload (expandable in UI)
  startedAt: string; durationMs: number;
}
```

Streamed over SSE during the run; persisted to `stage_events`; rendered by live-run view and replay.

## 5. Rule registry (frozen)

**Outcome precedence: HOLD > REJECT > REVIEW > APPROVE.** `security=true` if any
fraud-category rule fires. `priority=high` if `outcome === "REJECT"`, any fraud rule fires,
or ≥3 reasons fired.

**Policy (revised — see Assumption 5):** REJECT is the dominant negative outcome —
anything confidently, decisively wrong is auto-rejected. REVIEW is a small residual bucket
for genuinely soft/ambiguous findings. HOLD is reserved for true extraction failure only.

### HOLD — can't evaluate at all (true extraction failure only)

| Code | Trigger | Message template |
|---|---|---|
| UNREADABLE_DOCUMENT | extraction failed after 1 retry | "Couldn't read this document. It may be corrupted or too low quality." |

### REJECT — evaluated, decisively wrong

| Code | Trigger | Message template |
|---|---|---|
| MATH_INCONSISTENT | \|subtotal + tax − discount − total\| > 0.02, or \|Σline_items − subtotal\| > 0.02 (only when itemised) | "The numbers don't add up: {detail}." (data confidently read but internally inconsistent — a decisive finding, not ambiguous) |
| UNKNOWN_VENDOR | no vendor-master match (exact→alias→fuzzy ≥0.85) | "{vendor} isn't in the approved vendor list." |
| VENDOR_INACTIVE | matched vendor status ≠ active | "{vendor} is marked inactive — they shouldn't be billing us." |
| PO_NOT_FOUND | explicit PO ref not in register, and no implied match | "PO {ref} isn't in our purchase order register." / "No PO reference found and none could be inferred." |
| PO_VENDOR_MISMATCH | matched PO belongs to a different vendor | "Invoice is from {vendor} but PO {po} belongs to {po_vendor}." |
| DUPLICATE | same invoice_number+vendor seen before | "Looks like a duplicate of invoice {number}, already processed on {date} (run {id})." |
| AMOUNT_SIGNIFICANTLY_OVER | overage > 10% vs PO remaining | "Invoice is {pct}% over the PO — well beyond tolerance." |
| PO_OVERBILLED | (approved-to-date + this invoice) > PO total × 1.05 | "With this invoice, PO {po} would be billed {cum} of {po_total} ({pct}%) — over-billed across {n} invoices." (the split-PO abuse pattern) |
| BANK_ACCOUNT_CHANGED | invoice bank account ≠ vendor master (last-4 compare) | "Bank account differs from the one on file (****{master4}). Classic BEC pattern — verify with the vendor by phone before paying." |
| TAX_ID_MISMATCH | invoice tax id ≠ vendor master | "Tax ID doesn't match the vendor's registration on file." |
| REMIT_TO_MISMATCH | remit_to_name ≉ vendor_name (fuzzy <0.7) | "Payment is directed to '{remit}' — not the vendor's name." |
| LOOKALIKE_EMAIL_DOMAIN | email domain ≠ master domain but similarity ≥0.75 | "Sender domain {domain} looks like — but isn't — the vendor's real domain {master_domain}." |
| URGENCY_LANGUAGE | urgency_language non-empty | "Pressure language on the invoice: {phrases}. Legitimate vendors rarely do this." |
| ROUND_AMOUNT_NO_DETAIL | total ≥ 5000, round (multiple of 1000), and ≤1 line item | "A suspiciously round {total} with no line-item detail." |
| DORMANT_VENDOR_ACTIVITY | vendor inactive AND bank account changed | "An inactive vendor suddenly invoicing with new bank details — treat as suspect." |

### REVIEW — evaluated, genuinely soft/ambiguous (residual bucket)

| Code | Trigger | Message template |
|---|---|---|
| MISSING_CRITICAL_FIELD | vendor_name, invoice_number or total is null | "Critical information is missing: {fields}. Worth a human glance." (readable, just incomplete — not a reading failure) |
| LOW_CONFIDENCE_TOTAL | field_confidence.total = "low" | "Couldn't read the total amount reliably." (our OCR confidence, not the vendor's fault) |
| LOW_CONFIDENCE_FIELD | any other critical field "low" | "Some fields were hard to read: {fields} — worth a human glance." |
| NOT_AN_INVOICE | `is_invoice=false` | "This document doesn't appear to be an invoice." (readable, just the wrong document type) |
| MISSING_DATE | invoice_date is null | "The invoice has no date — worth a human glance before paying." |
| PO_MATCH_AMBIGUOUS | implied matching found >1 plausible PO | "Couldn't confidently pick between {n} open POs for this vendor." |
| CURRENCY_MISMATCH | invoice currency ≠ PO currency | "Invoice is in {inv_ccy} but the PO is in {po_ccy} — amounts can't be compared directly." (an honest data gap, not fraud) |
| AMOUNT_OVER_TOLERANCE | this invoice alone: 5% < overage ≤ 10% vs PO remaining | "Invoice is {pct}% over the PO — beyond the 5% tolerance." (borderline; reasonable scope changes happen) |

Amount rules are **directional** (overage only; under-billing passes) and evaluated against
**PO remaining value** (po_total − approved_to_date) for the single-invoice bands, plus the
cumulative check above. Tolerance base: 5%; reject line: 10%.

**Amount basis: the ex-tax subtotal** (POs are ex-tax). Fallback: total − tax; if neither
derivable, use total and note it. (Verified against samples: INV_001 subtotal 4,250 = PO 4,250 →
APPROVE; its with-tax total 4,600.62 would falsely read 8% over.)

## 6. Pipeline stages → UI titles

| # | name | UI title | Emits warning when |
|---|---|---|---|
| 1 | intake | "Received the invoice" | — |
| 2 | classify | "Read the document" | scanned (info, not warning) |
| 3 | extract | "Pulled out the details" | low-confidence fields |
| 4 | normalize | "Made sense of the numbers" | discount/bundled/tax quirks noted |
| 5 | validate | "Checked the numbers add up" | MATH_INCONSISTENT → hold |
| 6 | match | "Matched it to a purchase order" | implied match used, ambiguous, not found |
| 7 | rules | "Ran the {n} checks" | any rule fired |
| 8 | decide | "Reached a decision" | outcome ≠ APPROVE |

Stage 2 (classify) is deterministic: pdf text-layer probe → digital vs scanned. Stage 3 sends the
PDF to the ExtractionProvider regardless (vision handles both); classify informs the UI narrative
and the extraction prompt. Stages 4–8 are deterministic code. LLM is used **only** in stage 3.

## 7. Pluggable interfaces

```ts
interface ExtractionProvider {                    // env: EXTRACTION_PROVIDER (comma-sep chain)
  name: string;
  extract(bytes: Buffer, hints: { kind: "digital"|"scanned"; mime: string }): Promise<ExtractedInvoice>;
}
// GeminiProvider (multi-model, REST, PDF/image as inline base64) + OllamaProvider (local qwen2.5vl).
// "gemini,ollama" = cloud first, auto-fall to local on the daily cap. CachingProvider wraps the chain.
// Input can be PDF or image (JPG/PNG) — mime is derived from the filename.

interface IngestionSource {                       // env: INGESTION_SOURCE
  fetchNew(knownIds: Set<string>): Promise<FetchedMessage[]>;
}
// ImapSource — real mailbox via app password (IMAP_*). Idempotent: knownIds skip already-seen
// emails so the same invoice is never re-scraped. One email may carry several attachments →
// several invoices, processed sequentially (a duplicate later in the email is caught).
```

## 8. Storage (SQLite)

```
vendors(id, external_id, name, aliases_json, email, email_domain, tax_id,
        bank_account_last4, status, created_at)
purchase_orders(id, po_number, vendor_external_id, status, currency,
        total_amount, line_items_json, created_at)
runs(id, source, filename, started_at, finished_at, outcome, priority,
        security, headline, reasons_json, matched_po, extracted_json,
        resolution, resolution_note, resolved_at)      -- resolution: approved|rejected|null
stage_events(id, run_id, stage, name, title, status, summary, details_json,
        started_at, duration_ms)
inbox_messages(id, from_addr, subject, received_at, attachment, status)  -- unread|processed
```

Approved-to-date for a PO = Σ runs.total where matched_po = PO and
(outcome='APPROVE' OR resolution='approved'), excluding DUPLICATE-flagged runs.

## 9. Test world & golden map

Vendors and POs adapted from the reference repo's seed (coherent with its 15 sample PDFs),
plus: PO-2026-0108 (Metro Cleaning, $3,600, quarterly) for the split-PO series.
Bill-to entity: TechCorp Inc.

| PDF | Scenario | Expected outcome |
|---|---|---|
| INV_001_clean_acme_office.pdf | happy path | APPROVE |
| INV_002_clean_metro_cleaning.pdf | clean, no tax | APPROVE |
| INV_003_clean_datavault.pdf | monthly billing vs annual PO (under) | APPROVE |
| INV_004_amount_mismatch_globaltech.pdf | ~10.5% over | REJECT (high) |
| INV_005_amount_mismatch_prime.pdf | ~5.5% over | REVIEW |
| INV_006_duplicate_of_001.pdf | duplicate (run after 001) | REJECT — DUPLICATE (high) |
| INV_007_unknown_vendor.pdf | unknown vendor, no PO | REJECT (high) |
| INV_008_bank_change_globaltech.pdf | BEC bank change | REJECT 🛡️ (high) |
| INV_009_no_po_riverside.pdf | inactive vendor, no PO | REJECT (high) |
| INV_011_scanned_style_prime.pdf | clean | APPROVE |
| INV_012_multicurrency_eur.pdf | EUR vs USD PO | REVIEW — CURRENCY_MISMATCH |
| INV_013_suspicious_round_amount.pdf | unknown + round 50k + no detail | REJECT 🛡️ (high) |
| GEN_scanned_acme.pdf (generated: rasterized image-only) | scanned edge case | APPROVE |
| GEN_split_metro_1.pdf ($1,200 vs PO-0108) | split 1/3 | APPROVE |
| GEN_split_metro_2.pdf ($1,200) | split 2/3 | APPROVE |
| GEN_split_metro_3.pdf ($1,560) | cumulative $3,960 > $3,780 (105%) | REJECT — PO_OVERBILLED (high) |
| GEN_fraud_globaltech.pdf (bank change + URGENT + lookalike domain) | BEC composite | REJECT 🛡️ (high) |
| GEN_missing_fields.pdf (no invoice #, no total) | unknown vendor + no PO outrank the missing-field finding | REJECT (high) |
| GEN_not_invoice.pdf (a letter) | not an invoice — readable, wrong document type | REVIEW — NOT_AN_INVOICE |
| GEN_implied_po_argento.pdf | no PO printed → inferred from vendor+amount | APPROVE |
| GEN_bundled_datavault.pdf | bundled single line, tax in total | APPROVE |

Golden runner: `npm run golden` → processes each PDF in order, asserts outcome (+ key reason
codes), prints a pass/fail table. Order matters (001 before 006; split series in sequence).
Distribution: 9 APPROVE, 9 REJECT, 3 REVIEW, 0 HOLD (HOLD requires a true extraction
failure, which no fixture simulates — see Assumption 5).

## 10. Demo edge cases (the 4 we present)

1. GEN_scanned_acme.pdf → APPROVE (vision robustness)
2. INV_006 duplicate → REJECT with named original (control)
3. GEN_split_metro_3 → REJECT PO_OVERBILLED (stateful matching, split-PO abuse pattern)
4. GEN_fraud_globaltech → REJECT 🛡️ high (fraud module)
