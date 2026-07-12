// Kick off "Sign in with Google" → redirect to Google's consent screen.
import { buildAuthUrl } from "@/lib/ingestion/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.redirect(buildAuthUrl(), 302);
  } catch (e: any) {
    return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
