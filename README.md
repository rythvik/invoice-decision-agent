# invoice-decision-agent

**From invoice PDF to a clear, reasoned decision — with every step visible.**

An AP clerk opens each vendor invoice, finds the matching purchase order, checks the
numbers, and decides what to do — hundreds of times a month. It's slow, and a tired
person on a Friday afternoon makes expensive mistakes. This agent does that work: drop
in an invoice, and it reads it, validates it, matches it to a PO, runs the checks, and
returns **Approve / Review / Hold** — with the reasoning laid bare and a full audit trail.

It reads clean PDFs *and* scanned images, catches duplicates, spots invoice fraud (BEC
bank-change, lookalike domains, urgency pressure), and tracks split-PO over-billing
across invoices. It never auto-rejects — the machine clears the clean ones and routes
everything judgmental to a human, with the homework already done.

> Design principle: **AI reads, rules decide.** A vision model extracts the invoice
> (the messy part only an LLM can do); a deterministic rule engine makes the call — so
> every decision is reproducible, auditable, and explainable to a non-technical buyer.

---

## Quickstart

```bash
git clone <your-repo-url> invoice-decision-agent
cd invoice-decision-agent
npm install
cp .env.example .env.local        # then paste your free Gemini key (see below)
npm run seed                      # load vendors, POs, and the sample inbox
npm run dev                       # http://localhost:3000
```

Open the browser, click **Process** on any invoice, and watch it run.

### The API key (free, no card)

Extraction uses Google's Gemini (generous free tier). Get a key at
[aistudio.google.com](https://aistudio.google.com) → *Get API key* (no credit card),
and paste it into `.env.local`:

```
GEMINI_API_KEY=AIza...
```

Prefer **zero external calls**? The extraction layer is pluggable — a local
[Ollama](https://ollama.com) vision model (`qwen2.5-vl`) is the drop-in privacy option,
so invoices never leave your machine. (Adapter stubbed for v1; Gemini is the default.)

---

## What you see

- **Inbox** — a simulated vendor mailbox (swap in the real IMAP adapter to watch your
  own inbox). Process one, or drag in a fresh PDF.
- **Live run** — each stage narrates itself in plain language as it executes, with the
  real extracted values inline, ending in a decision card.
- **Dashboard** — every run, a review queue of what needs a human, and click-to-replay
  the full audit trail of any past run.

## How it works — the pipeline

A fixed 8-stage assembly line. Your code runs the stages in order; the LLM is called at
exactly one of them (extraction). Every stage emits a `StageEvent` that is streamed to
the live view, persisted for the dashboard, and forms the audit trail.

| # | Stage | What it does |
|---|-------|--------------|
| 1 | Intake | Accept the PDF, open a run |
| 2 | Classify | Digital vs scanned (content-stream probe) |
| 3 | **Extract** 🤖 | Vision LLM → structured fields + confidence |
| 4 | Normalize | Bundled/itemised, tax in/out → a canonical comparison basis |
| 5 | Validate | Math self-consistency, required fields present |
| 6 | Match PO | Explicit PO# → else infer from vendor + amount |
| 7 | Rules | The deterministic registry (below) |
| 8 | Decide | Aggregate severities → the decision |

## The decision model

Three outcomes, all decided autonomously — **the process never hard-rejects.**

| Outcome | Meaning |
|---------|---------|
| **APPROVE** | Clean: within tolerance, math closes, vendor known, PO matched, not a duplicate |
| **REVIEW** | Evaluated, needs a human — anything judgmental (fraud signals get a 🛡 security treatment) |
| **HOLD** | Couldn't evaluate — missing critical fields, math doesn't add up, or not an invoice |

Decision = worst severity fired. `HOLD > REVIEW > APPROVE`. A human resolves REVIEW/HOLD
items from the dashboard — an action on a *finished* run, never a pause mid-run.

### Rules

- **Data quality → HOLD:** missing invoice#/date/total, math inconsistent, unreadable, not-an-invoice, low-confidence total
- **Business → REVIEW:** unknown vendor, inactive vendor, PO not found, PO/vendor mismatch, ambiguous match, currency mismatch, duplicate, amount over tolerance (>5%) / significantly over (>10%), cumulative PO over-bill
- **Fraud / security → REVIEW 🛡:** bank account changed (BEC), tax-ID mismatch, remit-to mismatch, lookalike email domain, urgency language, round-amount-no-detail, dormant-vendor activity

Amount checks are directional (overage only; under-billing is fine) and measured against
the PO's **remaining** value, ex-tax. Cumulative billing across invoices is tracked, so
the third invoice on a PO can trip an over-bill the first two didn't.

## Edge cases handled (deliberately)

1. **Scanned image invoice** → APPROVE (real vision extraction, not text-parsing)
2. **Duplicate** → REVIEW, naming the original run
3. **Split-PO over-billed** → REVIEW, from cumulative tracking
4. **BEC fraud** (bank change + urgency + lookalike domain) → REVIEW 🛡 security

## Testing

```bash
npm run golden       # runs every sample invoice through the pipeline, asserts its decision
```

The engine is tested with **extraction fixtures** (`scripts/fixtures.ts`) so the
deterministic logic — rules, matching, decisions — is validated with zero API calls.
Live extraction is exercised in the app and the demo. Warm the fixtures cache with
`npm run warm-fixtures` (run automatically for the golden suite).

## Assumptions

2-way match (invoice ↔ PO; no goods-receipt data); single legal entity; USD base
(other currencies route to REVIEW rather than being converted); duplicates keyed on
invoice number + vendor. See `SPEC.md` for the full contract.

## Architecture notes

- **Pluggable extraction** (`ExtractionProvider`): Gemini today; Ollama (local) and
  Anthropic are drop-in.
- **Pluggable ingestion** (`IngestionSource`): a local sample inbox today; an IMAP
  adapter (connect any email with an app password) is the path to production — each
  self-hosted deployment uses its own credentials, so no central OAuth app is needed.
- **Extraction cache**: content-addressed, so each unique invoice is read once.

## Stack

Next.js 15 · TypeScript · SQLite (better-sqlite3) · Gemini vision · SSE streaming.

## License

MIT — see [LICENSE](LICENSE).
