// CachingProvider — content-addressed extraction cache, stored in SQLite
// (extraction_cache table) so every unique document is read at most once and the
// cache is browsable alongside the rest of the data. Fresh files (new bytes) miss
// the cache → a genuine live call. Disable with EXTRACTION_CACHE=off.
import crypto from "crypto";
import { getCached, putCached } from "../db";
import type { ExtractHints, ExtractedInvoice, ExtractionProvider } from "../types";

export class CachingProvider implements ExtractionProvider {
  name: string;
  constructor(private inner: ExtractionProvider) {
    this.name = `cached:${inner.name}`;
  }

  async extract(bytes: Buffer, hints: ExtractHints): Promise<ExtractedInvoice> {
    const hash = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const hit = getCached(hash);
    if (hit) return hit;
    const result = await this.inner.extract(bytes, hints);
    putCached(hash, hints.mime, result);
    return result;
  }
}
