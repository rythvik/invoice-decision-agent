// Golden-test runner — SPEC §9. Runs every test invoice through the REAL pipeline
// (including live extraction) and asserts the expected decision. Our test suite +
// pre-demo regression check.  Usage: npm run golden
import fs from "fs";
import path from "path";
import { loadEnv } from "./env";
loadEnv();
process.env.DB_PATH = path.join(process.cwd(), "storage", "golden.db");

import { resetDb, seedMasters } from "../lib/db";
import { processInvoice } from "../lib/pipeline";
import { warmFixtures } from "../tests/fixtures";

interface GoldenCase {
  file: string; expect: string; must_include: string[];
  security?: boolean; priority?: string; note?: string;
}

async function main() {
  // fresh, isolated DB for the golden world
  for (const f of [process.env.DB_PATH!, process.env.DB_PATH! + "-wal", process.env.DB_PATH! + "-shm"])
    if (fs.existsSync(f)) fs.rmSync(f);
  resetDb();
  seedMasters(path.join(process.cwd(), "data"));
  warmFixtures(); // fill the extraction_cache so the run uses fixtures, not the API

  const golden: { cases: GoldenCase[] } = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "tests", "golden.json"), "utf-8")
  );

  let pass = 0, fail = 0;
  const rows: string[] = [];
  const delayMs = Number(process.env.GOLDEN_DELAY_MS ?? 0); // fixtures are local → no throttle needed
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (const c of golden.cases) {
    const pdfPath = path.join(process.cwd(), "tests", "sample_invoices", c.file);
    if (!fs.existsSync(pdfPath)) {
      rows.push(`✗ ${c.file} — MISSING FILE`);
      fail++;
      continue;
    }
    if (delayMs) await sleep(delayMs);
    const pdf = fs.readFileSync(pdfPath);
    const gen = processInvoice(pdf, c.file, "golden");
    let result: any = null;
    while (true) {
      const { value, done } = await gen.next();
      if (done) { result = value; break; }
      // stage events stream by — print compactly for debugging
      const ev = value;
      process.stdout.write(`  [${ev.stage}] ${ev.name}: ${ev.status} — ${ev.summary.slice(0, 90)}\n`);
    }
    const d = result.decision;
    const codes = new Set((d?.reasons ?? []).map((r: any) => r.code));
    const problems: string[] = [];
    if (d?.outcome !== c.expect) problems.push(`outcome ${d?.outcome} ≠ ${c.expect}`);
    for (const code of c.must_include) if (!codes.has(code)) problems.push(`missing reason ${code}`);
    if (c.security !== undefined && Boolean(d?.security) !== c.security) problems.push(`security ${d?.security} ≠ ${c.security}`);
    if (c.priority !== undefined && d?.priority !== c.priority) problems.push(`priority ${d?.priority} ≠ ${c.priority}`);

    if (problems.length === 0) {
      pass++;
      rows.push(`✓ ${c.file} → ${d.outcome}${d.security ? " 🛡" : ""}${d.priority === "high" ? " (high)" : ""} [${[...codes].join(",") || "clean"}]`);
    } else {
      fail++;
      rows.push(`✗ ${c.file} → ${d?.outcome} [${[...codes].join(",")}] — ${problems.join("; ")}`);
    }
  }

  console.log("\n──────── GOLDEN RESULTS ────────");
  for (const r of rows) console.log(r);
  console.log(`────────────────────────────────\n${pass} passed, ${fail} failed of ${golden.cases.length}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
