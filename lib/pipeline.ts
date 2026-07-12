// The assembly line — SPEC §6. Fixed stage order, code orchestrates,
// LLM only inside stage 3. Every stage emits a StageEvent (stream + persist + audit).
import { randomUUID } from "crypto";
import { PDFDocument, PDFName, PDFRawStream, PDFArray, decodePDFRawStream } from "pdf-lib";
import { createInvoice, finishInvoice, getVendors, getPOs, approvedToDate, saveEvent } from "./db";
import { getProvider, mimeFor } from "./extraction";
import { matchPo, matchVendor } from "./matching";
import { aggregate, money, runRules, type CheckResult } from "./rules/engine";
import type { Decision, ExtractedInvoice, Reason, StageEvent } from "./types";

export interface RunResult {
  runId: string;
  decision: Decision | null;
}

function reason(code: string, category: Reason["category"], severity: Reason["severity"], message: string, evidence: Record<string, unknown> = {}): Reason {
  return { code, category, severity, message, evidence };
}

/**
 * Process one invoice document (PDF or image). Async generator: yields StageEvents
 * as they happen. Fully autonomous — never pauses for input; always ends with a decision.
 */
export async function* processInvoice(bytes: Buffer, filename: string, source: string, inboxId: string | null = null): AsyncGenerator<StageEvent, RunResult> {
  const runId = randomUUID().slice(0, 8);
  const mime = mimeFor(filename);
  const isImage = mime.startsWith("image/");
  createInvoice(runId, source, filename, inboxId);

  let seq = 0;
  const emit = (name: string, title: string, status: StageEvent["status"], summary: string, details: Record<string, unknown>, startedAt: string): StageEvent => {
    const e: StageEvent = {
      runId, stage: ++seq, name, title, status, summary, details,
      startedAt, durationMs: Date.now() - new Date(startedAt).getTime(),
    };
    saveEvent(e);
    return e;
  };
  const now = () => new Date().toISOString();

  // ── 1 · intake ────────────────────────────────────────────────
  let t = now();
  yield emit("intake", "Received the invoice", "done",
    `${filename} · ${(bytes.length / 1024).toFixed(1)} KB`, { filename, bytes: bytes.length, source, mime }, t);

  // ── 2 · classify ──────────────────────────────────────────────
  t = now();
  const kind: "digital" | "scanned" = isImage ? "scanned" : await probeDocumentKind(bytes);
  yield emit("classify", "Read the document", "done",
    isImage
      ? "This is an image invoice — reading it visually"
      : kind === "digital"
        ? "Clean digital document — text is machine-readable"
        : "This looks like a scanned image — no text layer, reading it visually",
    { document_kind: kind, mime, probe: isImage ? "image attachment" : "page-resources font probe" }, t);

  // ── 3 · extract (the ONLY LLM stage) ─────────────────────────
  t = now();
  let inv: ExtractedInvoice | null = null;
  let extractionError: string | null = null;
  try {
    const provider = getProvider();
    try {
      inv = await provider.extract(bytes, { kind, mime });
    } catch {
      inv = await provider.extract(bytes, { kind, mime }); // one retry, then HOLD (SPEC reliability rule)
    }
  } catch (e: any) {
    extractionError = String(e?.message ?? e);
  }

  if (!inv) {
    yield emit("extract", "Pulled out the details", "error",
      "Couldn't read this document — it may be corrupted or too low quality.", { error: extractionError }, t);
    const holdReason = reason("UNREADABLE_DOCUMENT", "data", "HOLD",
      "Couldn't read this document. It may be corrupted or too low quality.", { error: extractionError });
    t = now();
    yield emit("decide", "Reached a decision", "hold",
      "On hold — couldn't read this document.", { outcome: "HOLD", reasons: ["UNREADABLE_DOCUMENT"] }, t);
    const decision = buildDecision("HOLD", "normal", false, [holdReason], 0, 1, null);
    persistDecision(runId, decision, null, null, null);
    return { runId, decision };
  }

  const lowFields = Object.entries(inv.field_confidence || {}).filter(([, c]) => c === "low").map(([f]) => f);
  const extractSummary = inv.is_invoice
    ? [inv.vendor_name, inv.invoice_number, inv.po_reference ? `PO ${inv.po_reference}` : null,
       inv.total != null ? money(inv.total, inv.currency) : null].filter(Boolean).join(" · ")
    : "This doesn't look like an invoice";
  yield emit("extract", "Pulled out the details",
    lowFields.length ? "warning" : "done",
    extractSummary + (lowFields.length ? ` · hard to read: ${lowFields.join(", ")}` : ""),
    { extracted: inv, provider: process.env.EXTRACTION_PROVIDER || "gemini" }, t);

  // Not an invoice → graceful HOLD, skip the rest meaningfully
  if (!inv.is_invoice) {
    const r = reason("NOT_AN_INVOICE", "data", "HOLD", "This document doesn't appear to be an invoice.", {});
    t = now();
    yield emit("decide", "Reached a decision", "hold", "On hold — this doesn't appear to be an invoice.", { outcome: "HOLD" }, t);
    const decision = buildDecision("HOLD", "normal", false, [r], 0, 1, null);
    persistDecision(runId, decision, inv, null, null);
    return { runId, decision };
  }

  // ── 4 · normalize (deterministic) ─────────────────────────────
  t = now();
  const itemised = inv.line_items.length > 1 || (inv.line_items.length === 1 && inv.line_items[0].qty != null);
  const derivedSubtotal = inv.line_items.length ? +inv.line_items.reduce((s, li) => s + (li.amount || 0), 0).toFixed(2) : null;
  let amountBasis: number | null = inv.subtotal;
  let basisNote = "ex-tax subtotal as printed";
  if (amountBasis == null && inv.total != null && inv.tax != null) {
    amountBasis = +(inv.total - inv.tax + (inv.discount ?? 0)).toFixed(2);
    basisNote = "derived: total − tax (+ discount)";
  } else if (amountBasis == null && inv.total != null) {
    amountBasis = inv.total;
    basisNote = "no subtotal/tax shown — using total";
  }
  yield emit("normalize", "Made sense of the numbers", "done",
    `${itemised ? `${inv.line_items.length} line items` : "Bundled amount"} · comparison basis ${amountBasis != null ? money(amountBasis, inv.currency) : "unknown"} (${basisNote})${inv.discount ? ` · discount ${money(inv.discount, inv.currency)} applied` : ""}`,
    { itemised, derived_subtotal: derivedSubtotal, amount_basis: amountBasis, basis_note: basisNote, tax: inv.tax, discount: inv.discount }, t);

  // ── 5 · validate (deterministic data-quality checks) ──────────
  t = now();
  const validateChecks: CheckResult[] = [];
  const missing = (["vendor_name", "invoice_number", "total"] as const).filter((f) => inv![f] == null);
  validateChecks.push(
    missing.length
      ? { code: "MISSING_CRITICAL_FIELD", label: "Critical fields present", passed: false,
          reason: reason("MISSING_CRITICAL_FIELD", "data", "HOLD",
            `Critical information is missing: ${missing.join(", ")}. Can't evaluate without it.`, { fields: missing }) }
      : { code: "MISSING_CRITICAL_FIELD", label: "Critical fields present", passed: true }
  );

  let mathDetail = "";
  let mathOk = true;
  if (itemised && derivedSubtotal != null && inv.subtotal != null && Math.abs(derivedSubtotal - inv.subtotal) > 0.02) {
    mathOk = false;
    mathDetail = `line items sum to ${money(derivedSubtotal, inv.currency)} but subtotal says ${money(inv.subtotal, inv.currency)}`;
  }
  if (mathOk && inv.subtotal != null && inv.tax != null && inv.total != null) {
    const expected = +(inv.subtotal + inv.tax - (inv.discount ?? 0)).toFixed(2);
    if (Math.abs(expected - inv.total) > 0.02) {
      mathOk = false;
      mathDetail = `subtotal + tax${inv.discount ? " − discount" : ""} = ${money(expected, inv.currency)} but total says ${money(inv.total, inv.currency)}`;
    }
  }
  validateChecks.push(
    !mathOk
      ? { code: "MATH_INCONSISTENT", label: "Numbers add up", passed: false,
          reason: reason("MATH_INCONSISTENT", "data", "HOLD", `The numbers don't add up: ${mathDetail}.`, { detail: mathDetail }) }
      : { code: "MATH_INCONSISTENT", label: "Numbers add up", passed: true }
  );

  validateChecks.push(
    inv.field_confidence?.total === "low"
      ? { code: "LOW_CONFIDENCE_TOTAL", label: "Total read reliably", passed: false,
          reason: reason("LOW_CONFIDENCE_TOTAL", "data", "HOLD", "Couldn't read the total amount reliably.", {}) }
      : { code: "LOW_CONFIDENCE_TOTAL", label: "Total read reliably", passed: true }
  );

  const anyHold = validateChecks.some((c) => !c.passed);
  yield emit("validate", "Checked the numbers add up",
    anyHold ? "hold" : "done",
    anyHold
      ? validateChecks.find((c) => !c.passed)!.reason!.message
      : inv.subtotal != null && inv.tax != null && inv.total != null
        ? `${money(inv.subtotal, inv.currency)} + ${money(inv.tax, inv.currency)} tax${inv.discount ? ` − ${money(inv.discount, inv.currency)} discount` : ""} = ${money(inv.total, inv.currency)} ✓`
        : "Required fields present ✓",
    { checks: validateChecks.map((c) => ({ code: c.code, passed: c.passed })) }, t);

  // ── 6 · match PO (two-tier: explicit → implied) ───────────────
  t = now();
  const vendors = getVendors();
  const pos = getPOs();
  const vendorMatch = matchVendor(inv.vendor_name, vendors);
  const poMatch = matchPo({
    explicitRef: inv.po_reference,
    vendorExternalId: vendorMatch.vendor?.external_id ?? null,
    amountBasis,
    pos,
    remainingByPo: (po) => po.total_amount - approvedToDate(po.po_number).sum,
  });
  const matchSummary = poMatch.po
    ? poMatch.method === "explicit"
      ? `${poMatch.po.po_number} — ${vendorMatch.vendor?.name ?? inv.vendor_name} (printed on the invoice)`
      : `${poMatch.po.po_number} — inferred from vendor + amount (no PO printed)`
    : poMatch.refNotFound
      ? `PO ${poMatch.refNotFound} isn't in the register`
      : poMatch.ambiguousCount > 1
        ? `${poMatch.ambiguousCount} open POs could match — ambiguous`
        : "No matching purchase order found";
  yield emit("match", "Matched it to a purchase order",
    poMatch.po && poMatch.method === "explicit" ? "done" : "warning",
    matchSummary,
    { method: poMatch.method, po: poMatch.po?.po_number ?? null, vendor_match: vendorMatch.method, vendor: vendorMatch.vendor?.external_id ?? null, ambiguous: poMatch.ambiguousCount }, t);

  // ── 7 · rules (the deterministic registry) ────────────────────
  t = now();
  const results = runRules({ inv, vendorMatch, poMatch, amountBasis, validateChecks });
  const firedResults = results.filter((r) => !r.passed);
  yield emit("rules", `Ran the ${results.length} checks`,
    firedResults.length ? "warning" : "done",
    firedResults.length
      ? `${results.length - firedResults.length} of ${results.length} passed · flagged: ${firedResults.map((f) => f.reason!.code).join(", ")}`
      : `All ${results.length} checks passed`,
    { checks: results.map((r) => ({ code: r.code, label: r.label, passed: r.passed })) }, t);

  // ── 8 · decide ────────────────────────────────────────────────
  t = now();
  const agg = aggregate(results);
  const decision = buildDecision(agg.outcome, agg.priority, agg.security, agg.reasons, agg.checksPassed, agg.checksTotal, poMatch.po?.po_number ?? null);
  persistDecision(runId, decision, inv, vendorMatch.vendor?.external_id ?? null, amountBasis);
  yield emit("decide", "Reached a decision",
    agg.outcome === "APPROVE" ? "done" : agg.outcome === "REVIEW" ? "warning" : "hold",
    decision.headline, { outcome: agg.outcome, priority: agg.priority, security: agg.security, reasons: agg.reasons.map((r) => r.code) }, t);

  return { runId, decision };
}

/**
 * Digital vs scanned: does any page's content stream actually DRAW TEXT
 * (Tj/TJ/'/" operators)? An image-only scan has none. More robust than
 * probing for a /Font resource key, which pdf-lib scaffolds even on image pages.
 */
async function probeDocumentKind(pdf: Buffer): Promise<"digital" | "scanned"> {
  try {
    const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
    for (const page of doc.getPages()) {
      const contents = page.node.get(PDFName.of("Contents"));
      const streams: PDFRawStream[] = [];
      const collect = (obj: unknown) => {
        const r = obj && typeof obj === "object" && "tag" in obj ? doc.context.lookup(obj as never) : obj;
        if (r instanceof PDFRawStream) streams.push(r);
        else if (r instanceof PDFArray) r.asArray().forEach(collect);
      };
      collect(contents);
      let ops = "";
      for (const s of streams) {
        try { ops += Buffer.from(decodePDFRawStream(s).decode()).toString("latin1"); } catch {}
      }
      if (/\bTj\b|\bTJ\b|\)\s*'|\)\s*"/.test(ops)) return "digital";
    }
    return "scanned";
  } catch {
    return "scanned"; // unparseable → treat as scan; vision reads it anyway
  }
}

/** One plain-English headline for a decision, used in the decide event and the run record. */
function headlineFor(d: Decision): string {
  if (d.outcome === "APPROVE")
    return `Approved — matched ${d.matchedPo}; all ${d.checksTotal} checks passed.`;
  if (d.outcome === "HOLD")
    return `On hold — ${d.reasons.find((r) => r.severity === "HOLD")?.message ?? "can't evaluate this invoice."}`;
  if (d.security)
    return `Security review — do not pay until verified. ${d.reasons.filter((r) => r.category === "fraud").map((r) => r.code.replaceAll("_", " ").toLowerCase()).join(", ")}.`;
  return `Needs review — ${d.reasons[0]?.message ?? "one or more checks flagged this invoice."}`;
}

function buildDecision(
  outcome: Decision["outcome"], priority: Decision["priority"], security: boolean,
  reasons: Reason[], checksPassed: number, checksTotal: number, matchedPo: string | null
): Decision {
  const d: Decision = { outcome, priority, security, headline: "", reasons, checksPassed, checksTotal, matchedPo };
  d.headline = headlineFor(d);
  return d;
}

function persistDecision(runId: string, d: Decision, inv: ExtractedInvoice | null, vendorExt: string | null, amountBasis: number | null): void {
  finishInvoice(runId, {
    outcome: d.outcome,
    priority: d.priority,
    security: d.security ? 1 : 0,
    headline: d.headline,
    reasons_json: JSON.stringify(d.reasons),
    matched_po: d.matchedPo,
    invoice_number: inv?.invoice_number ?? null,
    vendor_external_id: vendorExt,
    vendor_name: inv?.vendor_name ?? null,
    currency: inv?.currency ?? null,
    amount_basis: amountBasis,
    total: inv?.total ?? null,
    extracted_json: inv ? JSON.stringify(inv) : null,
    checks_passed: d.checksPassed,
    checks_total: d.checksTotal,
  });
}
