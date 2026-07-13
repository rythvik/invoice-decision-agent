import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type { ExtractedInvoice, InboxMessage, PurchaseOrder, StageEvent, Vendor } from "./types";

// Resolved lazily (not at import time) so scripts can set DB_PATH before the first
// db() call — ESM hoists imports above top-level assignments, so a module-level
// const would capture the default before an override runs.
function dbPath(): string {
  return process.env.DB_PATH || path.join(process.cwd(), "storage", "app.db");
}
function mailDir(): string {
  return path.join(path.dirname(dbPath()), "mail"); // fetched attachment bytes live here
}

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  const p = dbPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  _db = new Database(p);
  _db.pragma("journal_mode = WAL");
  _db.exec(SCHEMA);
  migrate(_db);
  return _db;
}

/** Lightweight in-place migrations for columns added after a DB already exists locally. */
function migrate(d: Database.Database): void {
  try {
    d.exec("ALTER TABLE invoices ADD COLUMN checks_json TEXT");
  } catch {
    /* column already exists */
  }
}

// Tables (all browsable in any SQLite viewer):
//   vendors / purchase_orders = the masters
//   invoices                  = each processed invoice + its decision
//   audit_log                 = the step-by-step trail for every invoice
//   inbox                     = received emails (real, via IMAP)
//   extraction_cache          = one row per unique document read (avoids re-calling the LLM)
const SCHEMA = `
CREATE TABLE IF NOT EXISTS vendors (
  external_id TEXT PRIMARY KEY, name TEXT NOT NULL, aliases_json TEXT NOT NULL DEFAULT '[]',
  email TEXT, email_domain TEXT, tax_id TEXT, bank_account_last4 TEXT,
  status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS purchase_orders (
  po_number TEXT PRIMARY KEY, vendor_external_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
  currency TEXT NOT NULL DEFAULT 'USD', total_amount REAL NOT NULL, line_items_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, filename TEXT NOT NULL,
  inbox_id TEXT, started_at TEXT NOT NULL, finished_at TEXT,
  outcome TEXT, priority TEXT, security INTEGER NOT NULL DEFAULT 0,
  headline TEXT, reasons_json TEXT, checks_json TEXT, matched_po TEXT,
  invoice_number TEXT, vendor_external_id TEXT, vendor_name TEXT,
  currency TEXT, amount_basis REAL, total REAL,
  extracted_json TEXT, checks_passed INTEGER, checks_total INTEGER,
  resolution TEXT, resolution_note TEXT, resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_invoices_started ON invoices(started_at);
CREATE INDEX IF NOT EXISTS idx_invoices_invnum ON invoices(invoice_number);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id TEXT NOT NULL, stage INTEGER NOT NULL,
  name TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}', started_at TEXT NOT NULL, duration_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_invoice ON audit_log(invoice_id);
CREATE TABLE IF NOT EXISTS inbox (
  id TEXT PRIMARY KEY, from_addr TEXT NOT NULL, subject TEXT NOT NULL,
  received_at TEXT NOT NULL, attachments_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'unread'
);
CREATE TABLE IF NOT EXISTS extraction_cache (
  hash TEXT PRIMARY KEY, filename TEXT, extracted_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL
);
`;

// ── settings (key/value; e.g. saved email connection) ─────────
export function getSetting(key: string): string | null {
  const r: any = db().prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return r ? r.value : null;
}

export function setSetting(key: string, value: string): void {
  db().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

export function deleteSetting(key: string): void {
  db().prepare("DELETE FROM settings WHERE key = ?").run(key);
}

// ── master data ────────────────────────────────────────────────
export function getVendors(): Vendor[] {
  return db().prepare("SELECT * FROM vendors").all().map((r: any) => ({ ...r, aliases: JSON.parse(r.aliases_json) }));
}

export function getPOs(): PurchaseOrder[] {
  return db().prepare("SELECT * FROM purchase_orders").all().map((r: any) => ({ ...r, line_items: JSON.parse(r.line_items_json) }));
}

// ── invoices (processed) ───────────────────────────────────────
export function createInvoice(id: string, source: string, filename: string, inboxId: string | null): void {
  db()
    .prepare("INSERT INTO invoices (id, source, filename, inbox_id, started_at) VALUES (?,?,?,?,?)")
    .run(id, source, filename, inboxId, new Date().toISOString());
}

export function finishInvoice(id: string, fields: Record<string, unknown>): void {
  const keys = Object.keys(fields);
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  db().prepare(`UPDATE invoices SET ${sets}, finished_at = ? WHERE id = ?`).run(...keys.map((k) => fields[k]), new Date().toISOString(), id);
}

export function getInvoice(id: string): any {
  return db().prepare("SELECT * FROM invoices WHERE id = ?").get(id);
}

export function listInvoices(): any[] {
  return db().prepare("SELECT * FROM invoices ORDER BY started_at DESC").all();
}

export function resolveInvoice(id: string, resolution: "approved" | "rejected", note: string): void {
  db().prepare("UPDATE invoices SET resolution=?, resolution_note=?, resolved_at=? WHERE id=?").run(resolution, note, new Date().toISOString(), id);
}

// ── audit log ──────────────────────────────────────────────────
export function saveEvent(e: StageEvent): void {
  db()
    .prepare(`INSERT INTO audit_log (invoice_id, stage, name, title, status, summary, details_json, started_at, duration_ms)
              VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(e.runId, e.stage, e.name, e.title, e.status, e.summary, JSON.stringify(e.details), e.startedAt, e.durationMs);
}

export function getEvents(invoiceId: string): StageEvent[] {
  return db()
    .prepare("SELECT * FROM audit_log WHERE invoice_id = ? ORDER BY id")
    .all(invoiceId)
    .map((r: any) => ({
      runId: r.invoice_id, stage: r.stage, name: r.name, title: r.title, status: r.status,
      summary: r.summary, details: JSON.parse(r.details_json), startedAt: r.started_at, durationMs: r.duration_ms,
    }));
}

/** Most recent audit_log rows across all invoices — raw feed for the /raw debug view. */
export function getRecentAuditLog(limit = 40): any[] {
  return db().prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?").all(limit);
}

// ── decision-support queries ───────────────────────────────────
/** Prior processed invoice with same number + vendor (duplicate check). */
export function findDuplicate(invoiceNumber: string, vendorKey: string): any {
  return db()
    .prepare(
      `SELECT * FROM invoices
       WHERE UPPER(REPLACE(invoice_number,' ','')) = UPPER(REPLACE(?, ' ', ''))
         AND (vendor_external_id = ? OR UPPER(vendor_name) = UPPER(?))
         AND outcome IS NOT NULL AND outcome != 'HOLD'
       ORDER BY started_at LIMIT 1`
    )
    .get(invoiceNumber, vendorKey, vendorKey);
}

/** Σ ex-tax amounts already APPROVEd (auto or human-resolved) against a PO, excluding duplicates. */
export function approvedToDate(poNumber: string): { sum: number; count: number } {
  const r: any = db()
    .prepare(
      `SELECT COALESCE(SUM(amount_basis),0) AS s, COUNT(*) AS c FROM invoices
       WHERE matched_po = ? AND (outcome = 'APPROVE' OR resolution = 'approved')
         AND (reasons_json IS NULL OR reasons_json NOT LIKE '%DUPLICATE%')`
    )
    .get(poNumber);
  return { sum: r.s, count: r.c };
}

// ── extraction cache (SQLite) ──────────────────────────────────
export function getCached(hash: string): ExtractedInvoice | null {
  const r: any = db().prepare("SELECT extracted_json FROM extraction_cache WHERE hash = ?").get(hash);
  return r ? (JSON.parse(r.extracted_json) as ExtractedInvoice) : null;
}

export function putCached(hash: string, filename: string, extracted: ExtractedInvoice): void {
  db()
    .prepare("INSERT OR REPLACE INTO extraction_cache (hash, filename, extracted_json, created_at) VALUES (?,?,?,?)")
    .run(hash, filename, JSON.stringify(extracted), new Date().toISOString());
}

// ── inbox (real email, idempotent) ─────────────────────────────
export function listInbox(): InboxMessage[] {
  return db()
    .prepare("SELECT * FROM inbox ORDER BY received_at DESC")
    .all()
    .map((r: any) => ({ ...r, attachments: JSON.parse(r.attachments_json) }));
}

export function getInboxMessage(id: string): InboxMessage | null {
  const r: any = db().prepare("SELECT * FROM inbox WHERE id = ?").get(id);
  return r ? { ...r, attachments: JSON.parse(r.attachments_json) } : null;
}

export function knownInboxIds(): Set<string> {
  return new Set(db().prepare("SELECT id FROM inbox").all().map((r: any) => r.id));
}

export function addInboxMessage(m: InboxMessage): void {
  db()
    .prepare("INSERT OR IGNORE INTO inbox (id, from_addr, subject, received_at, attachments_json, status) VALUES (?,?,?,?,?,?)")
    .run(m.id, m.from_addr, m.subject, m.received_at, JSON.stringify(m.attachments), m.status);
}

export function markInboxProcessed(id: string): void {
  db().prepare("UPDATE inbox SET status='processed' WHERE id=?").run(id);
}

/** Forget all fetched emails + their stored attachments (used when disconnecting an account). */
export function clearInbox(): void {
  db().exec("DELETE FROM inbox;");
  fs.rmSync(mailDir(), { recursive: true, force: true });
}

/**
 * Forget everything derived from a mailbox: the fetched emails, their attachments,
 * AND the decisions made from them (audit trail included). Invoices processed via
 * Upload (inbox_id IS NULL) are kept — they never came from the mailbox.
 */
export function clearEmailData(): void {
  db().exec(`
    DELETE FROM audit_log WHERE invoice_id IN (SELECT id FROM invoices WHERE inbox_id IS NOT NULL);
    DELETE FROM invoices WHERE inbox_id IS NOT NULL;
    DELETE FROM inbox;
  `);
  fs.rmSync(mailDir(), { recursive: true, force: true });
}

/**
 * Wipe every run this visitor produced — invoices, their audit trail, fetched
 * emails, and the extraction cache — while keeping the vendor + PO masters intact.
 * Called when the browser tab/app closes (via navigator.sendBeacon) so a shared
 * deployment never carries one visitor's company data into the next visitor's session.
 */
export function clearAllRunData(): void {
  db().exec(`
    DELETE FROM audit_log;
    DELETE FROM invoices;
    DELETE FROM inbox;
    DELETE FROM extraction_cache;
  `);
  fs.rmSync(mailDir(), { recursive: true, force: true });
}

// ── attachment bytes on disk (storage/mail/<msgId>/<filename>) ─
export function saveAttachment(msgId: string, filename: string, bytes: Buffer): void {
  const dir = path.join(mailDir(), sanitize(msgId));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, sanitize(filename)), bytes);
}

export function readAttachment(msgId: string, filename: string): Buffer {
  return fs.readFileSync(path.join(mailDir(), sanitize(msgId), sanitize(filename)));
}

/** Delete an email's stored attachment bytes once it's been processed (the mail is the archive). */
export function clearMail(msgId: string): void {
  fs.rmSync(path.join(mailDir(), sanitize(msgId)), { recursive: true, force: true });
}

function sanitize(s: string): string {
  return s.replace(/[^\w.\-]/g, "_");
}

// ── seeding (masters only — the inbox is real email now) ───────
export function seedMasters(dataDir: string): { vendors: number; pos: number } {
  const now = new Date().toISOString();
  const vendors = JSON.parse(fs.readFileSync(path.join(dataDir, "vendors.json"), "utf-8")).vendors;
  const pos = JSON.parse(fs.readFileSync(path.join(dataDir, "purchase_orders.json"), "utf-8")).purchase_orders;
  const d = db();
  const vIns = d.prepare(
    "INSERT OR REPLACE INTO vendors (external_id,name,aliases_json,email,email_domain,tax_id,bank_account_last4,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)"
  );
  for (const v of vendors)
    vIns.run(v.external_id, v.name, JSON.stringify(v.aliases || []), v.email, v.email_domain, v.tax_id, v.bank_account_last4, v.status, now);
  const pIns = d.prepare(
    "INSERT OR REPLACE INTO purchase_orders (po_number,vendor_external_id,status,currency,total_amount,line_items_json,created_at) VALUES (?,?,?,?,?,?,?)"
  );
  for (const p of pos)
    pIns.run(p.po_number, p.vendor_external_id, p.status, p.currency, p.total_amount, JSON.stringify(p.line_items || []), now);
  return { vendors: vendors.length, pos: pos.length };
}

export function resetDb(): void {
  db().exec("DELETE FROM invoices; DELETE FROM audit_log; DELETE FROM inbox; DELETE FROM vendors; DELETE FROM purchase_orders;");
}
