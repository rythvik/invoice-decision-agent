"use client";
// Replay — the full audit trail of a processed invoice, from persisted stage events.
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageList, type UiDecision, type UiStageEvent } from "@/components/RunView";

export default function InvoiceReplay() {
  const { id } = useParams<{ id: string }>();
  const [events, setEvents] = useState<UiStageEvent[]>([]);
  const [decision, setDecision] = useState<UiDecision | null>(null);
  const [invoice, setInvoice] = useState<any>(null);

  useEffect(() => {
    fetch(`/api/invoices/${id}`)
      .then((r) => r.json())
      .then((j) => {
        setInvoice(j.invoice);
        setEvents(j.events);
        if (j.invoice?.outcome) {
          setDecision({
            outcome: j.invoice.outcome, priority: j.invoice.priority ?? "normal",
            security: Boolean(j.invoice.security), headline: j.invoice.headline ?? "",
            reasons: j.invoice.reasons ?? [],
            checksPassed: j.invoice.checks_passed ?? 0, checksTotal: j.invoice.checks_total ?? 0,
            matchedPo: j.invoice.matched_po,
          });
        }
      });
  }, [id]);

  return (
    <main>
      <h1>Invoice {id}</h1>
      <p className="sub">
        {invoice ? <>Processed <b>{invoice.filename}</b> · {new Date(invoice.started_at).toLocaleString()}{invoice.resolution ? <> · human resolution: <b>{invoice.resolution}</b> (&ldquo;{invoice.resolution_note}&rdquo;)</> : null}</> : "Loading…"}
      </p>
      <StageList events={events} decision={decision} running={false} />
      <a href="/dashboard"><button className="ghost">← back to dashboard</button></a>
    </main>
  );
}
