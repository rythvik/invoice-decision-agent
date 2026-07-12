// Human action on a FINISHED invoice (never mid-run): approve or reject a REVIEW/HOLD item.
import { ensureSeeded } from "@/lib/bootstrap";
import { getInvoice, resolveInvoice } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  ensureSeeded();
  const { id } = await params;
  const invoice: any = getInvoice(id);
  if (!invoice) return Response.json({ error: "not found" }, { status: 404 });
  if (invoice.outcome === "APPROVE") return Response.json({ error: "already auto-approved" }, { status: 400 });
  const body = await req.json();
  const resolution = body.resolution === "approved" ? "approved" : body.resolution === "rejected" ? "rejected" : null;
  if (!resolution) return Response.json({ error: "resolution must be approved|rejected" }, { status: 400 });
  if (!body.note || String(body.note).trim().length < 3)
    return Response.json({ error: "a note is required when resolving" }, { status: 400 });
  resolveInvoice(id, resolution, String(body.note).trim());
  return Response.json({ ok: true });
}
