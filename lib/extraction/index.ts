// Extraction provider selection + automatic fallback chain.
// EXTRACTION_PROVIDER is comma-separated and tried in order, e.g. "ocrspace,ollama,gemini":
// when ocrspace fails it auto-falls through to Ollama (if running), then Gemini.
// The whole chain is wrapped once by the SQLite-backed CachingProvider.
import type { ExtractHints, ExtractedInvoice, ExtractionProvider } from "../types";
import { CachingProvider } from "./cache";
import { GeminiProvider } from "./gemini";
import { OllamaProvider } from "./ollama";
import { OcrSpaceProvider } from "./ocrspace";

function build(name: string): ExtractionProvider {
  switch (name) {
    case "ocrspace": return new OcrSpaceProvider();
    case "gemini": return new GeminiProvider();
    case "ollama": return new OllamaProvider();
    default: throw new Error(`Unknown extraction provider "${name}". Supported: ocrspace, gemini, ollama`);
  }
}

class FallbackChain implements ExtractionProvider {
  name: string;
  constructor(private providers: ExtractionProvider[]) {
    this.name = providers.map((p) => p.name).join(">");
  }
  async extract(bytes: Buffer, hints: ExtractHints): Promise<ExtractedInvoice> {
    let lastErr: unknown = null;
    for (const p of this.providers) {
      try { return await p.extract(bytes, hints); }
      catch (e) {
        console.warn(`[extraction] ${p.name} failed: ${e instanceof Error ? e.message : e}`);
        lastErr = e; // try the next provider (e.g. Gemini capped → Ollama)
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("All extraction providers failed");
  }
}

export function getProvider(): ExtractionProvider {
  const names = (process.env.EXTRACTION_PROVIDER || "ocrspace").split(",").map((s) => s.trim()).filter(Boolean);
  const chain = names.map(build);
  const base = chain.length === 1 ? chain[0] : new FallbackChain(chain);
  return process.env.EXTRACTION_CACHE === "off" ? base : new CachingProvider(base);
}

/** Map a filename/extension to the mime type providers expect. */
export function mimeFor(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "application/pdf";
}
