// POST /api/invoices/{id}/rerun — reprocess an invoice (email-sourced only).
// Reads stored attachment bytes and runs through the full pipeline, replacing the decision.
import { clearMail, getInboxMessage, readAttachment, getInvoice, markInboxProcessed } from "@/lib/db";
import { processInvoice } from "@/lib/pipeline";
import { ensureSeeded } from "@/lib/bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Job { filename: string; bytes: Buffer; inboxId: string | null; source: string }

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  ensureSeeded();
  const { id: invoiceId } = await params;

  const invoice = getInvoice(invoiceId);
  if (!invoice) return Response.json({ error: "invoice not found" }, { status: 404 });

  if (!invoice.inbox_id) {
    return Response.json({ error: "re-run only available for email-sourced invoices" }, { status: 400 });
  }

  const msg = getInboxMessage(invoice.inbox_id);
  if (!msg) return Response.json({ error: "email not found" }, { status: 404 });

  const jobs: Job[] = [];
  for (const filename of msg.attachments) {
    jobs.push({ filename, bytes: readAttachment(msg.id, filename), inboxId: msg.id, source: "email" });
  }

  const stageDelay = Number(process.env.STAGE_DELAY_MS ?? 550);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        let anyUnreadable = false;
        for (let index = 0; index < jobs.length; index++) {
          const job = jobs[index];
          send({ type: "invoice_start", index, filename: job.filename, count: jobs.length });
          const gen = processInvoice(job.bytes, job.filename, job.source, job.inboxId);
          let first = true;
          while (true) {
            const { value, done } = await gen.next();
            if (done) {
              if (stageDelay) await sleep(stageDelay);
              if (value.decision?.reasons?.some((r) => r.code === "UNREADABLE_DOCUMENT")) anyUnreadable = true;
              send({ type: "result", index, filename: job.filename, runId: value.runId, decision: value.decision });
              break;
            }
            if (stageDelay && !first) await sleep(stageDelay);
            first = false;
            send({ type: "stage", index, event: value });
          }
        }
        if (invoice.inbox_id) {
          markInboxProcessed(invoice.inbox_id);
          if (!anyUnreadable) clearMail(invoice.inbox_id);
        }
        send({ type: "done" });
      } catch (e: any) {
        send({ type: "error", message: String(e?.message ?? e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" } });
}
