"use client";
// Inbox — real vendor email (via IMAP, connected on-screen) + manual upload.
// Processing streams stage-by-stage; one email can carry several invoices, each
// rendered as its own live block ending in a decision.
import { useEffect, useRef, useState } from "react";
import { StageList, type UiDecision, type UiStageEvent } from "@/components/RunView";

interface Msg { id: string; from_addr: string; subject: string; received_at: string; attachments: string[]; status: string }
interface InvoiceRun { index: number; filename: string; events: UiStageEvent[]; decision: UiDecision | null }
interface EmailStatus { configured: boolean; method: "gmail" | "imap" | null; user: string; googleAvailable: boolean; host: string; port: number; mailbox: string }

export default function InboxPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [email, setEmail] = useState<EmailStatus | null>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [form, setForm] = useState({ host: "imap.gmail.com", port: 993, user: "", password: "", mailbox: "INBOX" });
  const [connecting, setConnecting] = useState(false);
  const [connectMsg, setConnectMsg] = useState<string | null>(null);

  const [runs, setRuns] = useState<InvoiceRun[]>([]);
  const [running, setRunning] = useState(false);
  const [heading, setHeading] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const runPanel = useRef<HTMLDivElement>(null);

  const refreshInbox = () => fetch("/api/inbox").then((r) => r.json()).then((j) => setMessages(j.messages));
  const refreshEmail = () =>
    fetch("/api/settings/email").then((r) => r.json()).then((j) => {
      setEmail(j);
      setForm((f) => ({ ...f, host: j.host, port: j.port, user: j.user || f.user, mailbox: j.mailbox }));
    });
  useEffect(() => {
    refreshInbox(); refreshEmail();
    // complete the Google loopback flow if we came back with ?code=
    const code = new URLSearchParams(window.location.search).get("code");
    if (code) {
      setNote("Finishing Google sign-in…");
      fetch("/api/auth/gmail/exchange", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) })
        .then((r) => r.json())
        .then((j) => {
          window.history.replaceState({}, "", "/");
          if (j.ok) { setNote(`Connected as ${j.email}`); refreshEmail(); checkMail(); }
          else setNote(j.error || "Google sign-in failed");
        });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function connect() {
    setConnecting(true); setConnectMsg(null);
    const res = await fetch("/api/settings/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const j = await res.json();
    setConnecting(false);
    if (!res.ok) { setConnectMsg(j.error); return; }
    setConnectMsg(null); setShowConnect(false); setForm((f) => ({ ...f, password: "" }));
    await refreshEmail();
    checkMail();
  }
  async function disconnect() {
    if (!confirm("Disconnect this mailbox? A CSV of its processed invoices downloads automatically first. This then removes the fetched emails and the decisions made from them — invoices you uploaded directly are kept.")) return;
    // safety-net: download a CSV of exactly what's about to be wiped, before wiping it
    const a = document.createElement("a");
    a.href = "/api/invoices/export?inboxOnly=1";
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
    await fetch("/api/settings/email", { method: "DELETE" });
    setRuns([]);
    refreshEmail(); refreshInbox();
    setNote("Disconnected — a CSV of the removed invoices was downloaded.");
  }

  async function consumeStream(res: Response) {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop()!;
      for (const line of lines) {
        if (!line.trim()) continue;
        const obj = JSON.parse(line);
        if (obj.type === "invoice_start") setRuns((p) => [...p, { index: obj.index, filename: obj.filename, events: [], decision: null }]);
        else if (obj.type === "stage") setRuns((p) => p.map((r) => (r.index === obj.index ? { ...r, events: [...r.events, obj.event] } : r)));
        else if (obj.type === "result") setRuns((p) => p.map((r) => (r.index === obj.index ? { ...r, decision: obj.decision } : r)));
        else if (obj.type === "error") setNote(`Something went wrong: ${obj.message}`);
      }
    }
  }

  async function run(fn: () => Promise<Response>, label: string) {
    setRuns([]); setNote(null); setRunning(true); setHeading(label);
    runPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    try { await consumeStream(await fn()); } finally { setRunning(false); refreshInbox(); }
  }

  const processEmail = (m: Msg) =>
    run(() => fetch("/api/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId: m.id }) }),
        `${m.subject} · ${m.attachments.length} invoice${m.attachments.length > 1 ? "s" : ""}`);

  const processUpload = (file: File) => {
    const fd = new FormData(); fd.append("file", file);
    return run(() => fetch("/api/process", { method: "POST", body: fd }), file.name);
  };

  async function checkMail() {
    setNote("Checking mail…");
    const res = await fetch("/api/inbox", { method: "POST" });
    const j = await res.json();
    if (!res.ok) { setNote(j.error); return; }
    setNote(j.added ? `${j.added} new invoice email${j.added > 1 ? "s" : ""} fetched.` : "No new invoice emails.");
    refreshInbox();
  }

  return (
    <main>
      <h1>Inbox</h1>
      <p className="sub">
        Invoices arrive by email. Connect your mailbox and click <b>Check mail</b> to pull them in —
        or drop a PDF/image below to process one directly.
      </p>

      <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        {email?.configured ? (
          <>
            <button className="primary" onClick={checkMail} disabled={running}>Check mail</button>
            <span style={{ fontSize: 13, color: "var(--text-2)" }}>📬 {email.user}{email.method === "gmail" ? " (Gmail)" : ""}</span>
            <button className="ghost" onClick={disconnect} disabled={running}>Disconnect</button>
          </>
        ) : (
          <>
            {email?.googleAvailable && (
              <button className="primary" onClick={() => { window.location.href = "/api/auth/gmail/start"; }} disabled={running}>
                Sign in with Google
              </button>
            )}
            <button onClick={() => setShowConnect((s) => !s)} disabled={running}>Connect a mailbox (IMAP)</button>
          </>
        )}
        <button onClick={() => fileInput.current?.click()} disabled={running}>Upload a PDF / image</button>
        <input ref={fileInput} type="file" accept="application/pdf,image/*" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) processUpload(f); e.currentTarget.value = ""; }} />
        {note && <span style={{ fontSize: 13, color: "var(--text-2)" }}>{note}</span>}
      </div>

      {showConnect && !email?.configured && (
        <div className="card" style={{ maxWidth: 480 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Connect your mailbox</div>
          <p style={{ fontSize: 13, color: "var(--text-2)", marginTop: 0 }}>
            Use an <b>app password</b> (not your login password). Gmail: Account → Security → App passwords.
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            <input placeholder="IMAP host" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
            <input placeholder="Email address" value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} />
            <input placeholder="App password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <div style={{ display: "flex", gap: 8 }}>
              <button className="primary" onClick={connect} disabled={connecting}>{connecting ? "Connecting…" : "Connect"}</button>
              <button className="ghost" onClick={() => setShowConnect(false)} disabled={connecting}>Cancel</button>
            </div>
            {connectMsg && <div style={{ fontSize: 13, color: "#c0392b" }}>{connectMsg}</div>}
          </div>
        </div>
      )}

      <div ref={runPanel}>
        {(runs.length > 0 || running) && (
          <>
            <h2 style={{ marginBottom: 8 }}>{running ? "Processing" : "Processed"}: {heading}</h2>
            {runs.map((r) => (
              <StageList key={r.index} title={r.filename} events={r.events} decision={r.decision} running={running && !r.decision} />
            ))}
          </>
        )}
      </div>

      {messages.map((m) => (
        <div key={m.id} className={`mailrow ${m.status === "processed" ? "processed" : ""}`}>
          <div className="from">{m.from_addr}</div>
          <div className="subj">
            <span className="clip">📎</span>{m.subject}
            {m.attachments.length > 1 && <span style={{ color: "var(--text-3)" }}> · {m.attachments.length} attachments</span>}
          </div>
          <div className="date">{new Date(m.received_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
          {m.status === "processed" ? (
            <a href="/dashboard" style={{ fontSize: 13, color: "var(--text-2)", whiteSpace: "nowrap" }}>✓ processed</a>
          ) : (
            <button className="primary" disabled={running} onClick={() => processEmail(m)}>Process</button>
          )}
        </div>
      ))}
      {messages.length === 0 && (
        <div className="empty">
          {email?.configured
            ? <>No invoice emails yet — click <b>Check mail</b>, or upload one.</>
            : <>Connect your mailbox to pull invoices from email, or <b>Upload</b> one directly.</>}
        </div>
      )}
    </main>
  );
}
