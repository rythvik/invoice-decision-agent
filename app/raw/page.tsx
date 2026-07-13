"use client";
// Unstyled, auto-polling view straight onto the SQLite tables — for demos: put this
// next to the normal Inbox/Dashboard tabs so a viewer can watch the same row land
// here the moment it's processed, proving the UI isn't showing mocked data.
import { useEffect, useState } from "react";

interface RawData {
  invoices: Record<string, unknown>[];
  auditLog: Record<string, unknown>[];
  vendors: Record<string, unknown>[];
  purchaseOrders: Record<string, unknown>[];
}

export default function RawView() {
  const [data, setData] = useState<RawData | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string>("");

  useEffect(() => {
    const load = () =>
      fetch("/api/debug/raw")
        .then((r) => r.json())
        .then((j) => {
          setData(j);
          setUpdatedAt(new Date().toLocaleTimeString());
        });
    load();
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, []);

  if (!data) return <pre style={pre}>loading…</pre>;

  return (
    <div style={{ padding: 16, fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#d4d4d4", background: "#0b0b0b", minHeight: "100vh" }}>
      <div style={{ marginBottom: 12, color: "#888" }}>
        raw sqlite tables · storage/app.db · polling every 2s · last updated {updatedAt}
      </div>

      <Section title={`invoices (${data.invoices.length})`}>
        <Table rows={data.invoices} cols={["id", "filename", "vendor_name", "invoice_number", "matched_po", "total", "outcome", "started_at"]} />
      </Section>

      <Section title={`audit_log — most recent 40 (${data.auditLog.length})`}>
        <Table rows={data.auditLog} cols={["id", "invoice_id", "stage", "name", "status", "summary", "started_at"]} />
      </Section>

      <Section title={`vendors master (${data.vendors.length})`}>
        <Table rows={data.vendors} cols={["external_id", "name", "status", "email"]} />
      </Section>

      <Section title={`purchase_orders master (${data.purchaseOrders.length})`}>
        <Table rows={data.purchaseOrders} cols={["po_number", "vendor_external_id", "status", "total_amount"]} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ color: "#6ee7ff", marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

function Table({ rows, cols }: { rows: Record<string, unknown>[]; cols: string[] }) {
  if (!rows.length) return <div style={{ color: "#555" }}>(empty)</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c} style={th}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c} style={td}>{String(r[c] ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "left", borderBottom: "1px solid #333", padding: "4px 8px", color: "#888", whiteSpace: "nowrap" };
const td: React.CSSProperties = { borderBottom: "1px solid #1a1a1a", padding: "4px 8px", whiteSpace: "nowrap", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" };
const pre: React.CSSProperties = { padding: 16, color: "#888", background: "#0b0b0b", minHeight: "100vh" };
