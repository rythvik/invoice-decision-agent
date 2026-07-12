// Email connection config — saved in the app (via the on-screen Connect form) with a
// fallback to environment variables. The app-password is stored locally in app.db
// (gitignored) — same trust model as .env.local, never committed.
import { deleteSetting, getSetting, setSetting } from "../db";

export interface EmailConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  mailbox: string;
}

const KEY = "email_imap";

export function getEmailConfig(): EmailConfig | null {
  const raw = getSetting(KEY);
  if (raw) {
    try {
      const c = JSON.parse(raw);
      if (c.host && c.user && c.password) return { port: 993, mailbox: "INBOX", ...c };
    } catch { /* fall through to env */ }
  }
  if (process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASSWORD) {
    return {
      host: process.env.IMAP_HOST,
      port: Number(process.env.IMAP_PORT || 993),
      user: process.env.IMAP_USER,
      password: process.env.IMAP_PASSWORD,
      mailbox: process.env.IMAP_MAILBOX || "INBOX",
    };
  }
  return null;
}

export function saveEmailConfig(c: EmailConfig): void {
  setSetting(KEY, JSON.stringify(c));
}

export function clearEmailConfig(): void {
  deleteSetting(KEY);
}
