import { ensureSeeded } from "@/lib/bootstrap";
import { listRuns } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  ensureSeeded();
  const runs = listRuns().map((r: any) => ({ ...r, reasons: r.reasons_json ? JSON.parse(r.reasons_json) : [] }));
  return Response.json({ runs });
}
