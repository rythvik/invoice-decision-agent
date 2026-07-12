// Email connection status + IMAP save/disconnect. Gmail OAuth is handled under
// /api/auth/gmail/*. POST here tests IMAP credentials before saving.
import { ensureSeeded } from "@/lib/bootstrap";
import { clearEmailData } from "@/lib/db";
import { getEmailConfig, saveEmailConfig, clearEmailConfig } from "@/lib/ingestion/config";
import { emailStatus } from "@/lib/ingestion";
import { clearGoogleAuth } from "@/lib/ingestion/google";
import { connectImap } from "@/lib/ingestion/imap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  ensureSeeded();
  const c = getEmailConfig();
  return Response.json({
    ...emailStatus(),
    host: c?.host ?? "imap.gmail.com",
    port: c?.port ?? 993,
    mailbox: c?.mailbox ?? "INBOX",
  });
}

export async function POST(req: Request) {
  ensureSeeded();
  const b = await req.json().catch(() => ({}));
  const cfg = {
    host: String(b.host || "").trim(),
    port: Number(b.port || 993),
    user: String(b.user || "").trim(),
    password: String(b.password || "").replace(/\s+/g, ""), // Gmail shows app passwords with spaces
    mailbox: String(b.mailbox || "INBOX").trim() || "INBOX",
  };
  if (!cfg.host || !cfg.user || !cfg.password) {
    return Response.json({ error: "Host, email and app password are all required." }, { status: 400 });
  }
  try {
    const client = await connectImap(cfg);
    await client.logout().catch(() => {});
  } catch (e: any) {
    return Response.json({ error: String(e?.message ?? e) }, { status: 400 });
  }
  saveEmailConfig(cfg);
  return Response.json({ ok: true, user: cfg.user });
}

export async function DELETE() {
  ensureSeeded();
  clearGoogleAuth();
  clearEmailConfig();
  clearEmailData(); // privacy: forget the account's emails, attachments, and the decisions made from them
  return Response.json({ ok: true });
}
