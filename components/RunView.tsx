"use client";
import { useState } from "react";

export interface UiStageEvent {
  runId: string; stage: number; name: string; title: string;
  status: "running" | "done" | "warning" | "hold" | "error";
  summary: string; details: Record<string, unknown>;
  startedAt: string; durationMs: number;
}

export interface UiDecision {
  outcome: "APPROVE" | "REVIEW" | "REJECT" | "HOLD";
  priority: "normal" | "high";
  security: boolean;
  headline: string;
  reasons: { code: string; category: string; severity: string; message: string; evidence?: Record<string, unknown> }[];
  checks: { code: string; label: string; passed: boolean }[];
  checksPassed: number; checksTotal: number;
  matchedPo: string | null;
}

/** The compact, glanceable subset of checks shown on every decision card. */
const CHECKLIST_SPEC: { codes: string[]; label: string }[] = [
  { codes: ["UNKNOWN_VENDOR"], label: "Vendor" },
  { codes: ["PO_NOT_FOUND"], label: "PO" },
  { codes: ["MISSING_CRITICAL_FIELD"], label: "Invoice #" },
  { codes: ["BANK_ACCOUNT_CHANGED"], label: "Bank" },
  { codes: ["DUPLICATE"], label: "Duplicate" },
  { codes: ["AMOUNT_SIGNIFICANTLY_OVER", "AMOUNT_OVER_TOLERANCE", "AMOUNT_BANDS"], label: "Amount" },
];

function buildChecklist(d: UiDecision): { label: string; passed: boolean; detail: string | null }[] {
  const byCode = new Map(d.checks.map((c) => [c.code, c]));
  const reasonByCode = new Map(d.reasons.map((r) => [r.code, r]));
  const items: { label: string; passed: boolean; detail: string | null }[] = [];
  for (const { codes, label } of CHECKLIST_SPEC) {
    const code = codes.find((c) => byCode.has(c));
    if (!code) continue;
    const check = byCode.get(code)!;
    const pct = reasonByCode.get(code)?.evidence?.pct_over;
    items.push({ label, passed: check.passed, detail: !check.passed && typeof pct === "number" ? `${pct}%` : null });
  }
  return items;
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

const OUTCOME_LABEL: Record<UiDecision["outcome"], string> = {
  APPROVE: "APPROVED", REVIEW: "NEEDS REVIEW", REJECT: "REJECTED", HOLD: "ON HOLD",
};

export function DecisionCard({ d }: { d: UiDecision }) {
  const cls = `decision ${d.outcome}${d.security ? " security" : ""}`;
  const checklist = buildChecklist(d);
  return (
    <div className={cls}>
      <div>
        <span className={`badge ${d.outcome}`}>{OUTCOME_LABEL[d.outcome]}</span>
        {d.security && <span className="badge security">🛡 SECURITY — DO NOT PAY UNTIL VERIFIED</span>}
        {d.priority === "high" && !d.security && <span className="badge high">HIGH PRIORITY</span>}
      </div>
      <div className="headline">{d.headline}</div>
      {checklist.length > 0 && (
        <div className="checklist">
          {checklist.map((c) => (
            <span key={c.label} className={`checklist-item ${c.passed ? "pass" : "fail"}`}>
              {c.label} {c.passed ? "✓" : "✗"}{c.detail ? ` ${c.detail}` : ""}
            </span>
          ))}
        </div>
      )}
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
