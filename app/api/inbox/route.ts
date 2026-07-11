import { ensureSeeded } from "@/lib/bootstrap";
import { listInbox } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  ensureSeeded();
  return Response.json({ messages: listInbox() });
}
