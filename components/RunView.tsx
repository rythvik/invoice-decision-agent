"use client";
import { useState } from "react";

export interface UiStageEvent {
  runId: string; stage: number; name: string; title: string;
  status: "running" | "done" | "warning" | "hold" | "error";
  summary: string; details: Record<string, unknown>;
  startedAt: string; durationMs: number;
}

export interface UiDecision {
  outcome: "APPROVE" | "REVIEW" | "HOLD";
  priority: "normal" | "high";
  security: boolean;
  headline: string;
  reasons: { code: string; category: string; severity: string; message: string }[];
  checksPassed: number; checksTotal: number;
  matchedPo: string | null;
}

function Icon({ status }: { status: UiStageEvent["status"] }) {
  if (status === "running") return <div className="spinner" aria-label="running" />;
  const ch = { done: "✓", warning: "!", hold: "⏸", error: "✕" }[status];
  return (
    <div className={`icon ${status}`} aria-label={status}>
      <svg width="22" height="22" viewBox="0 0 22 22">
        <circle cx="11" cy="11" r="10" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <text x="11" y="15.5" textAnchor="middle" fontSize="12" fontWeight="700" fill="currentColor">{ch}</text>
      </svg>
    </div>
  );
}

export function StageRow({ ev }: { ev: UiStageEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="stage">
      <Icon status={ev.status} />
      <div className="body">
        <div className="title">{ev.title}</div>
        <div className="summary">{ev.summary}</div>
        {ev.status !== "running" && Object.keys(ev.details || {}).length > 0 && (
          <>
            <span className="toggle" onClick={() => setOpen(!open)}>
              {open ? "▾ hide details" : "▸ view details"}
            </span>
            {open && <pre>{JSON.stringify(ev.details, null, 2)}</pre>}
          </>
        )}
      </div>
    </div>
  );
}

export function DecisionCard({ d }: { d: UiDecision }) {
  const cls = `decision ${d.outcome}${d.security ? " security" : ""}`;
  return (
    <div className={cls}>
      <div>
        <span className={`badge ${d.outcome}`}>
          {d.outcome === "APPROVE" ? "APPROVED" : d.outcome === "REVIEW" ? "NEEDS REVIEW" : "ON HOLD"}
        </span>
        {d.security && <span className="badge security">🛡 SECURITY — DO NOT PAY UNTIL VERIFIED</span>}
        {d.priority === "high" && !d.security && <span className="badge high">HIGH PRIORITY</span>}
      </div>
      <div className="headline">{d.headline}</div>
      {d.reasons.length > 0 && (
        <ul>
          {d.reasons.map((r) => (
            <li key={r.code}>
              <strong>{r.code.replaceAll("_", " ").toLowerCase()}</strong> — {r.message}
            </li>
          ))}
        </ul>
      )}
      <div className="checks">
        {d.checksPassed} of {d.checksTotal} checks passed
        {d.matchedPo ? ` · matched ${d.matchedPo}` : ""}
      </div>
    </div>
  );
}

export function StageList({ events, decision, running, title }: { events: UiStageEvent[]; decision: UiDecision | null; running: boolean; title?: string }) {
  return (
    <div className="card">
      {title && (
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
          <i>📄</i> <code style={{ fontSize: 13 }}>{title}</code>
        </div>
      )}
      {events.map((ev, i) => (
        <StageRow key={`${ev.stage}-${i}`} ev={ev} />
      ))}
      {running && (
        <div className="stage">
          <div className="spinner" />
          <div className="body"><div className="summary">working…</div></div>
        </div>
      )}
      {decision && <DecisionCard d={decision} />}
    </div>
  );
}
