import { ensureSeeded } from "@/lib/bootstrap";
import { clearInbox, listInbox } from "@/lib/db";
import { checkMail, emailConfigured } from "@/lib/ingestion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET → current inbox. Invariant: no mailbox connected ⟹ no retained emails,
// so a disconnected (or stale) state self-cleans — we never keep a mailbox's
// contents once its access is gone.
export async function GET() {
  ensureSeeded();
  if (!emailConfigured()) {
    clearInbox();
    return Response.json({ messages: [], emailConfigured: false });
  }
  return Response.json({ messages: listInbox(), emailConfigured: true });
}

// POST → "Check mail": pull new emails over IMAP (idempotent), return how many arrived
export async function POST() {
  ensureSeeded();
  if (!emailConfigured()) {
    return Response.json(
      { error: "Email isn't connected. Sign in with Google or add IMAP credentials." },
      { status: 400 }
    );
  }
  try {
    const { added } = await checkMail();
    return Response.json({ added, messages: listInbox() });
  } catch (e: any) {
    return Response.json({ error: String(e?.message ?? e) }, { status: 502 });
  }
}
