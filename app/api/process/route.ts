// POST /api/process — run the pipeline on an inbox email (one or more attachments)
// or a manually uploaded file. Streams NDJSON:
//   {type:"invoice_start", index, filename}
//   {type:"stage", event}            (repeated)
//   {type:"result", index, filename, runId, decision}
//   {type:"done"}   |   {type:"error", message}
import { NextRequest } from "next/server";
import { ensureSeeded } from "@/lib/bootstrap";
import { clearMail, getInboxMessage, markInboxProcessed, readAttachment } from "@/lib/db";
import { processInvoice } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Job { filename: string; bytes: Buffer; inboxId: string | null; source: string }

export async function POST(req: NextRequest) {
  ensureSeeded();

  const jobs: Job[] = [];
  let inboxId: string | null = null;
  const contentType = req.headers.get("content-type") || "";

  try {
    if (contentType.includes("application/json")) {
      const { messageId } = await req.json();
      const msg = messageId ? getInboxMessage(messageId) : null;
      if (!msg) return Response.json({ error: "email not found" }, { status: 404 });
      inboxId = msg.id;
      for (const filename of msg.attachments) {
        jobs.push({ filename, bytes: readAttachment(msg.id, filename), inboxId: msg.id, source: "email" });
      }
    } else {
      const form = await req.formData();
      const file = form.get("file") as File | null;
      if (!file) return Response.json({ error: "no file" }, { status: 400 });
      jobs.push({ filename: file.name || "upload.pdf", bytes: Buffer.from(await file.arrayBuffer()), inboxId: null, source: "upload" });
    }
  } catch (e: any) {
    return Response.json({ error: String(e?.message ?? e) }, { status: 400 });
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
        if (inboxId) {
          markInboxProcessed(inboxId);
          // the mail is the archive — drop the local bytes once decided (keep them only if a
          // transient read failure means the user may want to retry)
          if (!anyUnreadable) clearMail(inboxId);
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
