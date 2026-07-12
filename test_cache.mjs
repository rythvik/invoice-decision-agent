import crypto from "crypto";
import sqlite3 from "better-sqlite3";
import { readFileSync } from "fs";
import { join } from "path";

const db = new sqlite3(join(process.cwd(), "storage/golden.db"));
const pdfPath = "/Users/rithvik1/Desktop/ZAMP TASK/Files to Upload/PDF'S/INV_001_clean_acme_office.pdf";
const pdf = readFileSync(pdfPath);
const hash = crypto.createHash("sha256").update(pdf).digest("hex").slice(0, 16);

console.log("PDF hash:", hash);
const result = db.prepare("SELECT COUNT(*) as cnt FROM extraction_cache WHERE hash = ?").get(hash);
console.log("Cache hit:", result);

const fullResult = db.prepare("SELECT hash, filename, extracted_json FROM extraction_cache WHERE hash = ?").get(hash);
if (fullResult) {
  const extracted = JSON.parse(fullResult.extracted_json);
  console.log("Cached invoice number:", extracted.invoice_number);
} else {
  console.log("Not in cache!");
}
