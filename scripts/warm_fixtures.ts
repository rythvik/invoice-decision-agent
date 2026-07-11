// Inject extraction fixtures into the content-addressed cache, so the pipeline
// runs end-to-end with zero API calls. Cache key = sha256(pdf).slice(0,16),
// matching CachingProvider. Re-run any time; safe and idempotent.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { FIXTURES } from "./fixtures";

const CACHE_DIR = path.join(process.cwd(), "data", ".extraction_cache");
const INBOX = path.join(process.cwd(), "data", "inbox");

fs.mkdirSync(CACHE_DIR, { recursive: true });
let n = 0;
for (const [file, extracted] of Object.entries(FIXTURES)) {
  const pdfPath = path.join(INBOX, file);
  if (!fs.existsSync(pdfPath)) { console.warn("  ! missing PDF:", file); continue; }
  const hash = crypto.createHash("sha256").update(fs.readFileSync(pdfPath)).digest("hex").slice(0, 16);
  fs.writeFileSync(path.join(CACHE_DIR, `${hash}.json`), JSON.stringify(extracted, null, 2));
  n++;
}
console.log(`Wrote ${n} extraction fixtures into cache (${CACHE_DIR}).`);
