// GeminiProvider — SPEC §7. PDF (base64 inline) → ExtractedInvoice JSON.
// LLM is used ONLY here (stage 3). Everything downstream is deterministic.
//
// Resilience for the free tier (20 req/day/model):
//  - GEMINI_MODEL may be a comma-separated preference list. On a per-day 429
//    we fall through to the next model; on a transient 429 we back off once.
//  - Wrapped by CachingProvider so each unique PDF is extracted at most once.
import { PROMPT, sanitizeExtraction } from "./shared";
import type { ExtractHints, ExtractedInvoice, ExtractionProvider } from "../types";

interface GeminiError extends Error {
  status?: number;
  perDay?: boolean;
  retryMs?: number;
}

export class GeminiProvider implements ExtractionProvider {
  name = "gemini";
  private apiKey: string;
  private models: string[];

  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || "";
    this.models = (process.env.GEMINI_MODEL || "gemini-flash-latest")
      .split(",").map((m) => m.trim()).filter(Boolean);
    if (!this.apiKey || this.apiKey.startsWith("PASTE")) {
      throw new Error("GEMINI_API_KEY is not set. Paste your key into .env.local");
    }
  }

  async extract(bytes: Buffer, hints: ExtractHints): Promise<ExtractedInvoice> {
    let lastErr: unknown = null;
    for (const model of this.models) {
      try {
        return await this.callWithBackoff(model, bytes, hints);
      } catch (e) {
        lastErr = e;
        const ge = e as GeminiError;
        if (ge.perDay) continue; // daily cap on this model → try the next model
        throw e; // other errors are real
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("All Gemini models exhausted");
  }

  private async callWithBackoff(model: string, bytes: Buffer, hints: ExtractHints): Promise<ExtractedInvoice> {
    try {
      return await this.callOnce(model, bytes, hints);
    } catch (e) {
      const ge = e as GeminiError;
      // transient (per-minute) 429 with a short retry hint → wait once and retry
      if (ge.status === 429 && !ge.perDay && ge.retryMs && ge.retryMs <= 30_000) {
        await new Promise((r) => setTimeout(r, ge.retryMs! + 500));
        return await this.callOnce(model, bytes, hints);
      }
      throw e;
    }
  }

  private async callOnce(model: string, bytes: Buffer, hints: ExtractHints): Promise<ExtractedInvoice> {
    const body = {
      contents: [{
        parts: [
          { inline_data: { mime_type: hints.mime, data: bytes.toString("base64") } },
          { text: PROMPT + `\n\nHint: this document appears to be ${hints.kind}.` },
        ],
      }],
      generationConfig: { temperature: 0, response_mime_type: "application/json" },
    };
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err: GeminiError = new Error(`Gemini API ${res.status} (${model}): ${text.slice(0, 200)}`);
      err.status = res.status;
      if (res.status === 429) {
        err.perDay = /PerDay/i.test(text);
        const m = text.match(/retry in ([\d.]+)s|"retryDelay":\s*"(\d+)s"/i);
        if (m) err.retryMs = Math.ceil(parseFloat(m[1] || m[2]) * 1000);
      } else if (res.status === 400 && /no longer available|deprecated|not found/i.test(text)) {
        err.perDay = true; // Model deprecated → try next model
      } else if (res.status === 404 || res.status === 503 || res.status === 504) {
        err.perDay = true; // Server error or not found → try next model
      }
      throw err;
    }

    const json: any = await res.json();
    const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) throw new Error(`Gemini returned no content (${model})`);
    return sanitizeExtraction(JSON.parse(raw));
  }
}
