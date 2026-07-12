// ImapSource — pull real invoice emails from any mailbox over IMAP.
// Connect with host + email + app password (env only; the user creates the app
// password and stores it in .env.local — never committed). Only PDF/image
// attachments are kept. Idempotency (skipping already-seen emails) is handled by
// the caller via knownIds, so we never re-scrape the same email.
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { getEmailConfig, type EmailConfig } from "./config";
import type { FetchedMessage, IngestionSource } from "../types";

const ATTACH_RE = /\.(pdf|png|jpe?g|webp)$/i;

/** Open + login, returning the connected client. Throws a helpful error on failure. */
export async function connectImap(cfg: EmailConfig): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: cfg.host, port: cfg.port, secure: true,
    auth: { user: cfg.user, pass: cfg.password }, logger: false,
  });
  try {
    await client.connect();
  } catch (e: any) {
    const detail = e?.responseText || e?.message || String(e);
    if (e?.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials|LOGIN|BAD|Application-specific/i.test(detail)) {
      throw new Error(
        "Login rejected. For Gmail: turn on 2-Step Verification, create an APP PASSWORD (Account → Security → App passwords) and use that — not your normal password — and make sure IMAP is enabled (Gmail Settings → Forwarding and POP/IMAP)."
      );
    }
    throw new Error(detail);
  }
  return client;
}

export class ImapSource implements IngestionSource {
  name = "imap";

  static isConfigured(): boolean {
    return getEmailConfig() != null;
  }

  async fetchNew(knownIds: Set<string>): Promise<FetchedMessage[]> {
    const cfg = getEmailConfig();
    if (!cfg) throw new Error("Email is not connected. Use the Connect form or set IMAP_* in .env.local");
    const client = new ImapFlow({
      host: cfg.host, port: cfg.port, secure: true,
      auth: { user: cfg.user, pass: cfg.password }, logger: false,
    });

    const out: FetchedMessage[] = [];
    await client.connect();
    try {
      const lock = await client.getMailboxLock(cfg.mailbox);
      try {
        // scan the most recent messages; the caller filters out ids we've already stored
        const total = (client.mailbox as any)?.exists ?? 0;
        if (!total) return out;
        const from = Math.max(1, total - 50);
        for await (const msg of client.fetch(`${from}:*`, { uid: true, source: true, envelope: true })) {
          const id = String(msg.envelope?.messageId || `uid-${msg.uid}`);
          if (knownIds.has(id)) continue;
          const parsed = await simpleParser(msg.source as Buffer);
          const attachments = (parsed.attachments || [])
            .filter((a) => a.filename && ATTACH_RE.test(a.filename))
            .map((a) => ({ filename: a.filename!, bytes: a.content as Buffer }));
          if (!attachments.length) continue; // not an invoice email
          out.push({
            id,
            from_addr: parsed.from?.value?.[0]?.address || parsed.from?.text || "unknown",
            subject: parsed.subject || "(no subject)",
            received_at: (parsed.date || new Date()).toISOString(),
            attachments,
          });
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => {});
    }
    return out;
  }
}
