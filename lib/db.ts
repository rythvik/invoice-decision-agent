import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type { InboxMessage, PurchaseOrder, StageEvent, Vendor } from "./types";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "storage", "app.db");

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.exec(SCHEMA);
  return _db;
}

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
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, filename TEXT NOT NULL,
  started_at TEXT NOT NULL, finished_at TEXT,
  outcome TEXT, priority TEXT, security INTEGER NOT NULL DEFAULT 0,
  headline TEXT, reasons_json TEXT, matched_po TEXT,
  invoice_number TEXT, vendor_external_id TEXT, vendor_name TEXT,
  currency TEXT, amount_basis REAL, total REAL,
  extracted_json TEXT, checks_passed INTEGER, checks_total INTEGER,
  resolution TEXT, resolution_note TEXT, resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at);
CREATE INDEX IF NOT EXISTS idx_runs_invnum ON runs(invoice_number);
CREATE TABLE IF NOT EXISTS stage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, stage INTEGER NOT NULL,
  name TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}', started_at TEXT NOT NULL, duration_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_run ON stage_events(run_id);
CREATE TABLE IF NOT EXISTS inbox_messages (
  id TEXT PRIMARY KEY, from_addr TEXT NOT NULL, subject TEXT NOT NULL,
  received_at TEXT NOT NULL, attachment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unread', run_id TEXT
);
`;

// ── master data ────────────────────────────────────────────────
export function getVendors(): Vendor[] {
  return db()
    .prepare("SELECT * FROM vendors")
    .all()
    .map((r: any) => ({ ...r, aliases: JSON.parse(r.aliases_json) }));
}

export function getPOs(): PurchaseOrder[] {
  return db()
    .prepare("SELECT * FROM purchase_orders")
    .all()
    .map((r: any) => ({ ...r, line_items: JSON.parse(r.line_items_json) }));
}

export function getPO(poNumber: string): PurchaseOrder | null {
  const r: any = db().prepare("SELECT * FROM purchase_orders WHERE UPPER(po_number)=UPPER(?)").get(poNumber);
  return r ? { ...r, line_items: JSON.parse(r.line_items_json) } : null;
}

// ── runs ───────────────────────────────────────────────────────
export function createRun(id: string, source: string, filename: string): void {
  db()
    .prepare("INSERT INTO runs (id, source, filename, started_at) VALUES (?,?,?,?)")
    .run(id, source, filename, new Date().toISOString());
}

export function finishRun(runId: string, fields: Record<string, unknown>): void {
  const keys = Object.keys(fields);
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  db()
    .prepare(`UPDATE runs SET ${sets}, finished_at = ? WHERE id = ?`)
    .run(...keys.map((k) => fields[k]), new Date().toISOString(), runId);
}

export function getRun(runId: string): any {
  return db().prepare("SELECT * FROM runs WHERE id = ?").get(runId);
}

export function listRuns(): any[] {
  return db().prepare("SELECT * FROM runs ORDER BY started_at DESC").all();
}

export function resolveRun(runId: string, resolution: "approved" | "rejected", note: string): void {
  db()
    .prepare("UPDATE runs SET resolution=?, resolution_note=?, resolved_at=? WHERE id=?")
    .run(resolution, note, new Date().toISOString(), runId);
}

// ── stage events ───────────────────────────────────────────────
export function saveEvent(e: StageEvent): void {
  db()
    .prepare(
      `INSERT INTO stage_events (run_id, stage, name, title, status, summary, details_json, started_at, duration_ms)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run(e.runId, e.stage, e.name, e.title, e.status, e.summary, JSON.stringify(e.details), e.startedAt, e.durationMs);
}

export function getEvents(runId: string): StageEvent[] {
  return db()
    .prepare("SELECT * FROM stage_events WHERE run_id = ? ORDER BY id")
    .all(runId)
    .map((r: any) => ({
      runId: r.run_id, stage: r.stage, name: r.name, title: r.title, status: r.status,
      summary: r.summary, details: JSON.parse(r.details_json), startedAt: r.started_at, durationMs: r.duration_ms,
    }));
}

// ── decision-support queries ───────────────────────────────────
/** Prior processed run with same invoice number + vendor (duplicate check). */
export function findDuplicate(invoiceNumber: string, vendorKey: string): any {
  return db()
    .prepare(
      `SELECT * FROM runs
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
      `SELECT COALESCE(SUM(amount_basis),0) AS s, COUNT(*) AS c FROM runs
       WHERE matched_po = ? AND (outcome = 'APPROVE' OR resolution = 'approved')
         AND (reasons_json IS NULL OR reasons_json NOT LIKE '%DUPLICATE%')`
    )
    .get(poNumber);
  return { sum: r.s, count: r.c };
}

// ── inbox ──────────────────────────────────────────────────────
export function listInbox(): InboxMessage[] {
  return db().prepare("SELECT * FROM inbox_messages ORDER BY received_at").all() as InboxMessage[];
}

export function getInboxMessage(id: string): InboxMessage | null {
  return (db().prepare("SELECT * FROM inbox_messages WHERE id = ?").get(id) as InboxMessage) || null;
}

export function markProcessed(id: string, runId: string): void {
  db().prepare("UPDATE inbox_messages SET status='processed', run_id=? WHERE id=?").run(runId, id);
}

export function addInboxMessage(m: InboxMessage): void {
  db()
    .prepare("INSERT INTO inbox_messages (id, from_addr, subject, received_at, attachment, status) VALUES (?,?,?,?,?,?)")
    .run(m.id, m.from_addr, m.subject, m.received_at, m.attachment, m.status);
}

// ── seeding ────────────────────────────────────────────────────
export function seedAll(dataDir: string): { vendors: number; pos: number; inbox: number } {
  const now = new Date().toISOString();
  const vendors = JSON.parse(fs.readFileSync(path.join(dataDir, "vendors.json"), "utf-8")).vendors;
  const pos = JSON.parse(fs.readFileSync(path.join(dataDir, "purchase_orders.json"), "utf-8")).purchase_orders;
  const inbox = JSON.parse(fs.readFileSync(path.join(dataDir, "inbox.json"), "utf-8")).messages;
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
  const mIns = d.prepare(
    "INSERT OR IGNORE INTO inbox_messages (id,from_addr,subject,received_at,attachment,status) VALUES (?,?,?,?,?,?)"
  );
  for (const m of inbox) mIns.run(m.id, m.from_addr, m.subject, m.received_at, m.attachment, m.status);
  return { vendors: vendors.length, pos: pos.length, inbox: inbox.length };
}

export function resetDb(): void {
  const d = db();
  d.exec("DELETE FROM runs; DELETE FROM stage_events; DELETE FROM inbox_messages; DELETE FROM vendors; DELETE FROM purchase_orders;");
}
