// Complete the OAuth loopback flow: the inbox page posts the ?code it received at
// http://localhost:3000; we exchange it for a refresh token and save the connection.
import { ensureSeeded } from "@/lib/bootstrap";
import { exchangeCode, saveGoogleAuth } from "@/lib/ingestion/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  ensureSeeded();
  const { code } = await req.json().catch(() => ({}));
  if (!code) return Response.json({ error: "missing code" }, { status: 400 });
  try {
    const { email, refresh_token } = await exchangeCode(String(code));
    saveGoogleAuth(email, refresh_token);
    return Response.json({ ok: true, email });
  } catch (e: any) {
    return Response.json({ error: String(e?.message ?? e) }, { status: 400 });
  }
}
