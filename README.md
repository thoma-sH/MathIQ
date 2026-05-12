# MathIQ

Type a math problem. Walk through it. One line at a time.

A guided AI tutor for nine college math courses. Iris (the tutor) reads your
problem, picks the right technique, and walks through every move — not just
the answer.

**Live**: [math-iq.vercel.app](https://math-iq.vercel.app/)

---

## What it is

Nine courses, 108 topics, three tiers:

- **Anonymous** — 1 walkthrough/day on DeepSeek V3.
- **Signed in (free)** — 5/day on DeepSeek V3.
- **MathIQ+** ($7.99/mo, $4.99/mo annual) — 20 Opus 4.6 walkthroughs daily,
  then 50 on Sonnet 4.6. "Why & how" step reflection. Image input.
- **MathIQ Pro** ($29.99/mo, $19.99/mo annual) — 70 Opus 4.6 walkthroughs
  daily, no degradation. Everything in Plus.

Every paid walkthrough auto-saves to a 90-day history. Every answer is
verified by a separate model before the badge says "verified." Photos of
textbook problems get extracted to LaTeX and walked through. The landing
page rotates a different ancient-Greek scribe and tagline by day of week.

---

## Stack

| Layer | What |
|---|---|
| Frontend | React 18 + Vite 5 + TypeScript, Vercel |
| Worker | Cloudflare Worker (TypeScript) for auth, AI streaming, OCR, history, billing |
| State | Cloudflare KV (subscription, history, idempotency) + Durable Object (atomic rate-limit counters) |
| AI | Anthropic Claude (Opus 4.6 / Sonnet 4.6 / Haiku) + OpenRouter (DeepSeek V3 for free tier) |
| Auth | Clerk (email magic link, no passwords) |
| Billing | Stripe Checkout + Customer Portal + Webhooks |
| Math | KaTeX + remark-math via react-markdown |
| Fonts | DM Sans + JetBrains Mono |

No global state library. Routes are a discriminated union; render is
exhaustive. Streaming responses use a TransformStream to normalize LaTeX
delimiters mid-flight.

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
├─ App.tsx               # route switch (internal state), /terms /privacy URL handler
├─ router.ts             # Route discriminated union
├─ index.css             # tokens, reveal animations, scribe-trigger hover
│
├─ design/
│  └─ tokens.ts          # T.* references CSS vars
│
├─ screens/
│  ├─ Landing.tsx        # home — daily scribe + animated search
│  ├─ Lessons.tsx        # course-picker grid (was "Home" pre-redesign)
│  ├─ WalkthroughCourse.tsx
│  ├─ Topic.tsx          # the main walkthrough surface
│  ├─ History.tsx        # past walkthroughs, grouped by day
│  ├─ Settings.tsx       # account, photo upload, plan, pace toggle
│  ├─ Terms.tsx          # /terms — real URL via App-level pathname check
│  ├─ Privacy.tsx        # /privacy — same
│  └─ NotFound.tsx
│
├─ shell/
│  ├─ Header.tsx         # wordmark + Settings + Clerk UserButton
│  └─ InstallPrompt.tsx  # beforeinstallprompt listener
│
├─ state/
│  ├─ dailyScribe.ts     # DAY_LABELS, DAY_TAGLINES, DAY_SCRIBES
│  ├─ promptFlow.ts      # walkthrough pace setting (step | all)
│  └─ useTypedString.ts  # type-in animation hook
│
├─ walkthroughs/
│  ├─ generate.ts        # /api/walkthrough client + RateLimitInfo
│  ├─ classify.ts        # /api/classify
│  ├─ ocr.ts             # /api/ocr
│  ├─ verify.ts          # /api/verify
│  ├─ history.ts         # /api/history/*
│  ├─ isProblem.ts       # client-side heuristic for problem vs topic search
│  ├─ courses.ts         # 9 courses × 12 topics catalog (source of truth)
│  └─ types.ts
│
└─ billing/
   └─ client.ts          # /api/billing/* fetchers

worker/
└─ src/
   ├─ index.ts           # routes + handlers + CORS
   ├─ auth.ts            # Clerk JWT verification
   ├─ courses.ts         # mirror of frontend catalog
   ├─ prompt.ts          # TUTORING_FOUNDATION + step / why-how / practice instructions
   ├─ anthropic.ts       # streaming Anthropic call
   ├─ openrouter.ts      # streaming OpenRouter (DeepSeek) call
   ├─ tier.ts            # resolveTier + decideTier
   ├─ rateLimit.ts       # DO-backed atomic counter wrapper
   ├─ counterDO.ts       # the UsageCounter Durable Object
   ├─ subscription.ts    # KV CRUD for subscription state + idempotency
   ├─ stripe.ts          # checkout + portal + webhook verification
   ├─ ocr.ts             # vision call
   ├─ verify.ts          # answer-correctness check
   ├─ history.ts         # walkthrough history CRUD
   └─ normalize.ts       # \( → $ TransformStream
```

---

## Architecture notes

**Two surfaces only.** `home` is the landing (scribe morph + search);
`lessons` is the course picker grid. Everything else lives under one of
those two or inside Settings.

**Routes are internal state.** No client-side URL router. URL stays at `/`
during normal navigation. `/terms` and `/privacy` are the exception —
App-level pathname check at boot, falls through to the SPA otherwise. The
Vercel `vercel.json` rewrite serves `index.html` for any path so this
works.

**Rate limiting is atomic.** Each (user, day) gets a Durable Object
instance. The DO is single-threaded per id, so the peek → upstream call →
commit pattern is race-free. On upstream failure we decrement (refund) so
the user isn't charged.

**Subscription state lives in KV.** Stripe is system of record; we mirror
the bits we need for tier resolution (`subscription:user:<userId>` →
`{tier, interval, status, currentPeriodEnd, stripeCustomerId,
stripeSubscriptionId}`) so request-path tier lookups are one KV read.
TTL is `currentPeriodEnd + 7d` so canceled subscriptions decay quickly
even if the cancel webhook is missed.

**Webhook idempotency.** Every processed Stripe event is marked
(`stripe-event:<id>` → 24h TTL). Retries that arrive after the first
delivery are dropped.

**Walkthrough streaming.** Worker proxies SSE from Anthropic / OpenRouter,
extracts text deltas, pipes through `normalizeLatexDelimiters()` to
convert `\( … \)` → `$ … $` for the markdown renderer, sends plain text
to the client. The client splits on `**Step N.**` boundaries to enable
step-by-step reveal.

**Tier resolution order:**
1. `anonymous` if not signed in
2. `MAX_USER_IDS` env whitelist → `pro`
3. `PRO_USER_IDS` env whitelist → `plus` (dev override)
4. KV subscription state if `active` or `trialing`
5. `free`

The env whitelists are intentional — they're how the dev (or comped
accounts) get paid-tier access without paying through Stripe.

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

npx wrangler deploy
# first deploy creates the UsageCounter DO class via the v1 migration
```

**Frontend** (Vercel): connect the repo, set `VITE_WORKER_URL` and
`VITE_CLERK_PUBLISHABLE_KEY` env vars, deploy.

**Stripe**: create products + prices in the dashboard, paste the four
`price_…` IDs into `wrangler.toml`, configure Customer Portal, add a
webhook destination at `<worker-url>/api/stripe/webhook` listening to
`checkout.session.completed` + `customer.subscription.{created,updated,deleted}`.

---

## License

Private. All rights reserved.
