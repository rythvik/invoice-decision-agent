// POST /api/process — run the pipeline on an inbox message or an uploaded PDF.
// Response: NDJSON stream — {type:"stage", event} per stage, then {type:"result", runId, decision}.
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { ensureSeeded } from "@/lib/bootstrap";
import { addInboxMessage, getInboxMessage, markProcessed } from "@/lib/db";
import { processInvoice } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  ensureSeeded();

  let pdf: Buffer;
  let filename: string;
  let source: string;
  let messageId: string | null = null;

  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await req.json();
    messageId = body.messageId;
    const msg = messageId ? getInboxMessage(messageId) : null;
    if (!msg) return Response.json({ error: "message not found" }, { status: 404 });
    const p = path.join(process.cwd(), "data", "inbox", msg.attachment);
    if (!fs.existsSync(p)) return Response.json({ error: `attachment missing: ${msg.attachment}` }, { status: 404 });
    pdf = fs.readFileSync(p);
    filename = msg.attachment;
    source = "inbox";
  } else {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return Response.json({ error: "no file" }, { status: 400 });
    pdf = Buffer.from(await file.arrayBuffer());
    filename = file.name || "uploaded.pdf";
    source = "upload";
    // register the upload as a received message so it appears in the inbox trail
    const upName = `UP_${Date.now()}_${filename.replace(/[^\w.\-]/g, "_")}`;
    fs.writeFileSync(path.join(process.cwd(), "data", "inbox", upName), pdf);
    messageId = `up_${Date.now()}`;
    addInboxMessage({
      id: messageId, from_addr: "manual upload", subject: filename,
      received_at: new Date().toISOString(), attachment: upName, status: "unread",
    });
    filename = upName;
  }

  // Gentle pacing so each stage is visibly rendered as it "executes" (UI only;
  // the pipeline and golden tests run at full speed). Tune with STAGE_DELAY_MS.
  const stageDelay = Number(process.env.STAGE_DELAY_MS ?? 550);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        const gen = processInvoice(pdf, filename, source);
        let first = true;
        while (true) {
          const { value, done } = await gen.next();
          if (done) {
            if (stageDelay) await sleep(stageDelay);
            if (messageId) markProcessed(messageId, value.runId);
            send({ type: "result", runId: value.runId, decision: value.decision });
            break;
          }
          if (stageDelay && !first) await sleep(stageDelay);
          first = false;
          send({ type: "stage", event: value });
        }
      } catch (e: any) {
        send({ type: "error", message: String(e?.message ?? e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" },
  });
}
