// Unfiltered read of the SQLite tables that back the dashboard — for the /raw page.
// Same DB connection as everything else in the app (lib/db.ts); nothing mocked.
import { ensureSeeded } from "@/lib/bootstrap";
import { listInvoices, getRecentAuditLog, getVendors, getPOs } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  ensureSeeded();
  return Response.json({
    invoices: listInvoices(),
    auditLog: getRecentAuditLog(40),
    vendors: getVendors(),
    purchaseOrders: getPOs(),
  });
}
