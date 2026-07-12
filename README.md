# invoice-decision-agent

**From invoice PDF (or image) to a clear, reasoned decision — with every step visible.**

An AP clerk opens each vendor invoice, finds the matching purchase order, checks the
numbers, and decides what to do — hundreds of times a month. It's slow, and a tired
person on a Friday afternoon makes expensive mistakes. This agent does that work:
it reads invoices straight from your email, validates them, matches them to a PO, runs the
checks, and returns **Approve / Review / Hold** — with the reasoning laid bare and a full
audit trail.

It reads clean PDFs, scanned images, *and* photo/JPG/PNG invoices; catches duplicates;
spots invoice fraud (BEC bank-change, lookalike domains, urgency pressure); infers a PO when
none is printed; and tracks split-PO over-billing across invoices. It never auto-rejects —
the machine clears the clean ones and routes everything judgmental to a human, with the
homework already done.

> Design principle: **AI reads, rules decide.** A vision model extracts the invoice (the
> messy part only an LLM can do); a deterministic rule engine makes the call — so every
> decision is reproducible, auditable, and explainable to a non-technical buyer.

---

## Quickstart

```bash
git clone <your-repo-url> invoice-decision-agent
cd invoice-decision-agent
npm install
cp .env.example .env.local        # then fill in a key and/or your mailbox (below)
npm run seed                      # load the vendor + PO masters
npm run dev                       # http://localhost:3000
```

Then either **Upload** a PDF/image on the home screen, or connect email and click
**Check mail**.

### Extraction — pick one (both free)

Set `EXTRACTION_PROVIDER` in `.env.local`:

- **`gemini`** — Google's Gemini, generous free tier. Get a key at
  [aistudio.google.com](https://aistudio.google.com) → *Get API key* (no credit card) and put
  it in `GEMINI_API_KEY`. Each unique invoice is read once (cached), so you rarely touch the API.
- **`ollama`** — a local vision model, **no key, no limit, offline**. Install
  [Ollama](https://ollama.com), run `ollama pull qwen2.5vl`, and invoices never leave your machine.
- **`gemini,ollama`** — cloud first, and it **auto-falls back to Ollama** the moment Gemini's
  daily cap is hit.

### Email — connect your mailbox (optional)

To pull invoices straight from email, add IMAP details to `.env.local` using an **app
password** (never your login password):

```
IMAP_HOST=imap.gmail.com
IMAP_USER=you@example.com
IMAP_PASSWORD=your-app-password
```

Then click **Check mail**. Fetching is **incremental and idempotent** — each email is
processed once; re-checking only pulls new ones. One email can carry several invoices; each
gets its own decision. No email configured? Just use **Upload**.

---

## What you see

- **Inbox** — real vendor email (via IMAP) plus a manual upload box, on one screen.
- **Live run** — each stage narrates itself in plain language as it executes, with the real
  extracted values inline, ending in a decision card. Multiple invoices from one email stack
  as separate live blocks.
- **Dashboard** — every run, a review queue of what needs a human, and click-to-replay the
  full audit trail of any past run.

## How it works — the pipeline

A fixed 8-stage assembly line. Your code runs the stages in order; the LLM is called at
exactly one of them (extraction). Every stage emits a record that is streamed to the live
view, persisted for the dashboard, and forms the audit trail.

| # | Stage | What it does |
|---|-------|--------------|
| 1 | Intake | Accept the PDF/image, open a run |
| 2 | Classify | Digital vs scanned vs image |
| 3 | **Extract** 🤖 | Vision LLM → structured fields + confidence |
| 4 | Normalize | Bundled/itemised, tax in/out → a canonical comparison basis |
| 5 | Validate | Math self-consistency, required fields present |
| 6 | Match PO | Explicit PO# → else **infer** from vendor + amount |
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

**Rules:** missing fields / math / unreadable / not-an-invoice → HOLD · unknown or inactive
vendor, PO not found, missing date, currency mismatch, duplicate, amount over 5% / 10%,
cumulative PO over-bill → REVIEW · bank-account change (BEC), tax-ID / remit-to mismatch,
lookalike email domain, urgency language, round-amount-no-detail → REVIEW 🛡.

## Edge cases handled (deliberately)

Scanned image · photo/JPG invoice · duplicate · split-PO over-bill · BEC fraud · implied PO ·
missing date · bundled/tax-embedded amounts · multi-invoice email · multi-currency.

## Data — one SQLite database, all browsable

Open `storage/app.db` in any SQLite viewer:

| Table | What's in it |
|---|---|
| `vendors` / `purchase_orders` | the masters |
| `invoices` | each processed invoice + its decision |
| `audit_log` | the step-by-step trail for every invoice |
| `inbox` | received emails |
| `extraction_cache` | one row per unique document read (avoids re-calling the LLM) |

## Testing

```bash
npm run golden       # runs every sample invoice through the pipeline, asserts its decision
```

The engine is tested with **extraction fixtures** (`scripts/fixtures.ts`) so the deterministic
logic — rules, matching, decisions — is validated with zero API calls. Live extraction is
exercised in the app.

## Assumptions

2-way match (invoice ↔ PO; no goods-receipt data); single legal entity; USD base (other
currencies route to REVIEW rather than being converted); duplicates keyed on invoice number +
vendor. See `SPEC.md` for the full contract.

## Project structure

The folders mirror the architecture — *AI reads, rules decide*:

```
app/                     Next.js pages + API routes (inbox, dashboard, process, auth)
components/              React UI (the live-run view)
lib/
  pipeline.ts            the 8-stage assembly line (reads top-to-bottom)
  rules/engine.ts        the deterministic decision engine
  matching.ts            PO matching (explicit → inferred)
  extraction/            AI providers: gemini, ollama, + SQLite cache
  ingestion/             email: gmail (OAuth), imap (app password)
  db.ts, types.ts        SQLite access + shared contracts
data/                    app config only
  vendors.json           vendor master
  purchase_orders.json   PO register
scripts/                 seed, golden test runner, PDF generator
tests/                   the automated test suite (never used by the running app)
  sample_invoices/       test invoice PDFs
  golden.json            expected decision for each
  fixtures.ts            hand-authored extractions (so tests need no API)
storage/                 runtime SQLite DB + fetched mail (gitignored)
SPEC.md                  the frozen contract (schemas, rule table, assumptions)
```

## Stack

Next.js 15 · TypeScript · SQLite (better-sqlite3) · Gemini / Ollama vision · Gmail API (OAuth) ·
IMAP (imapflow + mailparser) · SSE streaming.

## License

MIT — see [LICENSE](LICENSE).
