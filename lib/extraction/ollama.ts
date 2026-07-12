// OllamaProvider — fully-local vision extraction (no key, no cap, offline).
// Runs a local vision model (default qwen2.5vl) via the Ollama REST API.
// PDFs are converted to page images first (Ollama vision takes images, not PDFs).
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { PROMPT, sanitizeExtraction } from "./shared";
import type { ExtractHints, ExtractedInvoice, ExtractionProvider } from "../types";

export class OllamaProvider implements ExtractionProvider {
  name = "ollama";
  private host: string;
  private model: string;

  constructor() {
    this.host = process.env.OLLAMA_HOST || "http://localhost:11434";
    this.model = process.env.OLLAMA_MODEL || "qwen2.5vl";
  }

  async extract(bytes: Buffer, hints: ExtractHints): Promise<ExtractedInvoice> {
    const imageB64 = hints.mime === "application/pdf" ? pdfToPngBase64(bytes) : bytes.toString("base64");
    const res = await fetch(`${this.host}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        prompt: PROMPT,
        images: [imageB64],
        stream: false,
        format: "json",
        options: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    const json: any = await res.json();
    if (!json.response) throw new Error("Ollama returned no content");
    return sanitizeExtraction(JSON.parse(json.response));
  }
}

/** First page of a PDF → PNG base64, via macOS `sips` (no extra deps). */
function pdfToPngBase64(pdf: Buffer): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ollama-"));
  try {
    const pdfPath = path.join(tmp, "in.pdf");
    const pngPath = path.join(tmp, "page.png");
    fs.writeFileSync(pdfPath, pdf);
    execSync(`sips -s format png --resampleWidth 1700 "${pdfPath}" --out "${pngPath}"`, { stdio: "pipe" });
    return fs.readFileSync(pngPath).toString("base64");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
