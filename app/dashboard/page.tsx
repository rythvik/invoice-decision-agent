"use client";
// Dashboard — history, status and outputs across runs; the human review queue.
import { useEffect, useState } from "react";

interface Run {
  id: string; filename: string; started_at: string; outcome: string | null;
  priority: string | null; security: number; headline: string | null;
  matched_po: string | null; vendor_name: string | null; invoice_number: string | null;
  currency: string | null; total: number | null;
  resolution: string | null; resolution_note: string | null;
  reasons: { code: string; message: string }[];
}

export default function Dashboard() {
  const [runs, setRuns] = useState<Run[]>([]);
  const refresh = () => fetch("/api/invoices").then((r) => r.json()).then((j) => setRuns(j.invoices));
  useEffect(() => { refresh(); }, []);

  async function resolve(run: Run, resolution: "approved" | "rejected") {
    const note = window.prompt(
      `${resolution === "approved" ? "Approve" : "Reject"} ${run.invoice_number ?? run.filename}?\n\nA note is required (it goes on the audit trail):`
    );
    if (!note) return;
    await fetch(`/api/invoices/${run.id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolution, note }),
    });
    refresh();
  }

  const counts = {
    total: runs.length,
    approved: runs.filter((r) => r.outcome === "APPROVE").length,
    review: runs.filter((r) => r.outcome === "REVIEW" && !r.resolution).length,
    rejected: runs.filter((r) => r.outcome === "REJECT" && !r.resolution).length,
    hold: runs.filter((r) => r.outcome === "HOLD" && !r.resolution).length,
    security: runs.filter((r) => r.security && !r.resolution).length,
  };
  const queue = runs.filter((r) => (r.outcome === "REVIEW" || r.outcome === "HOLD") && !r.resolution);
  const rejectedQueue = runs.filter((r) => r.outcome === "REJECT" && !r.resolution);

  const money = (r: Run) =>
    r.total != null
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: r.currency || "USD" }).format(r.total)
      : "—";

  return (
    <main>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h1>Dashboard</h1>
          <p className="sub">Every run, its decision, and the queue waiting on a human.</p>
        </div>
        <a href="/api/invoices/export"><button className="ghost">Export CSV</button></a>
      </div>

      <div className="card">
        <span className="stat"><div className="n">{counts.total}</div><div className="l">processed</div></span>
        <span className="stat"><div className="n" style={{ color: "var(--green)" }}>{counts.approved}</div><div className="l">auto-approved</div></span>
        <span className="stat"><div className="n" style={{ color: "var(--amber)" }}>{counts.review}</div><div className="l">need review</div></span>
        <span className="stat"><div className="n" style={{ color: "var(--red)" }}>{counts.rejected}</div><div className="l">auto-rejected</div></span>
        <span className="stat"><div className="n" style={{ color: "var(--text-3)" }}>{counts.hold}</div><div className="l">on hold</div></span>
        <span className="stat"><div className="n" style={{ color: "var(--red)" }}>{counts.security}</div><div className="l">security 🛡</div></span>
      </div>

      {queue.length > 0 && (
        <div className="card">
          <h2>Review queue — needs a human</h2>
          {queue.map((r) => (
            <div key={r.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
              <span className={`chip ${r.outcome} ${r.security ? "sec" : ""}`}>
                {r.security ? "🛡 " : ""}{r.outcome}{r.priority === "high" ? " · HIGH" : ""}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {r.vendor_name ?? "Unknown vendor"} · {r.invoice_number ?? r.filename} · {money(r)}
                </div>
                <div style={{ fontSize: 13, color: "var(--text-2)" }}>{r.headline}</div>
              </div>
              <a href={`/invoices/${r.id}`}><button className="ghost">replay</button></a>
              <button onClick={() => resolve(r, "approved")}>Approve</button>
              <button onClick={() => resolve(r, "rejected")}>Reject</button>
            </div>
          ))}
        </div>
      )}

      {rejectedQueue.length > 0 && (
        <div className="card" style={{ borderColor: "var(--red-line)" }}>
          <h2>Auto-rejected</h2>
          <p style={{ fontSize: 13, color: "var(--text-2)", marginTop: -6, marginBottom: 10 }}>
            The process rejected these on its own — no human action needed. Override below if one looks wrong.
          </p>
          {rejectedQueue.map((r) => (
            <div key={r.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
              <span className="chip REJECT">✕ REJECTED{r.priority === "high" ? " · HIGH" : ""}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {r.vendor_name ?? "Unknown vendor"} · {r.invoice_number ?? r.filename} · {money(r)}
                </div>
                <div style={{ fontSize: 13, color: "var(--text-2)" }}>{r.headline}</div>
              </div>
              <a href={`/invoices/${r.id}`}><button className="ghost">replay</button></a>
              <button onClick={() => resolve(r, "approved")}>Approve</button>
              <button onClick={() => resolve(r, "rejected")}>Confirm reject</button>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>All runs</h2>
        {runs.length === 0 ? (
          <div className="empty">Nothing processed yet — go to the Inbox and run an invoice.</div>
        ) : (
          <table>
            <thead>
              <tr><th>When</th><th>Invoice</th><th>Vendor</th><th>Amount</th><th>PO</th><th>Decision</th><th></th></tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap", color: "var(--text-3)" }}>
                    {new Date(r.started_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  </td>
                  <td>{r.invoice_number ?? r.filename}</td>
                  <td>{r.vendor_name ?? "—"}</td>
                  <td>{money(r)}</td>
                  <td>{r.matched_po ?? "—"}</td>
                  <td>
                    <span className={`chip ${r.outcome ?? "HOLD"} ${r.security ? "sec" : ""}`}>
                      {r.security ? "🛡 " : ""}{r.outcome}
                    </span>
                    {r.resolution && (
                      <span className="chip resolved" style={{ marginLeft: 6 }}>human: {r.resolution}</span>
                    )}
                  </td>
                  <td><a href={`/invoices/${r.id}`}><button className="ghost">replay →</button></a></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
