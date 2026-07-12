// Gmail via OAuth ("Sign in with Google") + the Gmail REST API.
// Uses a Desktop OAuth client (loopback flow): we redirect to http://localhost:3000
// with the auth code, exchange it for a refresh token, and read mail with gmail.readonly.
// No extra dependency — raw fetch to Google's token + Gmail endpoints.
import fs from "fs";
import { deleteSetting, getSetting, setSetting } from "../db";
import type { FetchedMessage, IngestionSource } from "../types";

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const OAUTH_KEY = "email_oauth"; // { email, refresh_token }
const ATTACH_RE = /\.(pdf|png|jpe?g|webp)$/i;

interface OAuthApp { clientId: string; clientSecret: string; redirectUri: string }

export function oauthApp(): OAuthApp | null {
  let clientId = process.env.GOOGLE_CLIENT_ID;
  let clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000";
  if ((!clientId || !clientSecret) && process.env.GOOGLE_CREDENTIALS_PATH) {
    try {
      const raw = JSON.parse(fs.readFileSync(process.env.GOOGLE_CREDENTIALS_PATH, "utf-8"));
      const c = raw.installed || raw.web || {};
      clientId = clientId || c.client_id;
      clientSecret = clientSecret || c.client_secret;
    } catch { /* ignore */ }
  }
  return clientId && clientSecret ? { clientId, clientSecret, redirectUri } : null;
}

export function googleAvailable(): boolean {
  return oauthApp() != null;
}

export function buildAuthUrl(): string {
  const app = oauthApp();
  if (!app) throw new Error("Google OAuth isn't configured (GOOGLE_CREDENTIALS_PATH).");
  const p = new URLSearchParams({
    client_id: app.clientId, redirect_uri: app.redirectUri, response_type: "code",
    scope: SCOPE, access_type: "offline", prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

async function tokenRequest(body: Record<string, string>): Promise<any> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Google token error: ${j.error_description || j.error || res.status}`);
  return j;
}

export async function exchangeCode(code: string): Promise<{ email: string; refresh_token: string }> {
  const app = oauthApp()!;
  const tok = await tokenRequest({
    code, client_id: app.clientId, client_secret: app.clientSecret,
    redirect_uri: app.redirectUri, grant_type: "authorization_code",
  });
  if (!tok.refresh_token) throw new Error("No refresh token — revoke prior access at myaccount.google.com and retry.");
  const email = await profileEmail(tok.access_token);
  return { email, refresh_token: tok.refresh_token };
}

async function accessToken(refresh_token: string): Promise<string> {
  const app = oauthApp()!;
  const tok = await tokenRequest({
    refresh_token, client_id: app.clientId, client_secret: app.clientSecret, grant_type: "refresh_token",
  });
  return tok.access_token;
}

async function profileEmail(access: string): Promise<string> {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${access}` } });
  const j = await res.json();
  return j.emailAddress || "gmail";
}

export function saveGoogleAuth(email: string, refresh_token: string): void {
  setSetting(OAUTH_KEY, JSON.stringify({ email, refresh_token }));
}
export function getGoogleAuth(): { email: string; refresh_token: string } | null {
  const raw = getSetting(OAUTH_KEY);
  if (!raw) return null;
  try { const c = JSON.parse(raw); return c.refresh_token ? c : null; } catch { return null; }
}
export function clearGoogleAuth(): void {
  deleteSetting(OAUTH_KEY);
}

export class GmailApiSource implements IngestionSource {
  name = "gmail";

  async fetchNew(knownIds: Set<string>): Promise<FetchedMessage[]> {
    const auth = getGoogleAuth();
    if (!auth) throw new Error("Gmail is not connected.");
    const access = await accessToken(auth.refresh_token);
    const h = { Authorization: `Bearer ${access}` };

    const listRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&q=" +
        encodeURIComponent("has:attachment newer_than:60d"),
      { headers: h }
    );
    const list = await listRes.json();
    if (!listRes.ok) throw new Error(`Gmail list error: ${list.error?.message || listRes.status}`);

    const out: FetchedMessage[] = [];
    for (const m of list.messages || []) {
      const id = `gmail:${m.id}`;
      if (knownIds.has(id)) continue;
      const msg = await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`, { headers: h })).json();
      const headers: any[] = msg.payload?.headers || [];
      const hv = (n: string) => headers.find((x) => x.name.toLowerCase() === n)?.value || "";

      const atts: { filename: string; bytes: Buffer }[] = [];
      const walk = async (part: any): Promise<void> => {
        if (!part) return;
        if (part.filename && ATTACH_RE.test(part.filename) && part.body?.attachmentId) {
          const a = await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}/attachments/${part.body.attachmentId}`, { headers: h })).json();
          if (a.data) atts.push({ filename: part.filename, bytes: Buffer.from(a.data, "base64url") });
        }
        for (const p of part.parts || []) await walk(p);
      };
      await walk(msg.payload);
      if (!atts.length) continue;

      const from = hv("from");
      out.push({
        id,
        from_addr: from.match(/<(.+?)>/)?.[1] || from || "unknown",
        subject: hv("subject") || "(no subject)",
        received_at: new Date(Number(msg.internalDate || Date.now())).toISOString(),
        attachments: atts,
      });
    }
    return out;
  }
}
