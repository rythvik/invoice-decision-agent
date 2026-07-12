// Deterministic rule engine — SPEC §5, frozen registry.
// Every rule: evaluate → fired/passed + plain-English message with evidence.
// The LLM never decides anything here.
import { approvedToDate, findDuplicate } from "../db";
import { isLookalikeDomain, similarity, normalizeName } from "../matching";
import type { ExtractedInvoice, PoMatch, Reason, VendorMatch } from "../types";

export interface CheckResult {
  code: string;
  label: string; // plain-English name shown in UI check list
  passed: boolean;
  reason?: Reason;
}

const TOLERANCE = 0.05; // 5%
const SIGNIFICANT = 0.10; // 10%

export function money(n: number, ccy = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: ccy }).format(n);
}

function fired(
  code: string,
  label: string,
  category: Reason["category"],
  severity: Reason["severity"],
  message: string,
  evidence: Record<string, unknown>
): CheckResult {
  return { code, label, passed: false, reason: { code, category, severity, message, evidence } };
}
function passed(code: string, label: string): CheckResult {
  return { code, label, passed: true };
}

/**
 * Runs the business + fraud registry. Data-quality checks (NOT_AN_INVOICE,
 * MISSING_CRITICAL_FIELD, MATH_INCONSISTENT, LOW_CONFIDENCE_TOTAL) live in the
 * validate stage; their results are passed in so the check count is complete.
 */
export function runRules(opts: {
  inv: ExtractedInvoice;
  vendorMatch: VendorMatch;
  poMatch: PoMatch;
  amountBasis: number | null;
  validateChecks: CheckResult[];
}): CheckResult[] {
  const { inv, vendorMatch, poMatch, amountBasis, validateChecks } = opts;
  const results: CheckResult[] = [...validateChecks];
  const vendor = vendorMatch.vendor;
  const po = poMatch.po;
  const currencyComparable = !!po && inv.currency === po.currency;

  // ── business ──────────────────────────────────────────────────
  // LOW_CONFIDENCE_FIELD (non-total criticals)
  {
    const lows = ["vendor_name", "invoice_number", "po_reference"].filter(
      (f) => inv.field_confidence?.[f] === "low"
    );
    results.push(
      lows.length
        ? fired("LOW_CONFIDENCE_FIELD", "Fields read clearly", "business", "REVIEW",
            `Some fields were hard to read: ${lows.join(", ")} — worth a human glance.`, { fields: lows })
        : passed("LOW_CONFIDENCE_FIELD", "Fields read clearly")
    );
  }

  // MISSING_DATE — evaluable, but a dated invoice is expected
  results.push(
    inv.invoice_date == null
      ? fired("MISSING_DATE", "Invoice is dated", "business", "REVIEW",
          "The invoice has no date — worth a human glance before paying.", {})
      : passed("MISSING_DATE", "Invoice is dated")
  );

  // UNKNOWN_VENDOR
  results.push(
    !vendor
      ? fired("UNKNOWN_VENDOR", "Vendor is approved", "business", "REJECT",
          `${inv.vendor_name ?? "This vendor"} isn't in the approved vendor list.`,
          { vendor_name: inv.vendor_name, best_similarity: vendorMatch.score })
      : passed("UNKNOWN_VENDOR", "Vendor is approved")
  );

  // VENDOR_INACTIVE
  results.push(
    vendor && vendor.status !== "active"
      ? fired("VENDOR_INACTIVE", "Vendor is active", "business", "REJECT",
          `${vendor.name} is marked inactive — they shouldn't be billing us.`, { status: vendor.status })
      : passed("VENDOR_INACTIVE", "Vendor is active")
  );

  // PO_NOT_FOUND / PO_VENDOR_MISMATCH / PO_MATCH_AMBIGUOUS
  if (!po) {
    if (poMatch.refNotFound) {
      results.push(fired("PO_NOT_FOUND", "PO matched", "business", "REJECT",
        `PO ${poMatch.refNotFound} isn't in our purchase order register.`, { ref: poMatch.refNotFound }));
    } else if (poMatch.ambiguousCount > 1) {
      results.push(fired("PO_MATCH_AMBIGUOUS", "PO matched", "business", "REVIEW",
        `Couldn't confidently pick between ${poMatch.ambiguousCount} open POs for this vendor.`,
        { candidates: poMatch.ambiguousCount }));
    } else {
      results.push(fired("PO_NOT_FOUND", "PO matched", "business", "REJECT",
        "No PO reference found and none could be inferred.", {}));
    }
  } else {
    results.push(passed("PO_NOT_FOUND", "PO matched"));
    // PO_VENDOR_MISMATCH
    results.push(
      vendor && po.vendor_external_id !== vendor.external_id
        ? fired("PO_VENDOR_MISMATCH", "PO belongs to this vendor", "business", "REJECT",
            `Invoice is from ${vendor.name} but PO ${po.po_number} belongs to a different vendor.`,
            { po: po.po_number, po_vendor: po.vendor_external_id, invoice_vendor: vendor.external_id })
        : passed("PO_VENDOR_MISMATCH", "PO belongs to this vendor")
    );
    // CURRENCY_MISMATCH
    results.push(
      !currencyComparable
        ? fired("CURRENCY_MISMATCH", "Currency matches the PO", "business", "REVIEW",
            `Invoice is in ${inv.currency} but the PO is in ${po.currency} — amounts can't be compared directly.`,
            { invoice_currency: inv.currency, po_currency: po.currency })
        : passed("CURRENCY_MISMATCH", "Currency matches the PO")
    );
  }

  // DUPLICATE
  if (inv.invoice_number) {
    const vendorKey = vendor?.external_id ?? inv.vendor_name ?? "";
    const dupe = findDuplicate(inv.invoice_number, vendorKey);
    results.push(
      dupe
        ? fired("DUPLICATE", "Not a duplicate", "business", "REJECT",
            `Looks like a duplicate of invoice ${inv.invoice_number}, already processed on ${String(dupe.started_at).slice(0, 10)}.`,
            { original_run: dupe.id, original_outcome: dupe.outcome, original_date: dupe.started_at })
        : passed("DUPLICATE", "Not a duplicate")
    );
  } else {
    results.push(passed("DUPLICATE", "Not a duplicate"));
  }

  // Amount bands — directional, vs PO REMAINING value; ex-tax basis (SPEC §5)
  if (po && currencyComparable && amountBasis != null) {
    const { sum: approvedSum, count: priorCount } = approvedToDate(po.po_number);
    const remaining = po.total_amount - approvedSum;
    const over = amountBasis - remaining;
    // null = the PO has no remaining budget at all (already fully or over-consumed) — the
    // "over remaining" ratio is undefined, not a finite percentage.
    const pct = remaining > 0 ? over / remaining : null;

    if (over > 0 && (pct === null || pct > SIGNIFICANT)) {
      const message = pct === null
        ? `This PO has no remaining budget — already billed ${money(approvedSum, po.currency)} of ${money(po.total_amount, po.currency)}, and this invoice would add ${money(amountBasis, po.currency)} more.`
        : `Invoice is ${(pct * 100).toFixed(1)}% over the PO's remaining value (${money(amountBasis, po.currency)} vs ${money(remaining, po.currency)}) — well beyond the 5% tolerance.`;
      results.push(fired("AMOUNT_SIGNIFICANTLY_OVER", "Amount within tolerance", "business", "REJECT",
        message, { basis: amountBasis, remaining, pct_over: pct === null ? null : +(pct * 100).toFixed(1) }));
    } else if (over > 0 && pct !== null && pct > TOLERANCE) {
      results.push(fired("AMOUNT_OVER_TOLERANCE", "Amount within tolerance", "business", "REVIEW",
        `Invoice is ${(pct * 100).toFixed(1)}% over the PO's remaining value (${money(amountBasis, po.currency)} vs ${money(remaining, po.currency)}) — beyond the 5% tolerance.`,
        { basis: amountBasis, remaining, pct_over: +(pct * 100).toFixed(1) }));
    } else {
      results.push(passed("AMOUNT_BANDS", "Amount within tolerance"));
    }

    // PO_OVERBILLED — cumulative across invoices; only meaningful with prior approved billing
    const cumulative = approvedSum + amountBasis;
    const overbilled = priorCount > 0 && cumulative > po.total_amount * (1 + TOLERANCE);
    results.push(
      overbilled
        ? fired("PO_OVERBILLED", "PO not over-billed cumulatively", "business", "REJECT",
            `With this invoice, PO ${po.po_number} would be billed ${money(cumulative, po.currency)} of ${money(po.total_amount, po.currency)} (${((cumulative / po.total_amount) * 100).toFixed(0)}%) across ${priorCount + 1} invoices — over-billed.`,
            { cumulative, po_total: po.total_amount, invoices: priorCount + 1 })
        : passed("PO_OVERBILLED", "PO not over-billed cumulatively")
    );
  }

  // ── fraud / security ──────────────────────────────────────────
  // BANK_ACCOUNT_CHANGED
  let bankChanged = false;
  if (vendor?.bank_account_last4 && inv.bank_account) {
    const digits = inv.bank_account.replace(/\D/g, "");
    const last4 = digits.slice(-4);
    bankChanged = last4.length === 4 && last4 !== vendor.bank_account_last4;
    results.push(
      bankChanged
        ? fired("BANK_ACCOUNT_CHANGED", "Bank account matches file", "fraud", "REJECT",
            `Bank account differs from the one on file (****${vendor.bank_account_last4}). Classic BEC pattern — verify with the vendor by phone before paying.`,
            { invoice_last4: last4, master_last4: vendor.bank_account_last4 })
        : passed("BANK_ACCOUNT_CHANGED", "Bank account matches file")
    );
  } else {
    results.push(passed("BANK_ACCOUNT_CHANGED", "Bank account matches file"));
  }

  // TAX_ID_MISMATCH
  results.push(
    vendor?.tax_id && inv.vendor_tax_id && inv.vendor_tax_id.replace(/\D/g, "") !== vendor.tax_id.replace(/\D/g, "")
      ? fired("TAX_ID_MISMATCH", "Tax ID matches file", "fraud", "REJECT",
          "Tax ID doesn't match the vendor's registration on file.",
          { invoice_tax_id: inv.vendor_tax_id, master_tax_id: vendor.tax_id })
      : passed("TAX_ID_MISMATCH", "Tax ID matches file")
  );

  // REMIT_TO_MISMATCH
  results.push(
    inv.remit_to_name && inv.vendor_name &&
      similarity(normalizeName(inv.remit_to_name), normalizeName(inv.vendor_name)) < 0.7
      ? fired("REMIT_TO_MISMATCH", "Payee is the vendor", "fraud", "REJECT",
          `Payment is directed to "${inv.remit_to_name}" — not the vendor's name.`,
          { remit_to: inv.remit_to_name, vendor: inv.vendor_name })
      : passed("REMIT_TO_MISMATCH", "Payee is the vendor")
  );

  // LOOKALIKE_EMAIL_DOMAIN
  {
    const domain = inv.vendor_email?.split("@")[1];
    results.push(
      vendor?.email_domain && domain && isLookalikeDomain(domain, vendor.email_domain)
        ? fired("LOOKALIKE_EMAIL_DOMAIN", "Email domain is genuine", "fraud", "REJECT",
            `Sender domain ${domain} looks like — but isn't — the vendor's real domain ${vendor.email_domain}.`,
            { invoice_domain: domain, master_domain: vendor.email_domain })
        : passed("LOOKALIKE_EMAIL_DOMAIN", "Email domain is genuine")
    );
  }

  // URGENCY_LANGUAGE
  results.push(
    inv.urgency_language.length > 0
      ? fired("URGENCY_LANGUAGE", "No pressure language", "fraud", "REJECT",
          `Pressure language on the invoice: ${inv.urgency_language.map((p) => `"${p}"`).join(", ")}. Legitimate vendors rarely do this.`,
          { phrases: inv.urgency_language })
      : passed("URGENCY_LANGUAGE", "No pressure language")
  );

  // ROUND_AMOUNT_NO_DETAIL
  results.push(
    inv.total != null && inv.total >= 5000 && inv.total % 1000 === 0 && inv.line_items.length <= 1
      ? fired("ROUND_AMOUNT_NO_DETAIL", "Amount has real detail", "fraud", "REJECT",
          `A suspiciously round ${money(inv.total, inv.currency)} with no line-item detail.`,
          { total: inv.total, line_items: inv.line_items.length })
      : passed("ROUND_AMOUNT_NO_DETAIL", "Amount has real detail")
  );

  // DORMANT_VENDOR_ACTIVITY
  results.push(
    vendor && vendor.status !== "active" && bankChanged
      ? fired("DORMANT_VENDOR_ACTIVITY", "No dormant-vendor anomaly", "fraud", "REJECT",
          "An inactive vendor suddenly invoicing with new bank details — treat as suspect.",
          { vendor: vendor.name })
      : passed("DORMANT_VENDOR_ACTIVITY", "No dormant-vendor anomaly")
  );

  return results;
}

/** Aggregate check results into the final decision fields. SPEC §2 + §5. */
export function aggregate(results: CheckResult[]): {
  outcome: "APPROVE" | "REVIEW" | "REJECT" | "HOLD";
  priority: "normal" | "high";
  security: boolean;
  reasons: Reason[];
  checks: { code: string; label: string; passed: boolean }[];
  checksPassed: number;
  checksTotal: number;
} {
  const reasons = results.filter((r) => !r.passed && r.reason).map((r) => r.reason!);
  // Precedence: HOLD (can't evaluate) > REJECT (evaluated, decisive no) > REVIEW (soft/ambiguous) > APPROVE
  const outcome = reasons.some((r) => r.severity === "HOLD")
    ? "HOLD"
    : reasons.some((r) => r.severity === "REJECT")
      ? "REJECT"
      : reasons.length > 0
        ? "REVIEW"
        : "APPROVE";
  const security = reasons.some((r) => r.category === "fraud");
  const priority = outcome === "REJECT" || security || reasons.length >= 3 ? "high" : "normal";
  return {
    outcome,
    priority,
    security,
    reasons,
    checks: results.map((r) => ({ code: r.code, label: r.label, passed: r.passed })),
    checksPassed: results.filter((r) => r.passed).length,
    checksTotal: results.length,
  };
}
