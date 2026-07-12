// Core contracts — mirror SPEC.md §2–§4. SPEC is the source of truth.

export type Outcome = "APPROVE" | "REVIEW" | "REJECT" | "HOLD";
export type Severity = "HOLD" | "REJECT" | "REVIEW";
export type RuleCategory = "data" | "business" | "fraud";
export type Confidence = "high" | "medium" | "low";

export interface LineItem {
  description: string;
  qty: number | null;
  unit_price: number | null;
  amount: number;
}

export interface ExtractedInvoice {
  is_invoice: boolean;
  document_kind: "digital" | "scanned";
  vendor_name: string | null;
  vendor_email: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  po_reference: string | null;
  currency: string;
  line_items: LineItem[];
  subtotal: number | null;
  tax: number | null;
  discount: number | null;
  total: number | null;
  bank_account: string | null;
  remit_to_name: string | null;
  vendor_tax_id: string | null;
  payment_terms: string | null;
  urgency_language: string[];
  field_confidence: Record<string, Confidence>;
  notes: string | null;
}

export interface Reason {
  code: string;
  category: RuleCategory;
  severity: Severity;
  message: string;
  evidence: Record<string, unknown>;
}

export interface Decision {
  outcome: Outcome;
  priority: "normal" | "high";
  security: boolean;
  headline: string;
  reasons: Reason[];
  checks: { code: string; label: string; passed: boolean }[];
  checksPassed: number;
  checksTotal: number;
  matchedPo: string | null;
}

export type StageStatus = "running" | "done" | "warning" | "hold" | "error";

export interface StageEvent {
  runId: string;
  stage: number;
  name: string;
  title: string;
  status: StageStatus;
  summary: string;
  details: Record<string, unknown>;
  startedAt: string;
  durationMs: number;
}

export interface Vendor {
  external_id: string;
  name: string;
  aliases: string[];
  email: string | null;
  email_domain: string | null;
  tax_id: string | null;
  bank_account_last4: string | null;
  status: string;
}

export interface PurchaseOrder {
  po_number: string;
  vendor_external_id: string;
  status: string;
  currency: string;
  total_amount: number;
  line_items: LineItem[];
}

export interface InboxMessage {
  id: string; // IMAP UID / Message-ID — used for idempotent fetch
  from_addr: string;
  subject: string;
  received_at: string;
  attachments: string[]; // one email can carry several invoices
  status: "unread" | "processed";
}

// ── context passed between pipeline stages ──────────────────────
export interface VendorMatch {
  vendor: Vendor | null;
  method: "exact" | "alias" | "fuzzy" | "none";
  score: number;
}

export interface PoMatch {
  po: PurchaseOrder | null;
  method: "explicit" | "implied" | "none";
  ambiguousCount: number;
  refNotFound: string | null; // explicit ref that wasn't in the register
}

export interface RunContext {
  runId: string;
  filename: string;
  pdf: Buffer;
  documentKind: "digital" | "scanned";
  extracted?: ExtractedInvoice;
  amountBasis?: number | null; // ex-tax subtotal per SPEC
  amountBasisNote?: string;
  vendorMatch?: VendorMatch;
  poMatch?: PoMatch;
  holdReasons: Reason[]; // accumulated by validate stage
  reasons: Reason[]; // accumulated by rules stage
  checksTotal: number;
  checksPassed: number;
}

export interface ExtractHints {
  kind: "digital" | "scanned";
  mime: string; // application/pdf | image/jpeg | image/png
}

export interface ExtractionProvider {
  name: string;
  extract(bytes: Buffer, hints: ExtractHints): Promise<ExtractedInvoice>;
}

// One fetched email with its invoice attachments, plus the raw bytes accessor.
export interface FetchedMessage {
  id: string;
  from_addr: string;
  subject: string;
  received_at: string;
  attachments: { filename: string; bytes: Buffer }[];
}

export interface IngestionSource {
  name: string;
  /** Pull new messages since the given known ids; implementations skip already-seen ids. */
  fetchNew(knownIds: Set<string>): Promise<FetchedMessage[]>;
}
