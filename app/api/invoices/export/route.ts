// GET /api/invoices/export — a CSV snapshot of every processed invoice + its decision.
// This IS the "retain your answers" mechanism: the SQLite invoices table is the live
// ledger; this generates a portable spreadsheet from it on demand — no separate file is
// maintained. ?inboxOnly=1 restricts to email-derived rows (used as the disconnect
// safety-net, so the download matches exactly what's about to be wiped).
import { ensureSeeded } from "@/lib/bootstrap";
import { listInvoices } from "@/lib/db";
import { toCsv } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  ensureSeeded();
  const inboxOnly = new URL(req.url).searchParams.get("inboxOnly") === "1";
  let rows = listInvoices();
  if (inboxOnly) rows = rows.filter((r) => r.inbox_id != null);

  const csv = toCsv(rows, [
    { header: "Invoice Number", value: (r) => r.invoice_number },
    { header: "Vendor", value: (r) => r.vendor_name },
    { header: "PO", value: (r) => r.matched_po },
    { header: "Currency", value: (r) => r.currency },
    { header: "Amount", value: (r) => r.total },
    { header: "Outcome", value: (r) => r.outcome },
    { header: "Priority", value: (r) => r.priority },
    { header: "Security", value: (r) => (r.security ? "yes" : "no") },
    { header: "Reasons", value: (r) => (r.reasons_json ? JSON.parse(r.reasons_json).map((x: any) => x.code).join("; ") : "") },
    { header: "Headline", value: (r) => r.headline },
    { header: "Resolution", value: (r) => r.resolution },
    { header: "Resolution Note", value: (r) => r.resolution_note },
    { header: "Processed At", value: (r) => r.started_at },
  ]);

  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="invoices-export-${date}.csv"`,
    },
  });
}
