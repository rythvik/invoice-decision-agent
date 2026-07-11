"use client";
// Replay — the full audit trail of a past run, rendered from persisted StageEvents.
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageList, type UiDecision, type UiStageEvent } from "@/components/RunView";

export default function RunReplay() {
  const { id } = useParams<{ id: string }>();
  const [events, setEvents] = useState<UiStageEvent[]>([]);
  const [decision, setDecision] = useState<UiDecision | null>(null);
  const [run, setRun] = useState<any>(null);

  useEffect(() => {
    fetch(`/api/runs/${id}`)
      .then((r) => r.json())
      .then((j) => {
        setRun(j.run);
        setEvents(j.events);
        if (j.run?.outcome) {
          setDecision({
            outcome: j.run.outcome, priority: j.run.priority ?? "normal",
            security: Boolean(j.run.security), headline: j.run.headline ?? "",
            reasons: j.run.reasons ?? [],
            checksPassed: j.run.checks_passed ?? 0, checksTotal: j.run.checks_total ?? 0,
            matchedPo: j.run.matched_po,
          });
        }
      });
  }, [id]);

  return (
    <main>
      <h1>Run {id}</h1>
      <p className="sub">
        {run ? <>Processed <b>{run.filename}</b> · {new Date(run.started_at).toLocaleString()} {run.resolution ? <> · human resolution: <b>{run.resolution}</b> (&ldquo;{run.resolution_note}&rdquo;)</> : null}</> : "Loading…"}
      </p>
      <StageList events={events} decision={decision} running={false} />
      <a href="/dashboard"><button className="ghost">← back to dashboard</button></a>
    </main>
  );
}
