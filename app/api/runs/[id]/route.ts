import { ensureSeeded } from "@/lib/bootstrap";
import { getEvents, getRun } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  ensureSeeded();
  const { id } = await params;
  const run: any = getRun(id);
  if (!run) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({
    run: {
      ...run,
      reasons: run.reasons_json ? JSON.parse(run.reasons_json) : [],
      extracted: run.extracted_json ? JSON.parse(run.extracted_json) : null,
    },
    events: getEvents(id),
  });
}
