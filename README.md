# MathIQ

Type a math problem. Walk through it. One line at a time.

A guided AI tutor for nine college math courses. Iris — the tutor —
reads your problem, picks the right technique, and walks every move out
loud. Not just the answer.

**Live**: [mathiq.io](https://mathiq.io/)

---

## What it is

Nine courses, 108 topics, four tiers:

- **Anonymous** — 1 walkthrough/day on Haiku 4.5. No sign-up.
- **Free** — 5/day on Haiku 4.5. Email magic link, no password.
- **MathIQ+** ($7.99/mo · $3.99/mo annual · $25.99 semester) — 40/day:
  15 on Opus 4.6, then 25 on Sonnet 4.6. Photo input, why-how on any
  step, 90-day history with PDF export, Handwritten to PDF.
- **MathIQ Pro** ($19.99/mo · $8.99/mo annual · $64.99 semester) — 40
  Opus 4.6 walkthroughs daily, no degradation. LaTeX Mode (Computer
  Modern typeset PDFs), Exam Mode (generated 10–15-problem exams),
  exam grading from a handwritten photo. Everything in Plus.

Every answer is verified by a separate model before the badge says
"verified." Photos of textbook problems get OCR'd to LaTeX and walked
through. The landing page rotates a different ancient-Greek scribe and
tagline by day of week.

---

## How a walkthrough actually works

The streaming endpoint is the heart of the product. Every visible
behavior — daily caps, model selection, the live token stream, the
"verified" badge — comes out of this one request flow.

```
  CLIENT                  WORKER                       UPSTREAM (Claude)
  ──────                  ──────                       ─────────────────
                                                       
  POST /api/walkthrough ─►  ① Clerk JWT verify             
                            ② resolveTier()  ─KV read─►   subscription
                            ③ peek counter   ─DO read─►   today's count
                            ④ decideTier()   → model? Opus / Sonnet / Haiku / null
                            ⑤ inc counter    ─DO write─►  atomic ++
                            ⑥ stream call    ────────────►  Anthropic / OpenRouter
                            ⑦ pipe through normalizeLatexDelimiters
  ◄── SSE text chunks ───   ⑧ on disconnect: abort upstream
                            ⑨ if 5xx: dec counter (refund)
```

Every numbered step lives in `worker/src/`:

1. **Auth** (`auth.ts`) — Clerk JWT verified against the
   publishable-key JWKS. No session storage; tokens are checked per
   request.
2. **Tier resolution** (`tier.ts::resolveTier`) — `MAX_USER_IDS` env
   override (Pro) → `PRO_USER_IDS` env override (Plus) → Stripe
   subscription state in KV → one-time semester pass in KV → free.
3. **Atomic peek** (`rateLimit.ts` → `counterDO.ts`) — each
   `(userId, UTC date)` pair gets its own Durable Object actor. Peek
   is a no-mutation read.
4. **Tier decision** (`tier.ts::decideTier`) — given today's count,
   returns the *model to use for this request*. Plus gets Opus for the
   first 15, Sonnet for the next 25, then 429. Pro gets Opus all 40.
   Free gets Haiku, 5/day.
5. **Atomic increment** — single-threaded DO mutation. Race-proof: two
   concurrent requests that both peek `count=39` will get *different*
   post-increment values back.
6. **Stream dispatch** (`anthropic.ts` / `openrouter.ts`) — system
   prompt + course/topic context + format reinforcer; everything before
   the user message marked `cache_control: ephemeral` so the 5-minute
   prompt cache kicks in.
7. **Inline normalization** (`normalize.ts::normalizeLatexDelimiters`)
   — a `TransformStream` that rewrites `\(…\)` → `$…$` and `\[…\]` →
   `$$…$$` mid-flight. Chunk-safe (holds a trailing backslash across
   chunk boundaries). Without this, Haiku occasionally drifts into the
   wrong delimiter style and KaTeX gives up halfway through a stream.
8. **Abort on disconnect** — when the client cancels (e.g. user
   navigates away), the worker calls `reader.cancel()`, which closes
   the upstream connection and stops the model generating tokens
   nobody will see.
9. **Refund on upstream failure** — if the upstream returns 5xx after
   the counter was already incremented, the worker calls `/dec` on the
   DO so the user isn't charged for an empty stream.

After the response, the client (optionally) calls **`/api/verify`** —
a tiny Sonnet call (≤ 200 tokens) that classifies the answer as
`CORRECT` / `INCORRECT: <reason>` / `UNCLEAR`. Only when it returns
CORRECT does the green badge appear.

---

## The secret sauce — prompt engineering

The model is the engine, but the prompts are the car.

**The foundation prompt is ~19 KB** and is split across **four worker
secrets** (`IRIS_FOUNDATION_PROMPT_1` through `_4`). The split is a
deploy-time convenience: Cloudflare caps a single secret at ~5 KB. They
reassemble at startup into the system prompt that defines Iris — the
tutor's voice, the "Step N." cadence, the algebraic hygiene rules, the
domain-specific heuristics (integration tricks, series convergence
tests, linear-algebra simplifications), and the strict
`$…$` / `$$…$$` LaTeX delimiter contract.

Layered on top of the foundation, just before the user message, sits a
**`FORMAT_REINFORCEMENT` block** (`prompt.ts`) — a short, priority
instruction set that the model reads last and therefore obeys hardest:

- The only acceptable closing is `**Answer:**` then `*Trigger to
  remember:*`. Anything else costs the verified badge.
- No markdown tables. Use LaTeX matrices instead. This stops Sonnet
  from emitting `|column|column|` formats that break inside KaTeX.
- The format reinforcer is the *closest* string to the user message, so
  it wins any conflict with the foundation's softer guidance.

The other tutor prompts compose on top of the same foundation:

| Prompt | When | What it changes |
|---|---|---|
| `WHY_HOW_FALLBACK` | tap any step | "Why we did this" + "How it works" — 2-4 paragraphs, no step replay |
| `PRACTICE_FALLBACK` | tap "Practice" | Generates a *new* problem of the same shape & difficulty |
| `EXAM_SYSTEM_PROMPT` | exam generation | JSON schema only, 70 % routine / 25 % mid / 5 % hard, no hints |
| `CLEANUP_PROMPT` | post-Mathpix OCR | Silent typo fixes; uncertain edits surfaced as inline "did you mean…?" |
| `GRADE_FALLBACK` | exam grading | 0-10 per problem, partial credit, single-clause feedback |
| `CLASSIFIER_SYSTEM_PROMPT` | `/api/classify` | "what *kind* of problem is this?" → `(courseId, topicId)` |

**Each tutor prompt has a fallback in `prompt.ts` and an override via
worker secret.** That lets us iterate on the actual prompts in
production without re-deploying code, while the repo holds a working
version that ships if someone clones it without the secrets.

**Prompt caching.** The classifier's catalog (course list + topic
descriptions) is marked `cache_control: ephemeral`. First call pays
full input cost; subsequent calls within 5 minutes get ~90 % off on
the cached prefix. The walkthrough endpoint does the same with the
foundation + course/topic context block.

---

## How the API calls help each other

The interesting part isn't any single endpoint — it's how a handful of
specialized calls combine to deliver one user-visible feature.

**Photo of a textbook problem → walkthrough.** The user snaps a
picture in the scanner. The client posts to **`/api/ocr`**, which sends
the image to Mathpix for math-aware OCR. Mathpix returns LaTeX-shaped
MMD; that becomes the *problem text* fed into `/api/walkthrough`. The
walkthrough then streams a normal step-by-step solution. Two upstream
APIs cooperating to make "snap and learn" feel like one button.

**Handwritten homework → typed PDF.** The Pro feature shown on the
pricing page goes through three models:

```
   image  ──►  Mathpix OCR  ──►  raw MMD
                                   │
                                   ▼
              Sonnet 4.6 cleanup pass  ──►  cleaned MMD
              (sees image + raw MMD)        + uncertainty flags
                                   │
              user inline-resolves uncertainty
                                   │
                                   ▼
              md→LaTeX transformer  ──►  .tex
                                   │
                                   ▼
              TeXLive.net compile   ──►  PDF (Computer Modern)
```

The cleanup pass is the secret. Mathpix is great at recognizing
strokes but doesn't know that an `=` sign on the third line of an
algebra step is *probably* a `−`. Sonnet — given the original image
*and* the raw MMD — applies confident operator-flip fixes silently and
flags the uncertain ones for the user to resolve. No other OCR-only
tool does the second pass.

**Exam grading.** Same two-pass shape, with a twist:

```
  handwritten attempt  ──►  Mathpix OCR  ──►  raw transcript
                                                  │
                                                  ▼
  original problems + transcript  ──►  Sonnet grader  ──►  JSON
                                       (per-problem 0-10, partial credit)
```

Sonnet sees both the *original generated problems* (so it knows what
the correct answer should be) and the *student's transcribed work*
(so it can give partial credit). The output is a structured JSON the
client renders as a per-problem rubric.

**Why this is fun to look at.** Every multi-call feature is a small
orchestra: a cheap classifier hands off to a streaming generator, a
fast vision model hands off to a deeper reasoner, an answer-generator
hands off to a separate verifier. Each model is doing what it's
cheapest at. No single 300-token mega-prompt tries to do everything.

---

## Where the secrets live

Everything that could be expensive if leaked is set via
`wrangler secret put`. Everything else lives in `worker/wrangler.toml`
where you can read it in the git history.

| Secret | What breaks if missing |
|---|---|
| `ANTHROPIC_API_KEY` | All tutoring features |
| `OPENROUTER_API_KEY` | Fallback provider (DeepSeek) for walkthroughs |
| `CLERK_SECRET_KEY` | All auth (401 every endpoint) |
| `STRIPE_SECRET_KEY` | Billing — checkout & customer portal |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification |
| `MATHPIX_APP_ID` + `MATHPIX_APP_KEY` | OCR (photo input, homework, exam grading) |
| `IRIS_FOUNDATION_PROMPT_{1..4}` | Iris's voice + format rules (falls back to a generic in-repo prompt) |
| `IRIS_WHY_HOW_PROMPT` | The why/how reflection prompt |
| `IRIS_PRACTICE_PROMPT` | The practice-problem prompt |
| `IRIS_GRADE_PROMPT` + `_2` | Exam grading prompt (2-part) |

The Iris prompts are split into multiple secrets because Cloudflare
caps each secret around 5 KB. The worker concatenates them at startup
into a single system message.

Public, committed to `wrangler.toml`:

- `ALLOWED_ORIGINS` — CORS whitelist (mathiq.io + localhost ports for dev)
- `CLERK_PUBLISHABLE_KEY` — designed to be client-visible
- `STRIPE_PRICE_*` — the price IDs; not secret, just version-controlled
- `MAX_USER_IDS` / `PRO_USER_IDS` — comp / dev override list for paid tiers

The split between "secret" and "public" is intentional. API keys, the
webhook-signing secret, and the tutor prompts are secret. Everything
the user could read by inspecting network traffic is in plain
`wrangler.toml`.

---

## Stack

| Layer | What |
|---|---|
| Frontend | React 18 + Vite 5 + TypeScript, deployed on Vercel |
| Worker | Cloudflare Worker (TypeScript) for auth, AI streaming, OCR, history, billing |
| State | Cloudflare KV (subscription, history, idempotency) + Durable Object (atomic rate-limit counters) |
| AI | Anthropic Claude (Opus 4.6 / Sonnet 4.6 / Haiku 4.5) + DeepSeek via OpenRouter (fallback) |
| OCR | Mathpix (math-aware) for handwriting + textbook photo capture |
| LaTeX | TeXLive.net for cloud-side Computer Modern typesetting |
| Auth | Clerk (email magic link, no passwords) |
| Billing | Stripe Checkout + Customer Portal + Webhooks |
| Math rendering | KaTeX + remark-math via react-markdown |
| Fonts | DM Sans + JetBrains Mono |

No global state library. Routes are a discriminated union; the App's
render is an exhaustive switch.

---

## Quickstart (local)

```bash
# Frontend
npm install
npm run dev          # Vite on :5173

# Worker (separate terminal)
cd worker
npm install
npx wrangler dev     # :8787

# Webhook forwarder (third terminal, only when testing billing)
stripe listen --forward-to http://localhost:8787/api/stripe/webhook
```

You'll need `.env` (frontend) and `worker/.dev.vars` (worker). See
`.env.example` and the comments in `worker/wrangler.toml`.

---

## Project structure

```
src/
├─ main.tsx              # mounts <App>, wraps in ClerkProvider
├─ App.tsx               # history-aware navigation + route switch
├─ router.ts             # Route discriminated union
├─ index.css             # tokens, reveal animations, scribe-trigger hover
│
├─ design/
│  └─ tokens.ts          # T.* references CSS vars
│
├─ screens/
│  ├─ Landing.tsx        # home — daily scribe + animated search
│  ├─ Subjects.tsx       # course-picker grid
│  ├─ Topic.tsx          # the main walkthrough surface
│  ├─ Homework.tsx       # handwritten → MMD → optional LaTeX PDF
│  ├─ Exams.tsx          # exam list (Pro)
│  ├─ ExamTake.tsx       # take a generated exam
│  ├─ ExamGrade.tsx      # upload handwritten attempt, see graded result
│  ├─ History.tsx        # past walkthroughs, grouped by day
│  ├─ Settings.tsx       # account, plan, photo upload, pace
│  ├─ Pricing.tsx        # marketing page with the LaTeX before/after demo
│  └─ Terms.tsx / Privacy.tsx
│
├─ scanner/
│  ├─ Scanner.tsx        # camera + library picker, multi-page bundling
│  ├─ index.ts           # imperative openScanner() entry
│  └─ scanToPdf.ts       # multi-page → jsPDF
│
├─ shell/
│  ├─ Header.tsx         # wordmark + back arrow + Settings + Clerk UserButton
│  └─ InstallPrompt.tsx  # beforeinstallprompt + iOS Safari Add-to-Home-Screen hint
│
├─ walkthroughs/
│  ├─ generate.ts        # /api/walkthrough client + RateLimitInfo
│  ├─ classify.ts        # /api/classify
│  ├─ ocr.ts             # /api/ocr
│  ├─ verify.ts          # /api/verify
│  ├─ homework.ts        # /api/homework/*
│  ├─ exam.ts            # /api/exam/*
│  ├─ history.ts         # /api/history/*
│  └─ courses.ts         # 9 courses × 12 topics catalog (source of truth)
│
├─ billing/
│  └─ client.ts          # /api/billing/* fetchers
│
└─ upgrade/
   └─ UpgradePrompt.tsx  # unified upgrade modal for every gated feature

worker/
└─ src/
   ├─ index.ts           # 20 routes + CORS + webhook dispatch
   ├─ auth.ts            # Clerk JWT verification
   ├─ prompt.ts          # tutor system prompts + fallbacks
   ├─ anthropic.ts       # streaming Anthropic call w/ caching + abort
   ├─ openrouter.ts      # streaming OpenRouter (DeepSeek) call
   ├─ normalize.ts       # \( → $ TransformStream for streams
   ├─ tier.ts            # resolveTier + decideTier
   ├─ rateLimit.ts       # DO-backed atomic counter wrapper
   ├─ counterDO.ts       # the UsageCounter Durable Object
   ├─ subscription.ts    # KV CRUD: subs, semester passes, webhook idempotency
   ├─ stripe.ts          # checkout + portal + webhook verification
   ├─ ocr.ts             # /api/ocr (photo problem → MMD)
   ├─ verify.ts          # /api/verify (separate-model answer check)
   ├─ history.ts         # /api/history/* CRUD
   ├─ homework.ts        # Mathpix transcribe + cleanup pipeline
   ├─ latex.ts           # md → tex → TeXLive.net PDF
   ├─ mathpix.ts         # Mathpix sync (images) + async (PDFs)
   ├─ cleanup.ts         # post-Mathpix Sonnet cleanup pass
   └─ exam.ts            # exam generate + grade
```

---

## Architecture notes

**Routes are internal state, with browser history.** Internal
navigation is a `Route` discriminated union held in `useState`, but
every `navigate()` call pushes onto `window.history` so the browser
back button and the iOS PWA edge-swipe both work. `/terms`,
`/privacy`, and `/pricing` are real URLs (App-level pathname check at
boot) so shared links and Stripe redirects land correctly.

**Rate limiting is atomic.** Each `(userId, UTC date)` pair gets a
single-threaded Durable Object. The pattern is:

```
peek → decide → inc → recheck → upstream call → (success: keep | fail: dec)
```

The "recheck after increment" step handles the race where two requests
both peeked at `count = 39`; only one of them will get
`post-inc = 40`.

**Subscription state lives in KV.** Stripe is the system of record; we
mirror just enough for tier resolution (`subscription:user:<userId>`
→ `{tier, interval, status, currentPeriodEnd, stripeCustomerId,
stripeSubscriptionId}`). TTL is `currentPeriodEnd + 7 days` so
canceled subs decay quickly even if the cancel webhook is missed.

**Semester passes are stored separately.** A one-time payment creates
a `pass:user:<userId>` record (`PassState`) with a 4-month expiry
computed by calendar months, not 120 days. Tier resolution checks the
subscription first, then the pass — a user with both gets whichever
is higher.

**Webhook idempotency.** Every processed Stripe event is marked
(`stripe-event:<id>` → 24h TTL). Retries that arrive after the first
delivery are dropped.

**Streaming abort.** The worker forwards `AbortSignal` from the client
all the way into the upstream `fetch`. Closing the browser tab closes
the upstream connection mid-stream — no tokens charged for content
the user never sees.

**Tier resolution order** (`worker/src/tier.ts`):

1. `anonymous` if not signed in
2. `MAX_USER_IDS` env whitelist → `pro`
3. `PRO_USER_IDS` env whitelist → `plus` (dev override)
4. KV subscription state if `active` or `trialing`
5. KV semester pass if not expired
6. `free`

The env whitelists are intentional — they're how comp accounts get
paid-tier access without paying through Stripe.

---

## Deployment

**Worker** (Cloudflare):
```bash
cd worker
npx wrangler kv namespace create USAGE          # one-time
# paste the id into wrangler.toml

npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put CLERK_SECRET_KEY
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put MATHPIX_APP_ID
npx wrangler secret put MATHPIX_APP_KEY
# Iris prompts — 4-part foundation + per-action overrides
npx wrangler secret put IRIS_FOUNDATION_PROMPT_1
npx wrangler secret put IRIS_FOUNDATION_PROMPT_2
npx wrangler secret put IRIS_FOUNDATION_PROMPT_3
npx wrangler secret put IRIS_FOUNDATION_PROMPT_4
npx wrangler secret put IRIS_WHY_HOW_PROMPT
npx wrangler secret put IRIS_PRACTICE_PROMPT
npx wrangler secret put IRIS_GRADE_PROMPT
npx wrangler secret put IRIS_GRADE_PROMPT_2

npx wrangler deploy
# first deploy creates the UsageCounter DO class via the v1 migration
```

**Frontend** (Vercel): connect the repo, set `VITE_WORKER_URL` and
`VITE_CLERK_PUBLISHABLE_KEY` env vars, deploy.

**Stripe**: create products + prices in the dashboard, paste the six
`price_…` IDs into `wrangler.toml`, configure Customer Portal, add a
webhook destination at `<worker-url>/api/stripe/webhook` listening to
`checkout.session.completed` + `customer.subscription.{created,updated,deleted}`.

---

## License

Private. All rights reserved.
