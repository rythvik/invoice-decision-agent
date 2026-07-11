"use client";
// Inbox — the simulated vendor mailbox + live-run view.
// Click "Process" → the pipeline streams stage-by-stage below, ending in a decision.
import { useEffect, useRef, useState } from "react";
import { StageList, type UiDecision, type UiStageEvent } from "@/components/RunView";

interface Msg {
  id: string; from_addr: string; subject: string;
  received_at: string; attachment: string; status: string; run_id?: string | null;
}

export default function InboxPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [events, setEvents] = useState<UiStageEvent[]>([]);
  const [decision, setDecision] = useState<UiDecision | null>(null);
  const [running, setRunning] = useState(false);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const runPanel = useRef<HTMLDivElement>(null);

  const refresh = () => fetch("/api/inbox").then((r) => r.json()).then((j) => setMessages(j.messages));
  useEffect(() => { refresh(); }, []);

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
        if (obj.type === "stage") setEvents((prev) => [...prev, obj.event]);
        else if (obj.type === "result") setDecision({ ...obj.decision });
        else if (obj.type === "error") setDecision({ outcome: "HOLD", priority: "normal", security: false, headline: `Something went wrong: ${obj.message}`, reasons: [], checksPassed: 0, checksTotal: 0, matchedPo: null });
      }
    }
  }

  async function processMessage(m: Msg) {
    setEvents([]); setDecision(null); setRunning(true); setCurrentFile(m.attachment);
    runPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      const res = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: m.id }),
      });
      await consumeStream(res);
    } finally {
      setRunning(false);
      refresh();
    }
  }

  async function processUpload(file: File) {
    setEvents([]); setDecision(null); setRunning(true); setCurrentFile(file.name);
    runPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/process", { method: "POST", body: fd });
      await consumeStream(res);
    } finally {
      setRunning(false);
      refresh();
    }
  }

  const unread = messages.filter((m) => m.status === "unread");

  return (
    <main>
      <h1>Inbox</h1>
      <p className="sub">
        Invoices received from vendors ({unread.length} awaiting processing). Click <b>Process</b> to
        run one through the decision pipeline — or drop in a fresh PDF.
      </p>

      <div
        className="uploadbox"
        onClick={() => fileInput.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) processUpload(f); }}
      >
        📄 Receive a new invoice — click to choose a PDF or drag it here
        <input ref={fileInput} type="file" accept="application/pdf" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) processUpload(f); e.currentTarget.value = ""; }} />
      </div>

      <div ref={runPanel}>
        {(events.length > 0 || running) && (
          <>
            <h2 style={{ marginBottom: 8 }}>
              {running ? "Processing" : "Processed"}: <code style={{ fontSize: 13 }}>{currentFile}</code>
            </h2>
            <StageList events={events} decision={decision} running={running && !decision} />
          </>
        )}
      </div>

      {messages.map((m) => (
        <div key={m.id} className={`mailrow ${m.status === "processed" ? "processed" : ""}`}>
          <div className="from">{m.from_addr}</div>
          <div className="subj"><span className="clip">📎</span>{m.subject}</div>
          <div className="date">{new Date(m.received_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
          {m.status === "processed" ? (
            <a href={`/runs/${m.run_id}`}><button className="ghost">view run →</button></a>
          ) : (
            <button className="primary" disabled={running} onClick={() => processMessage(m)}>Process</button>
          )}
        </div>
      ))}
      {messages.length === 0 && <div className="empty">Inbox is empty.</div>}
    </main>
  );
}
