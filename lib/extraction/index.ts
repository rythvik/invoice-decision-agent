import type { ExtractionProvider } from "../types";
import { CachingProvider } from "./cache";
import { GeminiProvider } from "./gemini";

export function getProvider(): ExtractionProvider {
  const which = (process.env.EXTRACTION_PROVIDER || "gemini").toLowerCase();
  let base: ExtractionProvider;
  switch (which) {
    case "gemini":
      base = new GeminiProvider();
      break;
    // Planned: "ollama" (fully local, zero-API privacy mode), "anthropic"
    default:
      throw new Error(`Unknown EXTRACTION_PROVIDER "${which}". Supported: gemini`);
  }
  return process.env.EXTRACTION_CACHE === "off" ? base : new CachingProvider(base);
}
