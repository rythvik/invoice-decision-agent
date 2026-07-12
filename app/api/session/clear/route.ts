// Fired via navigator.sendBeacon when the tab/app closes — wipes every run this
// visitor produced (invoices, audit trail, fetched emails, extraction cache) while
// keeping the vendor + PO masters, so a shared deployment starts clean for the next visitor.
import { clearAllRunData } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  clearAllRunData();
  return new Response(null, { status: 204 });
}
