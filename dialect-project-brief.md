# Dialect: Project Brief (Night Shift Hackathon, built on Mubit)

> **Purpose of this document:** a complete handover for an agent or teammate joining the project. It covers the hackathon, how Mubit actually works (verified from its docs, the console and the Mubit team), the Dialect concept, the full build plan, data specs, evaluation approach, demo, risks and open questions.
>
> **Status as of Sat 24 Oct 2026, ~14:45 London time.** Code freeze is **Sun 25 Oct, 10:00 AM**.

---

## 1. The hackathon

**Night Shift**: a 42-hour overnight hackathon in London built around Mubit. 500 builders; $65K in prizes ($15K / $10K / $5K cash for top 3, plus $35K in AI credits); $1.5M in Mubit credits for accepted hackers.

**The brief:** build a product that routes its LLM calls through Mubit and turns your corrections into model updates for a recurring task.

**Tracks** (top 3 prizes are judged across all tracks):
- **Recurring tasks:** a task your product runs again and again (extraction, triage, support replies, review, routing). Show corrections becoming model updates.
- **Own your intelligence layer:** move a workload from a closed model onto a task-adapted open model. Show quality, cost and latency side by side.
- **Fast refresh:** a workload that keeps changing. Show model updates keeping pace.

**Judging (four criteria, equal weight):**
1. **Use of Mubit:** show a correction turning into a model update in the demo.
2. **Usefulness:** a real recurring task someone would want handled.
3. **Technical execution:** it works, and it holds up under questions.
4. **Demo:** clear, live, and under the time limit.

**Schedule (remaining):**
- Sun 25 Oct, 2:00 AM: clocks go back to 1:00 AM (an extra hour).
- Sun 10:00 AM: **code freeze**, submissions close.
- Sun 10:30 AM: judging round 1 (expo).
- Sun 12:30 PM: finalist demos on stage.
- Sun 1:30 PM: awards.

**Rules:** all project code written during the event; open-source libraries fine; **every project must route its LLM calls through Mubit**; at least one team member at Sunday's demos.

---

## 2. How Mubit actually works

Verified from https://docs.mubit.ai/ (full text: https://docs.mubit.ai/llms-full.txt), the team's own console, and the Mubit team.

### 2.1 Core mechanics
- Mubit is a **gateway**. The app calls its normal provider model (OpenAI, Anthropic, Gemini, or OpenAI-compatible services) through Mubit by changing the **base URL** and using a **Mubit key** instead of the provider key. Model IDs stay the same.
- Mubit **records every call** (request and reply) by default.
- Mubit **groups calls into tasks**. Calls form one task when they share all of: **instructions (system prompt), tools, tool choice, output format, model.** User messages and settings like temperature don't count.
  - Whitespace runs count as one space; numbers, dates, times and IDs don't split a task; **any other changing word in the system prompt creates a new task.**
  - Same instructions sent to two different models = two tasks.
- A **reviewer** decides which recorded calls become **kept examples**. Not every call is kept.
- By default, a task **first trains at 25 kept examples**. Mubit also needs enough examples to hold some back as test cases.
- Mubit trains an **adapter**: a small open model fine-tuned for that one task. This is effectively **automated per-task distillation**: the frontier model is the teacher, the adapter is the student.
- Each training creates a **version** (v1, v2, v3…). Each version is **tested against the provider (frontier) model's answers** on held-back test cases. This is **matching, not correctness.**
- Version results: `Passed`, `Below target` (e.g. "Matched {a}% of your provider model's answers on {n} test cases · needs {need}%"), `Malformed tool calls`, `Prompt only` (the plain base model with the task's prompt did as well, so no usable adapter), `Not tested`.
- After a version, the adapter shows "Next: a new version after {N} new examples". A new version needs **new** kept examples.
- A passing version can be compared side by side with the provider model in the console's **Try models** page.
- Once passing, an adapter can **answer live calls itself** (console shows "Answered by your model" and a "By your adapter" column; Tasks has a "Live" tab). Mubit then measures "Results on real calls".

### 2.2 Hard constraints
- **There is no Mubit model ID. You cannot call an adapter directly by API.** *Confirmed by the Mubit team.* Adapters can only be tried manually in Try models, or (possibly) answer live traffic automatically once passing.
- **Try models limits:** a daily number of Try models calls per organisation (resets 00:00 UTC); **3 adapter starts per organisation per UTC day**; first start of an adapter can take a few minutes (the page retries every 15 s for up to 20 minutes).
- **Training limits:** a daily training limit (resets 00:00 UTC) and a pause between trainings. **Expect only a handful of versions during the hackathon.**
- **Training can fail with "examples too long to train on".** Keep prompts and outputs short.
- **No retry button.** After a failed training, Mubit only retries when new examples arrive.
- One **project per workspace**; can't add or delete projects. Separate experiments via distinct system prompts (each = its own task). Use separately named Mubit keys per experiment to tell traffic apart.
- Call Mubit **from a server, not the browser** (no CORS preflight support).
- Console signs out after 15 minutes of inactivity.

### 2.3 Integration details
```python
import os
from openai import OpenAI

client = OpenAI(
    base_url="https://api.mubit.ai/openai/v1",   # use the base URL shown on the console's Connect page
    api_key=os.environ["MUBIT_API_KEY"],
)

resp = client.chat.completions.create(
    model="<frontier model id>",                  # e.g. the docs use gpt-6-luna on the starter credit
    messages=[
        {"role": "system", "content": SYSTEM_PROMPT},   # FIXED, never changes
        {"role": "user", "content": question},
    ],
    # On starter credit, omit metadata and store. Mubit derives a session
    # from the fixed instructions and first user message.
)
```
- Other base URLs: Anthropic `https://api.mubit.ai/anthropic` (no /v1), Gemini `https://api.mubit.ai/gemini`, OpenAI-compatible `https://api.mubit.ai/compat/{openrouter|groq|together|mistral}/v1`.
- **Sessions:** Mubit sets test cases aside **by session**. Without explicit metadata, it derives the session from the instructions and first user message, so distinct questions get distinct sessions. Observed starter-credit constraint: explicit metadata requires `store: true`, but starter credit rejects storage. Therefore the current runner omits both and uses automatic sessions. With your own provider key configured in Mubit, explicit `metadata.session_id` can be used if storage is enabled. Use question text to find starter-credit calls; a locally generated request ID is not the console session ID.
- **Recording headers** (not forwarded to provider):
  - `x-middleware-store: false` → keep a record without request/answer.
  - `x-middleware-record: full | metadata | off` → `off` also drops the task fingerprint. **Calls recorded without request and reply never become kept examples.**
- **Response header** `x-middleware-request-id` (`mreq_…`) on every answer. Note: the console's Request ID in call details is **not** the same as this header, so **use `session_id` to link app records to console records.**
- Keys: Mubit key starts with `mbt_`; send only the Mubit key. Provider keys are added in the console under **Provider keys**.

### 2.4 Console observations (the team's own workspace)
- **Connect page:** banner said "No provider key yet. Calls fail until you add one." → **add the OpenAI provider key** (or confirm starter credit). A Mubit key exists (`ws-…-prod`, `mbt_mw-app_5…`).
- **Sidebar:** Overview, Tasks, Adapters, Try models, Requests, **Learnings** (undocumented), Connect, Import past calls.
- **Tasks page tabs:** All tasks / **Live** / **Needs review** / **Learning**. Columns: Task, Status, Next, Calls · 7 days, **By your adapter**.
- **Test task** "Explain products clearly and…": 5 calls sent, **1 kept**, status "Reviewing examples", "Collecting examples: 1 of 25", "Results on real calls: not measured yet". History showed calls sent for review in batches (3, then 2) with no per-call reasons. **Takeaway: the reviewer is selective and slow. Send far more calls than 25, send them early, keep questions genuinely varied.**
- **Feedback UI per call (Requests → call → "Rate this reply"):** **Good / Bad** buttons plus a **Comment** box ("What was right or wrong") and **Save rating**. This is currently the only known correction mechanism. It is manual and in the console; whether it affects training is unconfirmed.

### 2.5 Legal / ToS note (for Q&A)
Distillation from frontier outputs isn't criminal; it's a terms-of-service matter. OpenAI's terms prohibit using outputs to develop models that compete with OpenAI; Anthropic's commercial terms prohibit using the services to build competing products, including training competing AI models, unless approved. A narrow internal task adapter is a grey area; Mubit's business sits in this space. Prepared answer: *"Training signal comes from human labels and corrections, the adapter is a narrow internal tool, not a competing general model, and open-weight teachers with permissive licences can be used via Mubit's OpenRouter/Together routes."*

---

## 3. The project: Dialect

**Tagline:** *Every company speaks its own dialect of its data. Dialect learns yours.*

**Problem:** every company defines its metrics differently. "Active customer" might mean "paid in the last 30 days" at one company and "logged in this month" at another; revenue may or may not exclude refunds; churn has house rules. Generic models produce valid-looking queries with the **wrong business meaning**.

**Product:** an analyst asks a business question in plain English. Dialect returns a structured **query spec** using the company's own definitions. Analysts correct wrong interpretations; corrections are queued for Mubit feedback. The core product learns the company's definitions and maps questions to the right spec. A real database, deterministic SQL compilation and result display come later.

**Why a spec, not raw SQL (key design decision):** an earlier version generated full SQL from a database schema (BIRD-style). That was dropped because Mubit needs short prompts and short outputs ("examples too long to train on" risk), one fixed system prompt, and gradable outputs. A **semantic layer** approach fixes all of this:
- Short system prompt (compact glossary, not a whole schema).
- Short output (a few JSON fields) → cheap training, meaningful match-rate grading.
- Still company-specific: the hard part is mapping messy phrasing onto house definitions. Frontier models do this well with the glossary; small open models don't. That's exactly the gap distillation closes (and avoids a `Prompt only` result).
- Still verifiable: specs can be compared field by field against known correct labels, without a database.

**Honest core claim (do not overclaim "beats GPT"):**
> *For a company's recurring analytics questions, a cheap adapter trained by Mubit matches a fully prompted frontier model at a fraction of the cost and latency, and our correctness layer proves real accuracy for both, with human corrections targeting exactly the answers the frontier gets wrong.*

The adapter's ceiling under pure distillation is the teacher. Corrections are what could take it beyond the teacher, if Mubit's feedback affects training.

**Why it can win:** most teams will only show "the adapter matched GPT X%". Dialect adds a **self-implemented correctness layer** that measures whether either model is actually *right*. That answers the obvious judge question ("but is GPT right?") and makes the numbers hold up.

---

## 4. Matching vs. correctness (central concept)

| What | Who does it | What it tells you |
|---|---|---|
| Adapter vs. frontier agreement, per version | **Mubit, automatically** (Adapters → History) | Is the adapter learning to copy the teacher? (the v1 → v2 → v3 curve) |
| Frontier correctness, on every call | **Our checker** | How often the teacher is actually right, and which answers need correcting |
| Adapter correctness, on a held-back sample | **Our checker**, on answers gathered from Try models (and live calls if the adapter auto-serves them) | Is the adapter actually right? |

**Mubit does the matching; we do the correctness check.** The frontier is **not** assumed to be always correct: we measure it, strengthen it (clear glossary, a few worked examples), and correct its mistakes.

In production there are no gold answers, so the checker is our **evaluation harness**; in real use, analysts' corrections play that role, which is exactly what Mubit's feedback captures. Be ready to say this in Q&A.

---

## 5. Data specification

We **create our own labelled question–spec pairs**. No public dataset matches a company-specific glossary. Start with correct specs, generate questions from them, and review that each question preserves its label's meaning. No customer records, payments or database are needed for training or spec-level evaluation.

### 5.1 Company definitions first: "Canary Labs"
Define the company's metrics, customer segments, time periods, defaults and exceptions. These definitions are the source of truth for both the fixed system prompt and the labelled evaluation questions. Resolve ambiguities before generating training traffic—for example, whether never-paid trials can count as churned, which period an omitted date means, and how historical customer status is evaluated.

**Deferred:** connect a real company database, add a deterministic spec-to-SQL compiler, and display query results. Do not build or populate a synthetic database for the core learning and evaluation loop.

### 5.2 Glossary (goes in the system prompt)
Implemented source of truth: [`dialect/company.json`](dialect/company.json), with 20 rules. Reference date is fixed at **2026-10-24**, timezone **UTC**, currency **GBP**. Key definitions:
```text
active_customer   = qualifying payment on snapshot day or prior 29 days AND not cancelled. Logins do NOT count.
churned_customer  = paid before, AND (cancelled OR last qualifying payment 60+ days before snapshot).
trial_user        = signed up, never paid by snapshot; never active or churned.
net_revenue       = qualifying payments minus refunds recorded within the period. Default meaning of revenue.
gross_revenue     = qualifying payments within the period, refunds ignored.
ARPC              = net revenue / distinct qualifying payers within the period; null if no payers.
customer counts   = snapshot at period end, capped at reference date; not signups or transitions.
omitted period    = today for customer counts; this_month for other metrics.
"last quarter"    = the previous full calendar quarter.
"this year"       = calendar year to date.
```
Cancellation takes precedence over a same-day payment; a later qualifying payment reactivates the customer. Refunds do not erase prior payment history. Status filters on every metric use the period-end customer cohort. Plan and country are also evaluated at that snapshot.

### 5.3 Spec format (the model's output)
Implemented strict schema: [`dialect/query-spec.schema.json`](dialect/query-spec.schema.json). Every successful output contains all six fields, with JSON null for unused dimensions. No extra keys are allowed. Allowed values:
```json
{
  "metric":   "count_customers | net_revenue | gross_revenue | refund_amount | avg_revenue_per_customer | login_count",
  "filter":   "active | churned | trial | null",
  "period":   "today | this_week | last_week | this_month | last_month | this_quarter | last_quarter | this_year | last_year | YYYY-MM | YYYY-Qn",
  "group_by": "plan | country | signup_month | null",
  "plan":     "Starter | Team | Business | null",
  "country":  "GB | US | DE | FR | CA | AU | null"
}
```
Alternatively, return exactly `{"error":"needs_clarification"}` for unresolved ambiguity or `{"error":"unsupported"}` for requests outside the contract. Unsupported requests take precedence. Do not approximate unsupported metrics, rolling periods, multiple groupings or comparisons.

Comparison rule: validate against the schema first, then ignore key order and compare exactly. Required null fields may not be omitted. Keep relative periods relative; named months and quarters use explicit `YYYY-MM` / `YYYY-Qn` tokens.

### 5.4 System prompt (LOCK IT)
Implemented in [`dialect/task.mjs`](dialect/task.mjs): fixed role + reference date + company rules + output instructions + JSON schema. The example company is **Canary Labs**; the product is **Dialect**. The chosen Mubit teacher is `gpt-6-sol`, with JSON-object output mode, medium reasoning effort and a 2,048 completion-token budget. Existing direct OpenAI baseline logs predate the company rename and retain their original prompt fingerprints. The company rename updates the prompt and task lock; business rules and the output schema are unchanged. JSON mode ensures JSON syntax; local schema validation belongs in the checker in the next phase. No worked examples are embedded in this version.

[`dialect/task-lock.json`](dialect/task-lock.json) records hashes for the company definitions, prompt and schema, plus the model and output format. `index.mjs` verifies the lock before any API call. **Once training traffic starts, never edit the task**, since wording or configuration changes can create a new task and restart collection. Deliberate changes require a new task version and evaluation baseline.

**Current workflow:** question–label pairs live in `questions/`; both runners currently read `questions/review-001.json`. Run one question through Mubit with `npm start -- q_001`; `npm start` alone selects the first entry in that file. Calls send only the question and fixed instructions. Both Mubit and direct OpenAI runners save raw responses in `dialect/results/` without comparing them to expected labels. Evaluation runs separately and writes comparisons to `evaluations/`. Earlier direct OpenAI baseline logs contain inline scores from the previous workflow.

The starter-credit Mubit runner uses automatic sessions and saves the source question file, question ID, local request ID, Mubit request ID when available, and request/response. Check the logs and console for actual training traffic.

### 5.5 Example question–answer pairs
[`dialect/contract-examples.json`](dialect/contract-examples.json) contains 18 handwritten examples with complete labels and rule explanations, including ambiguity and unsupported requests. These are contract examples, not the held-out evaluation set. The table below abbreviates null fields for readability; actual outputs must include them and the required period.
| Question (user message) | Correct spec (label) |
|---|---|
| "How many customers are still paying us?" | `{"metric": "count_customers", "filter": "active", "period": "today"}` |
| "Who dropped off last quarter, split by plan?" | `{"metric": "count_customers", "filter": "churned", "period": "last_quarter", "group_by": "plan"}` |
| "What did we actually make in March after refunds?" | `{"metric": "net_revenue", "period": "2026-03"}` |
| "Revenue by country this year" | `{"metric": "net_revenue", "period": "this_year", "group_by": "country"}` |
| "Active users on the Team plan?" | `{"metric": "count_customers", "filter": "active", "period": "today", "plan": "Team"}` |
| "How many people are still on free trial?" | `{"metric": "count_customers", "filter": "trial", "period": "today"}` |

### 5.6 Question generator
1. Programmatically combine metric × filter × period × group_by × plan/country into valid correct specs.
2. Have an LLM paraphrase each spec into casual, varied analyst language (slang, typos, indirect phrasing, synonyms like "still paying", "dropped off", "made after refunds").
3. Deliberately include tricky phrasings that test glossary rules (logins vs payments, trials, refunds, quarter boundaries).
4. De-duplicate; ensure genuine variety (near-duplicates are likely rejected by Mubit's reviewer).
5. Generate **~500** pairs. Note: do the paraphrasing calls **outside the Dialect task** (different system prompt, or not through the Dialect prompt) so they don't pollute it.

### 5.7 Checker
```text
function check(model_reply, correct_spec):
    parse model_reply as JSON; validate schema → if invalid: WRONG
    if canonical(model_spec) == canonical(correct_spec): RIGHT else WRONG
```
Score the model's JSON spec (or tool-call arguments if tool calling is used), not database results or a final prose answer. Database integration and SQL execution are deferred.

---

## 6. Build plan (pseudocode)

```text
# PHASE 1: COMPANY DEFINITIONS
GLOSSARY      = 10–20 company definitions, with explicit defaults and exceptions
SYSTEM_PROMPT = glossary + spec schema + "reply with JSON spec only"
LOCK SYSTEM_PROMPT

# PHASE 2: QUESTIONS WITH ANSWERS
for each combination(metric, filter, period, group_by, plan, country):
    correct_spec = combination
    question     = LLM paraphrase(correct_spec)
    save(question_id, question, correct_spec)
split → BATCH_1 (~150), BATCH_2 (~100–150), BATCH_3 (~50, optional),
        HOLDOUT (~30, never sent before evaluation), LIVE_SET (~100, only if auto-routing exists)

# PHASE 3: CHECKER
check(model_spec, correct_spec) → RIGHT / WRONG

# PHASE 4: SEND TRAINING TRAFFIC (start ASAP, by early evening)
for each q in BATCH_1:
    reply = frontier via Mubit (system=SYSTEM_PROMPT, user=q.question, metadata.session_id=q.id)
    log(q.id, reply, check(reply, q.correct_spec), tokens, latency)
frontier_accuracy = % RIGHT

# PHASE 5: CORRECTIONS
for each WRONG answer:
    Mubit console → Requests → Session filter = q.id → open call
    Rate "Bad"; Comment = "Correct spec: {correct_spec}. Reason: {glossary rule broken}"
    (optionally rate correct ones "Good")
automate if Mubit provides a ratings API

# PHASE 6: LET MUBIT TRAIN
watch Tasks: kept count → 25+ → Reviewing → Training → Testing → v1 result
if kept count low: top up with more new questions
check "Next: a new version after N new examples" → size BATCH_2 to that
send BATCH_2 + corrections → v2; BATCH_3 → v3 (bonus)
record each version's match rate (Adapters → History)

# PHASE 7: COMPARE (adapter can't be called by API)
HOLDOUT: type each question into Try models (side by side)
         record both answers → run checker on both → accuracy for frontier vs adapter
         (mind the daily Try models limit and 3 adapter starts/day)
LIVE (if auto-routing): send LIVE_SET normally, identify which model answered
         via Requests "Served by" (or response model field), score with checker
score each question only the first time it's answered

# PHASE 8: APP + DEMO
APP: question → JSON spec → company definitions applied → "answered by" + cost + latency
     "Mark wrong" → edit spec → save correction (feeds Phase 5)
     scoreboard: frontier vs adapter (accuracy, match rate per version, cost, latency)
# LATER: real database connection → deterministic spec-to-SQL compilation → results
```

**Batch sizing rationale:** the reviewer kept only 1 of the first 5 test calls. At a 20–50% keep rate, 150 calls ≈ 30–75 kept examples, enough for v1 plus held-back test cases. Each new version needs its own fresh examples. Frontier cost is negligible (short prompt, tiny JSON answers).

---

## 7. The app

Server-side backend (Mubit doesn't accept browser calls) plus a simple web UI:
- **Ask box:** analyst types a question.
- **Output panel:** generated JSON spec with the company definitions used to interpret it. Definitions can be displayed deterministically from the glossary; no extra model call is needed.
- **Answered by:** frontier or adapter (where knowable), with cost and latency.
- **Correction flow:** "Mark wrong" → editable spec form → save. Show the corrected spec and the relevant company rule; queue the correction for Mubit (manual console rating for now).
- **Scoreboard:** frontier accuracy (checker), adapter accuracy on the held-out sample (checker via Try models), Mubit match rate per version (v1/v2/v3 curve), cost per 1,000 queries, latency.
- Optional: side-by-side view mirroring Try models.
- **Later:** connect a real database, compile specs to SQL and display query results.

---

## 8. Demo (3 minutes)

1. **Problem (20s):** "Every company has its own definitions. Generic models get them wrong, and frontier calls are expensive at scale."
2. **Live question:** ask something that trips a glossary rule; show a wrong answer.
3. **Correction:** the analyst fixes it in the app; show the Bad rating + comment in Mubit.
4. **Model update:** show v1 → v2 in Mubit (match rate rising), the task under Live / "Answered by your model".
5. **Scoreboard:** frontier vs adapter accuracy (our checker), cost and latency, e.g. "same quality, a fraction of the cost, faster."
6. **Close:** *"Dialect learns your company's dialect from the questions your analysts already ask."*

Have a **screen recording backup**. Rehearse to well under the time limit; the expo round needs a tight ~90-second version.

---

## 9. Scorecard (honest assessment)

| Criterion | Without checker | With checker |
|---|---|---|
| Use of Mubit | 6 | 8 (capped until corrections are confirmed to affect training) |
| Usefulness | 7 | 8 |
| Technical execution | 5 | 9 |
| Demo | 6 | 8 |
| **Total** | **24/40** | **33/40** |

**Track fit:** *Own your intelligence layer*: strong (primary). *Recurring tasks*: good. *Fast refresh*: weak (a glossary change = new system prompt = new task; if mentioned, frame as "Mubit retrains a fresh adapter from new traffic when definitions change").

Verdict: a solid project and a realistic top-3 contender if executed properly.

---

## 10. Open questions for the Mubit team

1. Does a **Bad rating + comment** stop that call from training, or actually teach the adapter the correction? What do the **Learnings** page and **Needs review** tab do?
2. Is there an **API for ratings/feedback**, so the checker can submit corrections automatically?
3. Does a passing adapter **automatically answer live calls**? Under what conditions? Can we tell **which model answered** each call from code (response `model` field or header) or only via Requests "Served by"?
4. How long do **review and training** take right now, and what makes the reviewer **keep or reject** a call?
5. What are our **daily training, Try models and adapter-start limits** for the hackathon? Which **open base model** do adapters use?

**Confirmed already:** adapters **cannot** be queried directly through the API.

---

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Ratings/comments don't affect training → weak "correction → model update" | Confirm with the team first; still demo corrections in-app + in Mubit; lean on v1→v2 from new traffic; keep frontier errors low via a strong glossary |
| Review/training too slow → only v1 by the deadline | Send Batch 1 by early evening; top up quickly if the keep rate is low; send Batch 2 before midnight |
| Can't tell which model answered → no live scoreboard | Use Try models on the HOLDOUT set + Mubit's match rate per version |
| Try models daily limit / 3 adapter starts per day | Plan the holdout size around the limit; don't waste starts on experiments |
| `Prompt only` result (base model already good enough) | Make the glossary rules genuinely tricky so the small base model struggles |
| Accidentally editing the system prompt | Lock it in code as a constant; never edit after Batch 1 |
| Low keep rate from repetitive questions | Maximise variety in the generator; de-duplicate |
| Scope creep | One company glossary, JSON specs, one correction flow, one scoreboard; database and SQL execution deferred |

---

## 12. Timeline (remaining ~19 hours)

| When | What |
|---|---|
| Now – 6pm | Ask the Mubit team the open questions. Add provider key. Define company glossary, defaults and exceptions; lock system prompt. |
| 6pm – 8pm | Question generator + checker. **Send Batch 1 (~150) through Mubit.** |
| 8pm – midnight | Build the app while Mubit reviews/trains. Submit corrections on wrong answers. Check kept count; top up. |
| Overnight | v1 trains. Send Batch 2 + corrections → aim for v2. (Clocks go back at 2am: extra hour.) |
| Sun 6am – 9am | Holdout comparison in Try models, scoreboard, backup recording. |
| 9am – 10am | Rehearse the demo. **Code freeze at 10:00.** |

---

## 13. Key Q&A answers to prepare

- **"Couldn't you just put the definitions in GPT's system prompt?"** Yes, and we do: that's our strong baseline. The point is the adapter matches that fully prompted frontier model at a fraction of the cost and latency, and keeps improving from corrections without anyone maintaining a prompt.
- **"Is GPT even right?"** That's why we built a correctness layer: we score both models against known correct answers, not just against each other.
- **"Where do correct answers come from in production?"** The checker is our evaluation harness; in production, analysts' corrections are the ground truth, and Mubit's feedback captures them.
- **"Isn't this just distillation?"** Yes: automated per-task distillation, plus human corrections that fix the teacher's mistakes. Mubit removes the plumbing that normally takes an ML team weeks.
- **"Is distilling GPT allowed?"** See section 2.5.
- **"Did you test on the training data?"** No: the holdout set was never sent through Mubit before evaluation, and each question is scored only the first time it's answered.

---

## 14. Background: ideas considered and rejected

- **Banking77 support triage:** safest (ready labels, short prompts, fits Mubit perfectly) but a known benchmark and generic. Kept as the **fallback**: the same pipeline works by swapping the data.
- **Product catalogue categorisation (Rakuten):** strong business story, but categories are anonymised codes needing manual naming; too much prep.
- **GitHub issue triage:** good data story, smaller market, multi-label scoring messier.
- **Raw text-to-SQL (BIRD):** dropped due to long schema prompts (training-length risk) and SQL outputs being hard for Mubit's match grading. Replaced by the spec / semantic-layer design.
