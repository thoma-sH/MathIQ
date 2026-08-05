# MathIQ API reference

The MathIQ backend is a single Cloudflare Worker (`worker/src/index.ts`)
exposing 32 endpoints. There is no REST framework — the fetch handler is a
flat table of `method + pathname` checks, in declaration order, falling
through to `404 {"error":"not found"}`.

This document is the complete reference. For the *why* behind the design,
see the [README](../README.md).

> The API is not public. It exists to serve the MathIQ client, and every
> endpoint is locked to an origin allowlist. This reference is published
> because the request/response contract is the clearest description of how
> the product actually works.

- [Conventions](#conventions)
- [Walkthrough & classify](#walkthrough--classify)
- [Billing & trials](#billing--trials)
- [History](#history)
- [OCR & verify](#ocr--verify)
- [Exams](#exams)
- [Homework](#homework)
- [Daily Challenge, streak & share](#daily-challenge-streak--share)
- [Email](#email)
- [Admin](#admin)
- [Health](#health)

---

## Conventions

### Base URL

```
https://mathiq-api.t-hamilton0416.workers.dev
```

Local development: `http://localhost:8787` (`npx wrangler dev` from `worker/`).

### Origin allowlist

Every request is checked against `ALLOWED_ORIGINS` (a comma-separated list in
`worker/wrangler.toml`) *before* routing. A request whose `Origin` is absent
or unlisted gets `403 forbidden origin` as plain text — no JSON, no CORS
headers.

Four deliberate exemptions:

| Exemption | Why |
|---|---|
| `GET /api/health` | Uptime probes don't send `Origin`. |
| `GET /api/share/*` | Shared links are opened by link-preview bots and direct navigations, neither of which sends `Origin`. |
| `/api/email/unsubscribe` | Clicked from a third-party mail client. |
| `POST /api/stripe/webhook` | Server-to-server. Handled before the CORS block entirely; authenticated by signature instead. |

`OPTIONS` on any path returns `204` with the CORS headers.

### Authentication

A Clerk session JWT in `Authorization: Bearer <token>`, verified server-side by
`@clerk/backend`'s `authenticateRequest` with `authorizedParties` pinned to the
same origin allowlist (`worker/src/auth.ts`).

Verification yields one of three states, and endpoints differ in which they
accept:

| State | Condition | Typical handling |
|---|---|---|
| `user` | Valid token | Full access, subject to tier |
| `anonymous` | **No** `Authorization` header at all | Allowed on a few endpoints at the lowest cap |
| `invalid` | Header present, token bad/expired | Always `401 invalid_token` |

Note the distinction: sending *no* header is anonymous and often fine; sending
a *broken* header is always an error.

### Tiers

Resolved per request by `resolveTier` (`worker/src/tier.ts`), in this order:

1. `anonymous` — not signed in
2. `MAX_USER_IDS` allowlist → `pro`
3. `PRO_USER_IDS` allowlist → `plus`
4. Active Stripe subscription in KV (`active` or `trialing`) → its tier
5. Unexpired semester pass in KV → its tier
6. `free`

An active subscription short-circuits before the pass is ever read — a user
holding both is served by the subscription, regardless of which is higher.

### Rate-limit headers

Returned by `/api/walkthrough` and `/api/homework/latex-pdf` on both success
and `429`. All are listed in `Access-Control-Expose-Headers`, so the browser
client can read them cross-origin.

| Header | Value |
|---|---|
| `X-RateLimit-Limit` | Daily ceiling for the resolved tier |
| `X-RateLimit-Remaining` | `max(0, ceiling − used)` |
| `X-RateLimit-Reset` | Next UTC midnight, ISO 8601 |
| `X-RateLimit-Scope` | `user` or `anonymous` |
| `X-Tier` | `anonymous` \| `free` \| `plus` \| `pro` |
| `X-Premium-Allotment` | Daily Opus allowance (paid tiers only) |
| `X-Model-Used` | Model id that served this request |
| `X-Degraded` | `true` when premium allowance was exhausted and the request fell back to Sonnet |

### Daily ceilings

| Tier | Total/day | Opus/day | Opus/month | Fallback model |
|---|---|---|---|---|
| `anonymous` | 1 | — | — | Haiku 4.5 |
| `free` | 3 | — | — | Haiku 4.5 |
| `plus` | 25 | 5 | 100 | Sonnet 4.6 |
| `pro` | 38 | 8 | 150 | Sonnet 4.6 |

Counters are Durable Objects, one actor per key, so increments are atomic:

```
user:<userId>:<YYYY-MM-DD>                    daily total
anon:<ip>:<YYYY-MM-DD>                        anonymous daily total
user:<userId>:opus:<YYYY-MM>                  monthly Opus ceiling
user:<userId>:exam:<YYYY-MM-DD>               exam generations (cap 2)
user:<userId>:challenge-grade:<YYYY-MM-DD>    daily challenge grade (cap 1)
user:<userId>:challenge-latex:<YYYY-MM-DD>    daily challenge PDF (cap 1)
anon:<ip>:challenge-grade:<YYYY-MM-DD>        anonymous grade (cap 1)
anon:global:challenge-grade:<YYYY-MM-DD>      global anonymous ceiling (cap 500)
```

Every endpoint that claims a slot also refunds it if the upstream call fails.

### Lifetime feature trials

Signed-in `free` users get a one-time allotment of each premium feature so
they can try it before the paywall (`worker/src/trials.ts`). Counts never
reset. `plus`/`pro` bypass trials; `anonymous` cannot hold them.

| Feature | Uses | Gates |
|---|---|---|
| `photoInput` | 3 | `POST /api/ocr` |
| `whyHow` | 5 | `POST /api/walkthrough` with `action: "why-how"` |
| `handwrittenPdf` | 2 | `POST /api/homework/transcribe` |
| `latex` | 1 | `POST /api/homework/latex-pdf` |
| `examGen` | 1 | `POST /api/exam/generate` |
| `examGrade` | 2 | `POST /api/exam/grade` |

A consumed trial is refunded when the upstream call fails.

### Errors

All JSON errors share one envelope. Fields beyond `error` are present only
where meaningful:

```json
{
  "error": "rate_limit",
  "message": "You've used all 25 walkthroughs today.",
  "limit": 25,
  "used": 25,
  "resetAt": "2026-08-06T00:00:00.000Z"
}
```

| Status | `error` | Meaning |
|---|---|---|
| `400` | *varies* | Malformed JSON or a missing/invalid field. The string names the field. |
| `401` | `invalid_token` | `Authorization` present but not verifiable. |
| `401` | `sign_in_required` | Endpoint (or anonymous cap) requires a signed-in user. |
| `402` | `trial_exhausted` | Free user out of lifetime trials for this feature. Carries `feature`. |
| `403` | `upgrade_required` | Signed-in but tier too low. Carries `feature` and `currentTier` where applicable. |
| `403` | `forbidden` | Admin endpoint, caller not in `MAX_USER_IDS`. |
| `404` | *varies* | Unknown course/topic, or a record that expired out of KV. |
| `413` | *varies* | Body over the size guardrail. Carries `limit`. |
| `429` | `rate_limit` | Daily ceiling reached. Carries `limit`, `used`, `resetAt`. |
| `502` | `upstream_error`, `ocr_failed`, `compile_failed`, `grade_failed`, `verify_failed`, `classify_failed` | A third-party call failed. Claimed slots are refunded first. |
| `503` | `service_unavailable` | A required credential is unset, or the global anonymous ceiling is full. |
| `503` | `billing_unavailable` | Stripe price IDs are placeholders. Fails before redirecting the user to a broken Checkout page. |

Upstream error detail is logged worker-side, never returned — clients get a
short human-readable `message` instead.

### Size guardrails

Requests carrying an oversized `content-length` are rejected before
`request.json()` parses the body, so an abusive upload can't hold a worker
open or burn upstream tokens.

| Limit | Value | Applies to |
|---|---|---|
| Problem text | 8 000 chars | `/api/walkthrough` |
| Walkthrough-so-far | 60 000 chars | `/api/walkthrough` (`why-how`) |
| Classifier input | 2 000 chars | `/api/classify` |
| Walkthrough to verify | 30 000 chars | `/api/verify` |
| Saved walkthrough | 80 000 chars | `/api/history/save` |
| Typed challenge answer | 2 000 chars | `/api/challenge/grade` |
| Homework MMD | 200 000 chars | `/api/homework/update` |
| Image (base64) | 8 MiB (~6 MB raw) | `/api/ocr` |
| Image or PDF (base64) | 20 MiB (~15 MB raw) | `/api/exam/grade`, `/api/homework/transcribe`, `/api/challenge/grade` |

Accepted media types: `image/jpeg`, `image/jpg`, `image/png`, `image/webp`,
`image/gif`. The three handwriting endpoints additionally accept
`application/pdf`.

---

## Walkthrough & classify

### `POST /api/walkthrough`

The core endpoint. Streams a step-by-step solution as plain text.

**Auth** optional — `anonymous` allowed at 1/day.
**Tier** all. `action: "why-how"` additionally requires `plus`, or consumes a
`whyHow` trial.

**Request**

```json
{
  "courseId": "calc-2",
  "topicId": "integration-by-parts",
  "problem": "\\int x^2 \\sin(x)\\,dx",
  "action": "walkthrough",
  "walkthroughSoFar": null
}
```

| Field | Type | Notes |
|---|---|---|
| `courseId` | string | Required. Must exist in the catalog. |
| `topicId` | string | Required. Must exist within the course. |
| `problem` | string | Optional — omitted, the topic's canonical example is used. ≤ 8 000 chars. |
| `action` | `"walkthrough"` \| `"why-how"` \| `"practice"` | Defaults to `"walkthrough"`. Anything unrecognized falls back to `"walkthrough"`. |
| `walkthroughSoFar` | string | Context for `why-how`. ≤ 60 000 chars. |

**Response** `200 text/plain; charset=utf-8`

A stream, not a JSON body. Chunks arrive as the model produces them, piped
through `normalizeLatexDelimiters` so `\(…\)` becomes `$…$` and `\[…\]`
becomes `$$…$$` mid-flight.

Response headers include the full rate-limit set plus:

```
cache-control: no-store, no-transform
content-encoding: identity
x-content-type-options: nosniff
```

`no-transform` and `identity` are load-bearing: without them Cloudflare's edge
gzips the response, which buffers chunks and defeats the client's live step
parser.

Closing the connection aborts the upstream call — no tokens are generated for
a stream nobody is reading.

**Errors** `400` invalid JSON · `400 courseId and topicId required` ·
`401 invalid_token` · `401 sign_in_required` (anonymous over cap) ·
`402 trial_exhausted` (`why-how`) · `404 unknown course or topic` ·
`413 problem too long` / `413 context too long` · `429 rate_limit` ·
`502 upstream_error`

**Counters** claims one daily slot; claims one monthly-Opus slot when Opus is
served. If the monthly Opus ceiling is already full, that claim is refunded
and the request is silently downgraded to Sonnet with `X-Degraded: true` — the
user still gets their walkthrough. All claims are refunded on `502`.

---

### `POST /api/classify`

Maps free-text to a `(courseId, topicId)` pair so the user doesn't have to
pick from 108 topics. Sonnet 4.6, `max_tokens: 32`. The catalog in the system
prompt is marked `cache_control: ephemeral`.

**Auth** optional. **Tier** all. **No rate limit** — the call is cheap enough
that metering it costs more than it saves.

**Request**

```json
{ "problem": "how many ways can I deal a full house" }
```

`problem` is required and ≤ 2 000 chars.

**Response** `200`

```json
{ "courseId": "combinatorics", "topicId": "permutations-combinations" }
```

Both fields are `null` when the input isn't a math problem, or when the model
returns a pair that isn't in the catalog. Classification failure is never an
error — the client falls back to the manual course picker.

**Errors** `400` invalid JSON · `400 problem required` · `401 invalid_token` ·
`413 problem too long` · `502 classify_failed`

---

## Billing & trials

### `GET /api/billing/state`

**Auth** required. **Tier** all.

**Response** `200` — subscription:

```json
{
  "tier": "plus",
  "interval": "monthly",
  "status": "active",
  "currentPeriodEnd": 1780000000,
  "manageable": true,
  "accessKind": "subscription"
}
```

Or a semester pass, which cannot be managed through Stripe's portal because
it's a one-time payment:

```json
{
  "tier": "plus",
  "interval": "semester",
  "status": "active",
  "currentPeriodEnd": 1780000000,
  "manageable": false,
  "accessKind": "pass",
  "expiresAt": 1780000000
}
```

`tier` reflects the *effective* tier, so allowlisted comp accounts report their
granted tier even with no Stripe record. `tier` is `null` for free users.

**Errors** `401 sign_in_required`

---

### `POST /api/billing/checkout`

Creates a Stripe Checkout session.

**Auth** required. **Tier** all.

**Request**

```json
{ "tier": "plus", "interval": "monthly" }
```

`tier` ∈ `plus` | `pro`. `interval` ∈ `monthly` | `annual` | `semester`.

`monthly` and `annual` create `mode: "subscription"` sessions; Plus adds a
7-day card-on-file trial (`subscription_data.trial_period_days`). Pro is
excluded — a heavier-spend tier converts without one.

`semester` creates a `mode: "payment"` session. One-time payments can't carry
a trial, and no subscription event follows, so the webhook mints the pass
directly from the completed session.

**Response** `200`

```json
{ "url": "https://checkout.stripe.com/c/pay/cs_live_..." }
```

**Errors** `400` invalid JSON · `400 invalid tier` · `400 invalid interval` ·
`401 sign_in_required` · `500 checkout_failed` ·
`503 billing_unavailable` (price IDs unconfigured — validated per interval, so
an unconfigured semester product doesn't block monthly checkout)

---

### `POST /api/billing/portal`

Creates a Stripe Customer Portal session for changing or cancelling a plan.

**Auth** required. **Tier** any user with a `stripeCustomerId` on file.

**Request** empty body. **Response** `200 { "url": "..." }`.

**Errors** `401 sign_in_required` · `404 no_subscription`

---

### `POST /api/stripe/webhook`

Handled before CORS and before the origin allowlist. Authenticated by
`stripe-signature` against `STRIPE_WEBHOOK_SECRET`; no Clerk token involved.

Events consumed:

| Event | Effect |
|---|---|
| `checkout.session.completed` | Maps the Stripe customer to the Clerk user. For `mode: "payment"`, resolves the price ID to a tier and writes a 4-month `PassState`. Subscription sessions are no-ops here — the subscription event does the work. |
| `customer.subscription.created` / `.updated` | Writes `SubscriptionState` to KV. |
| `customer.subscription.deleted` | Clears the KV record. |

Anything else returns `200` unprocessed.

Every processed event id is recorded with a 24-hour TTL, so Stripe's retries
are dropped as duplicates rather than reapplied.

Price IDs resolve through both the live and the `_OLD` grandfathered slots, so
a renewal webhook for a subscriber on a retired price still maps to their tier
instead of silently downgrading them.

**Responses** `200 ok` · `200 ok (duplicate)` · `400 invalid signature` ·
`500 handler error`

Only the event id and type are logged on failure — never the payload.

---

### `GET /api/trials`

**Auth** required. **Tier** all.

**Response** `200`

```json
{
  "tier": "free",
  "remaining": {
    "photoInput": 3, "whyHow": 5, "handwrittenPdf": 2,
    "latex": 1, "examGen": 1, "examGrade": 2
  }
}
```

Reading trial state does not write to KV — only consuming and refunding do.

**Errors** `401 sign_in_required`

---

## History

Walkthroughs are stored for 90 days under keys that sort chronologically, so
KV's prefix listing returns them in order without a secondary index.

### `POST /api/history/save`

**Auth** required. **Tier** all.

**Request**

```json
{
  "courseId": "calc-2",
  "topicId": "integration-by-parts",
  "problem": "\\int x^2 \\sin(x)\\,dx",
  "walkthrough": "**Step 1.** ...",
  "modelUsed": "claude-opus-4-6"
}
```

`problem` and `modelUsed` are nullable. `walkthrough` is required, ≤ 80 000
chars.

**Response** `200 { "id": "..." }`

**Errors** `400` invalid JSON · `400 courseId, topicId, walkthrough required` ·
`401 sign_in_required` · `404 unknown course or topic` ·
`413 walkthrough too long`

---

### `GET /api/history/list`

**Auth** required. **Tier** all. **Query** `?cursor=<kv-cursor>` (optional).

**Response** `200`

```json
{
  "items": [
    {
      "id": "...",
      "courseId": "calc-2",
      "topicId": "integration-by-parts",
      "topicTitle": "Integration by Parts",
      "problemSnippet": "\\int x^2 \\sin(x)\\,dx",
      "createdAt": 1780000000000
    }
  ],
  "cursor": null
}
```

Page size is capped at 50. `cursor` is `null` when the listing is complete.
Items are sorted newest-first.

**Errors** `401 sign_in_required`

---

### `GET /api/history/get`

**Auth** required. **Query** `?id=<historyId>` (required).

**Response** `200` — the full `HistoryRecord`, including the complete
`walkthrough` text.

**Errors** `400 id required` · `401 sign_in_required` · `404 not_found`

---

### `POST /api/history/delete`

**Auth** required. **Request** `{ "id": "..." }`. **Response** `200 { "ok": true }`.

Deleting a record that doesn't exist is a no-op success.

**Errors** `400` invalid JSON · `400 id required` · `401 sign_in_required`

---

## OCR & verify

### `POST /api/ocr`

Photo of a printed or handwritten problem → problem text with LaTeX. Uses
**Anthropic Sonnet 4.6 vision** (`worker/src/ocr.ts`), not Mathpix — the model
reads the page and emits the problem statement only, no answer and no
commentary. The extracted text then flows into the normal classify →
walkthrough path.

**Auth** optional in form, but effectively required: `anonymous` gets
`401 sign_in_required`.
**Tier** `plus`, or consumes a `photoInput` trial.

**Request**

```json
{ "image": "<base64, no data: prefix>", "mediaType": "image/jpeg" }
```

**Response** `200`

```json
{ "problem": "Evaluate $\\int_0^1 x e^x\\,dx$." }
```

When the image isn't math at all:

```json
{ "problem": null, "notAMathProblem": true }
```

**Errors** `400` invalid JSON · `400 image required` ·
`400 unsupported media type` · `401 invalid_token` · `401 sign_in_required` ·
`402 trial_exhausted` · `413 image too large` / `413 request too large` ·
`502 ocr_failed`

**Counters** none — OCR consumes a trial for free users but never a daily
walkthrough slot. The walkthrough it feeds is metered separately.

---

### `POST /api/verify`

Re-reads a finished walkthrough with a separate model and checks whether the
answer is actually right. Sonnet 4.6, `max_tokens: 200`.

**Auth** optional. **Tier** all — verification is part of the walkthrough
package, and gating it would undercut the trust it exists to build.

**Request**

```json
{ "walkthrough": "**Step 1.** ... **Answer:** $\\frac{\\pi}{4}$" }
```

≤ 30 000 chars. If the text contains no `**Answer:**` marker, the endpoint
short-circuits to `unclear` without spending a call.

**Response** `200`

```json
{ "verdict": "correct", "reason": null }
```

`verdict` ∈ `correct` | `incorrect` | `unclear`. `reason` is a short clause on
`incorrect` (`"off by a sign"`, `"missing constant +C"`), otherwise `null`.
Only `correct` lights the verified badge in the client.

**Errors** `400` invalid JSON · `400 walkthrough required` ·
`401 invalid_token` · `413 walkthrough too long` · `502 verify_failed`

---

## Exams

Pro-tier practice exams. Generation and grading both run on Opus 4.6; records
live 90 days.

### `POST /api/exam/generate`

**Auth** required. **Tier** `pro`, or consumes the single `examGen` trial.
Plus users get `403 upgrade_required`.

**Request**

```json
{ "courseId": "calc-1", "exam": "exam1" }
```

`exam` ∈ `exam1` | `exam2` | `exam3` | `final`.

**Response** `200` — an `ExamRecord`:

```json
{
  "examId": "...",
  "courseId": "calc-1",
  "exam": "exam1",
  "examTitle": "Exam 1",
  "courseTitle": "Calculus 1",
  "problems": [
    { "index": 1, "topicId": "limits", "topicTitle": "Limits", "problemText": "..." }
  ],
  "createdAt": 1780000000000,
  "userId": "user_..."
}
```

**Errors** `400` invalid JSON · `400 courseId required` ·
`400 exam must be one of exam1, exam2, exam3, final` · `400 unknown courseId` ·
`401 invalid_token` · `401 sign_in_required` · `402 trial_exhausted` ·
`403 upgrade_required` · `429 rate_limit` · `502 upstream_error`

**Counters** three, claimed in order — daily slot, exam-generation slot (cap
2/day), monthly Opus — and refunded in reverse on any later failure. The 2/day
exam cap is the real ceiling; a single generation is 10–15 Opus problems, so
without it one user could burn a month of margin overnight.

---

### `POST /api/exam/grade`

Grades a photographed or scanned attempt. Two-pass: **Mathpix** transcribes the
handwriting, then **Opus** grades the transcript against the stored problems.

Separating the passes removes the "model auto-corrects what it sees" failure
mode — Mathpix has no math priors and transcribes exactly what's on the page,
so the grader marks what the student actually wrote.

**Auth** required. **Tier** `pro`, or consumes an `examGrade` trial.

**Request**

```json
{ "examId": "...", "image": "<base64>", "mediaType": "application/pdf" }
```

PDFs route to Mathpix's async `/v3/pdf` endpoint (multi-page); images use the
synchronous `/v3/text`.

**Response** `200` — an `ExamGradeResult`:

```json
{
  "examId": "...",
  "courseId": "calc-1",
  "problems": [
    {
      "index": 1, "topicId": "limits", "topicTitle": "Limits",
      "score": 8, "max": 10, "correct": true,
      "feedback": "Correct limit, but the one-sided check was skipped."
    }
  ],
  "totalScore": 74,
  "totalMax": 100,
  "topicBreakdown": [ { "topicId": "limits", "topicTitle": "Limits", "score": 8, "max": 10 } ],
  "studyRecommendations": ["Review one-sided limits before Exam 2."],
  "gradedAt": 1780000000000
}
```

The result is persisted, so the exam list can show graded state and the student
can revisit the rubric.

**Errors** `400` invalid JSON · `400 examId required` · `400 image required` ·
`400 unsupported media type` · `401 invalid_token` · `401 sign_in_required` ·
`402 trial_exhausted` · `403 upgrade_required` ·
`404 exam_not_found` (expired out of KV) · `413 file too large` ·
`429 rate_limit` · `502 ocr_failed` · `502 upstream_error` ·
`503 service_unavailable` (Mathpix credentials unset)

OCR failures return a message tuned to the cause — unreadable file, blank page,
timeout, unsupported format — rather than one generic string.

**Counters** daily slot + monthly Opus. Not the exam-generation cap; that only
applies to generation.

---

### `GET /api/exam/list`

**Auth** required. **Tier** `pro` strictly — no trial path.
**Query** `?courseId=<id>` (optional filter).

**Response** `200`

```json
{
  "items": [
    {
      "examId": "...", "courseId": "calc-1", "courseTitle": "Calculus 1",
      "examTitle": "Exam 1", "exam": "exam1", "problemCount": 12,
      "createdAt": 1780000000000, "graded": true,
      "totalScore": 74, "totalMax": 100, "gradedAt": 1780000000000
    }
  ]
}
```

The three score fields appear only when `graded` is `true`.

**Errors** `401 sign_in_required` · `403 upgrade_required`

---

### `GET /api/exam/get`

**Auth** required. **Tier** `pro` strictly. **Query** `?examId=<id>` (required).

**Response** `200 { "record": ExamRecord, "grade": ExamGradeResult | null }`

**Errors** `400 examId required` · `401 sign_in_required` ·
`403 upgrade_required` · `404 exam_not_found`

---

## Homework

Handwritten pages → clean MMD → optionally a typeset PDF.

### `POST /api/homework/transcribe`

**Auth** required. **Tier** `plus`, or consumes a `handwrittenPdf` trial.

**Request**

```json
{
  "image": "<base64>",
  "mediaType": "application/pdf",
  "sourceFilename": "pset3.pdf"
}
```

`sourceFilename` is optional and truncated to 120 chars.

Two passes. Mathpix transcribes; then Sonnet 4.6 sees **both the original page
and the raw MMD** and fixes what Mathpix got wrong. Confident fixes are applied
silently; ambiguous ones are returned for the student to resolve inline. If the
cleanup call fails, the raw Mathpix output is returned rather than nothing.

**Response** `200`

```json
{
  "hwId": "...",
  "mmd": "cleaned transcription",
  "uncertain": [
    {
      "id": "u1",
      "original": "=",
      "applied": "-",
      "alternatives": ["=", "+"],
      "context": "3x - 2 = 7",
      "reason": "Stroke is ambiguous between an equals sign and a minus."
    }
  ]
}
```

`uncertain` is `[]` when everything was confident.

**Errors** `400` invalid JSON · `400 image required` ·
`400 unsupported media type` · `401 invalid_token` · `401 sign_in_required` ·
`402 trial_exhausted` · `413 file too large` · `429 rate_limit` ·
`502 ocr_failed` · `503 service_unavailable`

**Counters** one daily slot, claimed *after* Mathpix succeeds so an OCR failure
never costs the student a slot.

---

### `POST /api/homework/latex-pdf`

Compiles a transcription into a Computer Modern PDF.

**Auth** required. **Tier** `pro` on a cache miss, or consumes the single
`latex` trial. **Cache hits are free and ungated.**

**Request**

```json
{ "hwId": "...", "title": "Problem Set 3" }
```

**Response** `200 { "pdfBase64": "..." }`

The cache key is `SHA-256(mmd + title)`, held 7 days. Re-downloading the same
document costs nothing — no model call, no slot, no trial. Editing the
homework changes the MMD, which changes the key, which is a fresh render.

Pipeline: Sonnet 4.6 converts the MMD to publication-quality LaTeX (proper
`enumerate`/`section` environments, preserved math); the hand-rolled
`mmdToTex` + `wrapTexSource` is the fallback if that call fails or returns
malformed output. Either way the `.tex` goes to TeXLive.net to compile.

**Errors** `400` invalid JSON · `400 hwId required` · `401 invalid_token` ·
`401 sign_in_required` · `402 trial_exhausted` · `403 upgrade_required` ·
`404 homework_not_found` · `429 rate_limit` · `502 compile_failed`

`compile_failed` includes the generated `texSource` so the student can compile
locally instead of losing the work.

**Counters** one daily slot — but only when the Claude path ran. A render that
fell back to the hand-rolled converter spent nothing upstream, so it charges
nothing.

---

### `POST /api/homework/update`

Persists an edited transcription (typically after resolving `uncertain` fixes).

**Auth** required. **Tier** `plus` or `pro` strictly — no trial path.

**Request** `{ "hwId": "...", "mmd": "..." }` — `mmd` ≤ 200 000 chars.
**Response** `200 { "ok": true }`. The original TTL is preserved on re-save.

**Errors** `400` invalid JSON · `400 hwId required` · `400 mmd required` ·
`401 sign_in_required` · `403 upgrade_required` · `404 homework_not_found` ·
`413 mmd too large`

---

### `GET /api/homework/list`

**Auth** required. **Tier** `plus` or `pro` strictly.

**Response** `200`

```json
{
  "items": [
    { "hwId": "...", "title": "pset3.pdf", "mediaType": "application/pdf",
      "createdAt": 1780000000000, "mmdLength": 4210 }
  ]
}
```

**Errors** `401 sign_in_required` · `403 upgrade_required`

---

### `GET /api/homework/get`

**Auth** required. **Tier** `plus` or `pro` strictly. **Query** `?hwId=<id>`.

**Response** `200 { "record": HomeworkRecord }`

**Errors** `400 hwId required` · `401 sign_in_required` ·
`403 upgrade_required` · `404 homework_not_found`

---

## Daily Challenge, streak & share

One problem a day for everyone, generated by Opus and graded by Sonnet.
Difficulty follows the day of the week, clamped per course so a Friday
Calculus 3 problem doesn't become a research project.

### `GET /api/challenge/today`

**Auth** none. **Tier** none. Fully public.

**Response** `200`

```json
{
  "date": "2026-08-05",
  "challengeNumber": 142,
  "courseId": "calc-2",
  "courseTitle": "Calculus 2",
  "topicId": "series-convergence",
  "topicTitle": "Series Convergence Tests",
  "difficulty": "mid",
  "problemText": "Determine whether $\\sum_{n=1}^\\infty \\frac{n}{2^n}$ converges."
}
```

`difficulty` ∈ `easy` | `mid` | `hard` | `cumulative`. The canonical answer is
stored server-side and never returned — it would defeat the point.

The record is generated on first request of the day and cached 7 days, so the
first visitor pays the Opus call and everyone after reads KV.

**Errors** `503 challenge_unavailable`

---

### `POST /api/challenge/grade`

**Auth** optional — anonymous grading is supported, with defenses.
**Tier** all. One grade per day either way.

**Request** — exactly one of `studentAnswer` or `image`:

```json
{ "studentAnswer": "converges by the ratio test", "turnstileToken": "..." }
```

```json
{ "image": "<base64>", "mediaType": "image/jpeg", "turnstileToken": "..." }
```

`turnstileToken` is required for anonymous callers when `TURNSTILE_SECRET_KEY`
is configured. Signed-in users never need one.

Anonymous requests pass three gates: Turnstile, a 1/day per-IP counter, and a
500/day global ceiling that caps the blast radius of distributed abuse.

Photos go through Mathpix first; typed answers skip OCR entirely. Grading is
answer-first — a correct final answer earns full marks whether or not any work
is shown.

**Response** `200`

```json
{
  "grade": {
    "correct": true,
    "studentAnswer": "converges",
    "feedback": "Clean ratio-test setup — the limit was evaluated correctly."
  },
  "streak": {
    "current": 7, "longest": 12, "lastSolvedDate": "2026-08-05",
    "freezes": 1, "freezeMonth": "2026-08", "freezeConsumed": false
  },
  "challengeNumber": 142,
  "anonymous": false,
  "shareId": "a3f9c2e1b7d40865"
}
```

`streak` is `null` for anonymous callers — there's no user to track. Everyone
gets a `shareId`.

**Errors** `400` invalid JSON · `400 image or studentAnswer required` ·
`400 choose one` (both sent) · `400 unsupported media type` ·
`400 turnstile_required` · `401 invalid_token` · `403 turnstile_failed` ·
`413 file too large` / `413 typed answer too long` · `429 rate_limit` ·
`502 ocr_failed` · `502 grade_failed` · `503 service_unavailable` (global
anonymous ceiling full, or Mathpix credentials unset)

---

### `POST /api/challenge/latex`

Renders the student's own graded work as a typeset PDF.

**Auth** required. **Tier** all — this one isn't paywalled. 1/day.

**Request** empty body — the day and the attempt are resolved server-side.

**Response** `200 { "pdfBase64": "...", "cached": false }`

The PDF is cached 24 hours; a cached re-download returns `cached: true` and
doesn't consume the daily slot.

**Errors** `401 sign_in_required` · `404 no_attempt` (grade the challenge
first) · `429 rate_limit` · `502 compile_failed` (includes `texSource`)

---

### `GET /api/streak`

**Auth** required. **Tier** all.

**Response** `200` — the `StreakState` shown above.

Rules (`worker/src/streak.ts`): a correct submission extends the streak; an
incorrect one breaks it; missing exactly one day auto-consumes a freeze if
available; missing two or more always breaks it. Freezes refill to 1 at the
start of each UTC month. Same-day resubmission is idempotent — the first
submission wins.

Reading applies the monthly freeze refill so the UI doesn't show a stale count
until the user's next submission.

**Errors** `401 sign_in_required`

---

### `GET /api/share/:shareId`

**Auth** none. **Tier** none. Exempt from the origin allowlist so link-preview
bots and direct navigations work.

`shareId` is 16 random hex chars — 64 bits, unguessable, and derived from
nothing. Share records are **self-contained**: the problem date, the submitted
work, and the grade. No user id is written on the way in or read on the way
out, so an anonymous attempt shares exactly like a signed-in one and the link
identifies nobody.

**Response** `200`

```json
{
  "shareId": "a3f9c2e1b7d40865",
  "date": "2026-08-05",
  "challengeNumber": 142,
  "courseTitle": "Calculus 2",
  "topicTitle": "Series Convergence Tests",
  "difficulty": "mid",
  "problemText": "...",
  "grade": { "correct": true, "studentAnswer": "converges", "feedback": "..." },
  "studentMmd": "the sharer's transcribed work"
}
```

Records expire after 7 days.

**Errors** `404 not_found` (expired or never existed) ·
`503 challenge_unavailable`

Link previews are handled separately: `vercel.json` rewrites `/share/:id` to
`api/share-og/[shareId].ts` when the user agent matches a known crawler, so
social cards render server-side while humans get the SPA.

---

## Email

### `GET|POST /api/email/unsubscribe`

One-click unsubscribe for streak reminders. **Auth** none — the link arrives in
an email, where no session exists. Exempt from the origin allowlist.

**Query** `?t=<token>` — single-use, minted per send and consumed on use.

`GET` returns a styled HTML confirmation page (the pistachio palette, inline
CSS, no assets). `POST` returns a bare `200 ok` — RFC 8058 one-click
unsubscribe, which Gmail and Outlook require to be body-less.

**Errors** `400` — invalid, expired, or already-used token, rendered as the
same HTML page.

---

## Admin

Three endpoints, all requiring a valid Clerk session **and** membership in the
`MAX_USER_IDS` allowlist. A valid token from a non-allowlisted user gets `403`.

### `GET /api/admin/cache-stats`

Daily prompt-cache metrics. The 90% input discount on ephemeral cache hits is
load-bearing for unit economics, so a silent cache regression needs to be
visible.

**Query** `?days=<1..90>` (default 7).

**Response** `200`

```json
{
  "window_days": 7,
  "total": {
    "walkthroughs": 1284, "cache_read": 18400000,
    "cache_creation": 240000, "fresh_input": 620000, "output": 1900000
  },
  "cache_hit_ratio": 0.955,
  "days": [
    {
      "day": "2026-08-05",
      "walkthroughs": 190,
      "cache_read": 2700000, "cache_creation": 32000,
      "fresh_input": 88000, "output": 280000,
      "by_model": {
        "claude-opus-4-6": { "walkthroughs": 40, "cache_read": 900000,
                             "cache_creation": 12000, "fresh_input": 22000,
                             "output": 110000 }
      }
    }
  ]
}
```

`cache_hit_ratio` is `cache_read / (cache_read + cache_creation + fresh_input)`.

Metrics are recorded read-modify-write on one key per UTC day (90-day TTL). KV
has no atomic increment, so concurrent walkthroughs occasionally lose a write.
That's accepted deliberately: the number that matters is the ratio, not an
exact count, and paying for atomicity on instrumentation would be backwards.

**Errors** `401 unauthorized` · `403 forbidden`

---

### `POST /api/admin/run-reminders`

Manually triggers the streak-reminder run that the `0 22 * * *` cron normally
performs, and returns the stats so a dry run is debuggable from a browser.

**Response** `200`

```json
{
  "ok": true, "configured": true,
  "sent": 12, "skipped": 40, "total": 52,
  "skipReasons": {
    "already_solved_today": 31, "streak_already_broken": 6,
    "already_reminded_today": 2, "unsubscribed": 1
  }
}
```

`configured: false` means `RESEND_API_KEY` or `REMINDER_FROM_EMAIL` is unset —
the run skips silently rather than erroring, so an unconfigured environment
doesn't page anyone.

Sends are idempotent per user per day, so a cron retry doesn't double-mail.

**Errors** `401 unauthorized` · `403 forbidden`

---

### `POST /api/admin/reset-daily-counters`

Resets the **calling admin's own** Daily Challenge counters (grade + LaTeX) to
zero and clears today's attempt, so the flow can be re-tested without waiting
for UTC midnight. It cannot touch another user's counters.

**Response** `200 { "ok": true, "gradeReset": 1, "latexReset": 1 }`

**Errors** `401 unauthorized` · `403 forbidden`

---

## Health

### `GET /api/health`

**Auth** none. Exempt from the origin allowlist. **Response** `200 { "ok": true }`.
