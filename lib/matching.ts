// Vendor + PO matching (deterministic). SPEC §5 UNKNOWN_VENDOR / §6 stage 6.
import type { PurchaseOrder, PoMatch, Vendor, VendorMatch } from "./types";

/** Normalize a company name for comparison: lowercase, strip punctuation + legal suffixes. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|co|corp|corporation|company|services|svc|group)\b\.?/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][n];
}

export function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - levenshtein(a, b) / maxLen;
}

export function matchVendor(invoiceVendorName: string | null, vendors: Vendor[]): VendorMatch {
  if (!invoiceVendorName) return { vendor: null, method: "none", score: 0 };
  const norm = normalizeName(invoiceVendorName);
  for (const v of vendors) {
    if (normalizeName(v.name) === norm) return { vendor: v, method: "exact", score: 1 };
  }
  for (const v of vendors) {
    if (v.aliases.some((a) => normalizeName(a) === norm)) return { vendor: v, method: "alias", score: 1 };
  }
  let best: { v: Vendor; s: number } | null = null;
  for (const v of vendors) {
    const s = similarity(normalizeName(v.name), norm);
    if (!best || s > best.s) best = { v, s };
  }
  if (best && best.s >= 0.85) return { vendor: best.v, method: "fuzzy", score: best.s };
  return { vendor: null, method: "none", score: best?.s ?? 0 };
}

export function normalizePoRef(ref: string): string {
  return ref.toUpperCase().replace(/\s+/g, "").replace(/^PO[:#]?/, "PO-").replace(/--+/g, "-");
}

/**
 * Two-tier PO matching (SPEC stage 6):
 * 1. explicit ref → register lookup
 * 2. no ref → infer among the matched vendor's open POs by amount plausibility
 */
export function matchPo(opts: {
  explicitRef: string | null;
  vendorExternalId: string | null;
  amountBasis: number | null;
  pos: PurchaseOrder[];
  remainingByPo: (po: PurchaseOrder) => number;
}): PoMatch {
  const { explicitRef, vendorExternalId, amountBasis, pos, remainingByPo } = opts;

  if (explicitRef) {
    const norm = normalizePoRef(explicitRef);
    const po = pos.find((p) => normalizePoRef(p.po_number) === norm) || null;
    if (po) return { po, method: "explicit", ambiguousCount: 0, refNotFound: null };
    return { po: null, method: "none", ambiguousCount: 0, refNotFound: explicitRef };
  }

  if (!vendorExternalId || amountBasis == null)
    return { po: null, method: "none", ambiguousCount: 0, refNotFound: null };

  const open = pos.filter((p) => p.vendor_external_id === vendorExternalId && p.status === "open");
  // plausible: invoice fits within remaining value + 10% headroom
  const plausible = open.filter((p) => amountBasis <= remainingByPo(p) * 1.1);
  if (plausible.length === 1) return { po: plausible[0], method: "implied", ambiguousCount: 0, refNotFound: null };
  if (plausible.length > 1) {
    // tighter pass: within 5% of remaining on exactly one PO
    const tight = plausible.filter((p) => Math.abs(amountBasis - remainingByPo(p)) / remainingByPo(p) <= 0.05);
    if (tight.length === 1) return { po: tight[0], method: "implied", ambiguousCount: 0, refNotFound: null };
    return { po: null, method: "none", ambiguousCount: plausible.length, refNotFound: null };
  }
  return { po: null, method: "none", ambiguousCount: 0, refNotFound: null };
}

/** Lookalike domain: different domain whose core resembles/contains the real vendor's. */
export function isLookalikeDomain(invoiceDomain: string, masterDomain: string): boolean {
  const core = (d: string) => d.toLowerCase().split(".")[0];
  const a = core(invoiceDomain), b = core(masterDomain);
  if (invoiceDomain.toLowerCase() === masterDomain.toLowerCase()) return false;
  if (a === b) return true; // same core, different TLD e.g. globaltech.io vs globaltech.com
  if (a.includes(b) || b.includes(a)) return true; // globaltech-pay vs globaltech
  return similarity(a, b) >= 0.75;
}
