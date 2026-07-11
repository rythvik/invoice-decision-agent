# invoice-decision-agent — End-to-End Build Plan

> Repo/product name: **invoice-decision-agent** — an AI agent that turns invoice PDFs into clear, reasoned decisions.

> Zamp ASA Case Study · PS-1 (Invoice processing — from PDF to decision)
> Also an open-source product: self-hostable invoice triage anyone can run.

---

## 1. What we are building

A web app where an invoice PDF goes in, a deterministic pipeline runs, each stage
narrates itself live in plain language, and out comes a clear, reasoned decision —
with every intermediate step visible, and a dashboard of all runs.

**One-liner:** One invoice in → a defensible APPROVE / REVIEW / HOLD decision out,
with every step laid bare — and the edge cases prove the logic is deliberate.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Agent type | Fixed 8-stage pipeline. Code orchestrates; LLM only at perception points. **AI extracts, rules decide.** |
| Stack | Next.js + TypeScript, single app. SQLite storage. SSE streaming for live-run view. |
| Extraction | Pluggable `ExtractionProvider`: **Gemini Flash (free tier) = demo default**, Ollama Qwen2.5-VL = open-source local option, Claude = optional max quality. |
| Ingestion | Pluggable `IngestionSource`: **LocalInboxSource (simulated inbox) = demo default**, ImapSource (any email via app password) = day-6 stretch / open-source headline. No live Gmail/Zapier in the demo. |
| Decision states | **APPROVE / REVIEW / HOLD** — the process never hard-rejects. Humans act on finished runs from the dashboard; nothing blocks mid-run. Fully autonomous PDF → decision. |
| Fraud | A rule *category*, not a new state: fraud flags → REVIEW with high-priority security treatment (🛡️ "do not pay until verified"). |
| Amount bands | Directional (overage only) + cumulative across all invoices on the PO: ≤5% over = OK · >5% = REVIEW · >10% = REVIEW (high priority). Under-billing is not an amount problem. |
| Open source | MIT license, GitHub public. No hardcoded credentials. `.env.example`. Editable JSON seed data. Works out of the box with bundled sample inbox. Zero-cost path documented (Ollama = no API key at all). |
| Human-in-loop | Optional, after the run: dashboard lets a person resolve REVIEW/HOLD items. Never a mid-run prompt. |

## 3. Decision model

Each rule emits PASS / WARN / HOLD. Precedence: **HOLD > REVIEW > APPROVE.**

| Outcome | Meaning | Triggers |
|---|---|---|
| APPROVE | Clean, auto-cleared | No flags; ≤5% over PO; math closes; vendor known; PO matched; not duplicate |
| REVIEW | Evaluated, needs a human | >5% over, duplicate, unknown vendor, PO not found, cumulative over-bill, any fraud signal (security-flavored) |
| HOLD | Could not evaluate | Missing invoice#/date/total; math doesn't add up; unreadable document |

### Rule registry (to be frozen in SPEC.md)

**Data quality → HOLD:** MISSING_CRITICAL_FIELD, MATH_INCONSISTENT, UNREADABLE_DOCUMENT, NOT_AN_INVOICE (graceful exit for non-invoice uploads), LOW_CONFIDENCE_EXTRACTION (vision model unsure of a critical field → REVIEW, or HOLD if it's the total)
**Business → REVIEW:** AMOUNT_OVER_TOLERANCE (>5%), AMOUNT_SIGNIFICANTLY_OVER (>10%, high priority), DUPLICATE, UNKNOWN_VENDOR, PO_NOT_FOUND, PO_OVERBILLED (cumulative), VENDOR_INACTIVE, CURRENCY_MISMATCH (invoice currency ≠ PO currency → never compare raw numbers across currencies; route to REVIEW)
**Fraud/security → REVIEW 🛡️:** BANK_ACCOUNT_CHANGED (BEC), TAX_ID_MISMATCH, REMIT_TO_MISMATCH, LOOKALIKE_EMAIL_DOMAIN, URGENCY_LANGUAGE, ROUND_AMOUNT_NO_DETAIL, DORMANT_VENDOR_ACTIVITY

## 4. Pipeline (8 stages, each emits a StageEvent)

1. Intake — accept PDF, create run record
2. Classify — text PDF vs scanned image; is it an invoice at all
3. Extract 🤖 — vision LLM → normalized field JSON + per-field confidence
4. Normalize 🤖 — bundled/itemised, tax embedded/separate → canonical {subtotal, tax, total}
5. Validate — math self-consistency, required fields (deterministic)
6. Match PO 🤖 — explicit PO# lookup → fallback: infer implied PO from vendor+amount → ambiguous = REVIEW
7. Rules — deterministic rule engine → reason codes with severities
8. Decide — severity aggregation → decision object; persist

`StageEvent { run_id, stage, status, plain_summary, values, details, confidence, duration_ms }`
— streamed via SSE (live-run view), persisted to SQLite (dashboard), and is the audit trail. One record, three jobs.

**Reliability:** an LLM call that fails/times out never crashes a run — the stage retries once, then the run completes as HOLD with UNREADABLE_DOCUMENT ("couldn't read this document — try again"). Every run always ends with a decision.

## 5. UI surfaces

- **Inbox** — simulated vendor mailbox (seeded rows + real PDFs in /data/inbox) + "Receive invoice" upload to prove nothing is canned. Process one or all.
- **Live run** — chat-style: stages tick off in plain language with real extracted values inline; amber when a check trips; decision card is the hero (reasons in plain English). No approve/reject buttons mid-run.
- **Dashboard** — all runs, status chips, review queue surfaced, click any run to replay its timeline. Human can resolve REVIEW/HOLD items here.

## 6. Edge cases (4 — each exercises a different branch)

| # | Case | Proves | Expected outcome |
|---|---|---|---|
| 1 | Scanned-image invoice | Real vision extraction | APPROVE |
| 2 | Duplicate submission | Duplicate control | REVIEW |
| 3 | Split-PO, 3rd invoice over-bills cumulatively | Stateful matching | REVIEW (high priority) |
| 4 | BEC fraud: bank change + urgency + lookalike domain | Fraud module | REVIEW 🛡️ security |

## 7. Borrow vs build

**Borrowed (~30%):** 15 sample invoice PDFs + 3 downloaded ones; vendor/PO seed structure (`seed_data.json`); rule taxonomy + 5% threshold (reference repo skill.md); SQLite schema base.
**Built (~70%):** everything that runs — pipeline, providers, rule engine, SSE, all three UI surfaces, edge-case logic, README.
**Test-world principle:** author one coherent dataset; every invoice's expected decision is derivable from data we define. No guessing.

## 8. Phases

- **Phase 0 — Spec + test world** (no app): SPEC.md — StageEvent + decision-object schemas, **extracted-field schema**, frozen rule table, IngestionSource/ExtractionProvider interfaces, **ASSUMPTIONS log** (2-way match, single entity, USD base, etc. — FAQ says note assumptions for the pitch); vendors.json, purchase_orders.json, invoice → expected-decision map. **Create missing test PDFs: scanned-image invoice, split-PO series (3 invoices on one PO), BEC fraud invoice.** Done when: every rule has a threshold, severity, and plain-English message; every test invoice has an expected outcome and a real PDF.
- **Phase 1 — Engine, plain view**: scaffold Next.js + SQLite; 8 stages end-to-end on the happy path; console/JSON view (= FAQ floor, always demoable). Done when: happy-path invoice → correct decision as text.
- **Phase 2 — Rule engine complete**: all rules + severity aggregation + directional/cumulative bands. Build the **golden-test runner**: one script runs every sample invoice through the pipeline and asserts its expected decision (our test suite + pre-demo regression check). Done when: golden runner passes 100%.
- **Phase 3 — Live-run UI**: upload → SSE → ticking stages → decision hero card.
- **Phase 4 — Inbox + dashboard + edge cases + ship**: inbox view, dashboard/replay, 4 edge cases one at a time, README + MIT + .env.example, deploy (Vercel + Turso, or Railway), GitHub publish.
- **Gate (end of day 5):** core 100% green? → Day 6 = ImapSource (real email, live demo moment). Not green? → IMAP ships post-submission.

## 9. Day allocation

| Day | Work |
|---|---|
| 1 | Phase 0 + scaffold |
| 2 | Phase 1 (extract, normalize, validate, match) |
| 3 | Phase 2 (rules + decisions correct on all test invoices) |
| 4 | Phase 3 (live-run UI) |
| 5 | Phase 4 (inbox, dashboard, edge cases) → GATE |
| 6 | IMAP stretch (if green) · deploy · GitHub polish |
| 7 | Demo video (5 min), rehearse live runs, submit |

## 10. Cut-line (if time runs short)

Protect in order: correct decisions > live-run UI > dashboard > 4th edge case > IMAP > deploy polish.
Drop from the bottom. Phase 1's plain view means there is always something that runs.

## 11. Demo script (interview)

1. Open inbox → process the clean invoice → watch stages tick → APPROVE with reasons
2. Upload a fresh PDF live (proves it's not canned)
3. Edge cases in order: scanned → duplicate → split-PO → fraud 🛡️
4. Dashboard: review queue, replay a run, resolve one item
5. If IMAP shipped: email an invoice to the test account live, watch it auto-process
6. Talking points: AI-extracts/rules-decide; never hard-rejects (humans make negative calls); "Friday afternoon" framing; ingestion + extraction are pluggable seams; open-source + local-model privacy story

## 12. API key handling

Gemini key goes in `.env.local` (gitignored from first commit; never in chat, never on GitHub).
`.env.example` documents: GEMINI_API_KEY · EXTRACTION_PROVIDER=gemini|ollama|anthropic · IMAP_* (optional).
