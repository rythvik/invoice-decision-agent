import { ensureSeeded } from "@/lib/bootstrap";
import { getEvents, getInvoice } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  ensureSeeded();
  const { id } = await params;
  const invoice: any = getInvoice(id);
  if (!invoice) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({
    invoice: {
      ...invoice,
      reasons: invoice.reasons_json ? JSON.parse(invoice.reasons_json) : [],
      extracted: invoice.extracted_json ? JSON.parse(invoice.extracted_json) : null,
    },
    events: getEvents(id),
  });
}
