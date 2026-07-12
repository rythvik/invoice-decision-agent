import { addInboxMessage, knownInboxIds, saveAttachment } from "../db";
import type { IngestionSource } from "../types";
import { GmailApiSource, getGoogleAuth, googleAvailable } from "./google";
import { ImapSource } from "./imap";

// Prefer a connected Gmail (OAuth); else a configured IMAP mailbox.
export function getIngestionSource(): IngestionSource {
  if (getGoogleAuth()) return new GmailApiSource();
  if (ImapSource.isConfigured()) return new ImapSource();
  throw new Error("No mailbox connected. Sign in with Google, or set IMAP credentials.");
}

export function emailConfigured(): boolean {
  return Boolean(getGoogleAuth()) || ImapSource.isConfigured();
}

export function emailStatus(): { configured: boolean; method: "gmail" | "imap" | null; user: string; googleAvailable: boolean } {
  const g = getGoogleAuth();
  if (g) return { configured: true, method: "gmail", user: g.email, googleAvailable: googleAvailable() };
  if (ImapSource.isConfigured()) return { configured: true, method: "imap", user: process.env.IMAP_USER || "", googleAvailable: googleAvailable() };
  return { configured: false, method: null, user: "", googleAvailable: googleAvailable() };
}

/**
 * Pull new emails, persist their attachment bytes to disk, and upsert idempotent
 * inbox rows. Returns how many new emails were added.
 */
export async function checkMail(): Promise<{ added: number }> {
  const source = getIngestionSource();
  const known = knownInboxIds();
  const messages = await source.fetchNew(known);
  let added = 0;
  for (const m of messages) {
    for (const a of m.attachments) saveAttachment(m.id, a.filename, a.bytes);
    addInboxMessage({
      id: m.id,
      from_addr: m.from_addr,
      subject: m.subject,
      received_at: m.received_at,
      attachments: m.attachments.map((a) => a.filename),
      status: "unread",
    });
    added++;
  }
  return { added };
}
