// CachingProvider — content-addressed extraction cache.
// Extraction is the only paid/limited call and is effectively deterministic
// (temperature 0), so we cache by PDF hash. Each unique invoice is extracted
// once, ever; rule-tuning and golden re-runs then cost zero API calls.
//
// Fresh uploads (new content) always miss the cache → a genuine live call.
// Disable with EXTRACTION_CACHE=off.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { ExtractedInvoice, ExtractionProvider } from "../types";

const CACHE_DIR = path.join(process.cwd(), "data", ".extraction_cache");

export class CachingProvider implements ExtractionProvider {
  name: string;
  constructor(private inner: ExtractionProvider) {
    this.name = `cached:${inner.name}`;
  }

  async extract(pdf: Buffer, hints: { kind: "digital" | "scanned" }): Promise<ExtractedInvoice> {
    const hash = crypto.createHash("sha256").update(pdf).digest("hex").slice(0, 16);
    const file = path.join(CACHE_DIR, `${hash}.json`);
    if (fs.existsSync(file)) {
      try { return JSON.parse(fs.readFileSync(file, "utf-8")) as ExtractedInvoice; } catch { /* fall through */ }
    }
    const result = await this.inner.extract(pdf, hints);
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(result, null, 2));
    return result;
  }
}
