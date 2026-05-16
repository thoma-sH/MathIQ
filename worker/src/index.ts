/**
 * MathIQ API worker.
 *
 *   POST /api/walkthrough  — auth + tier-aware rate limit + streaming
 *   POST /api/classify     — auth optional, no rate limit (cheap call)
 *   GET  /api/health       — no auth
 */
import { COURSES, COURSES_BY_ID, findTopic } from './courses';
import { authenticate, type AuthState } from './auth';
import {
  anonChallengeGradeCounter,
  anonChallengeGradeGlobalCounter,
  anonymousCounter,
  decrement,
  increment,
  nextMidnightUtc,
  peek,
  userChallengeGradeCounter,
  userChallengeLatexCounter,
  userCounter,
  userExamDailyCounter,
  userOpusMonthlyCounter,
  type CounterRef,
} from './rateLimit';
export { UsageCounter } from './counterDO';
import {
  decideTier,
  monthlyOpusLimit,
  OPUS,
  resolveTier,
  SONNET,
  type ModelKey,
  type Tier,
  type TierDecision,
} from './tier';
import { callAnthropicStream } from './anthropic';
import { callOpenRouterStream } from './openrouter';
import { getIrisPrompts } from './prompt';
import { normalizeLatexDelimiters } from './normalize';
import {
  clearSubscription,
  findUserByCustomer,
  getActivePass,
  getSubscription,
  isEventProcessed,
  markEventProcessed,
  rememberCustomer,
  setPass,
  setSubscription,
  type PassState,
  type SubscriptionInterval,
  type SubscriptionTier,
} from './subscription';
import {
  createCheckoutSession,
  createOneTimeCheckoutSession,
  createPortalSession,
  makeStripe,
  priceIdToTierInterval,
  subscriptionToState,
  verifyWebhook,
} from './stripe';
import {
  deleteHistory,
  getHistory,
  listHistory,
  newHistoryId,
  saveHistory,
  type HistoryRecord,
} from './history';
import { extractProblemFromImage } from './ocr';
import { extractStudentWork, extractStudentWorkFromPdf } from './mathpix';
import { cleanupTranscription, type UncertainFix } from './cleanup';
import {
  saveHomework,
  getHomework,
  updateHomeworkMmd,
  newHomeworkId,
  listHomeworkForUser,
  type HomeworkRecord,
} from './homework';
import { mmdToTex, wrapTexSource, compileLatex, generateLatexFromMmd } from './latex';
import { verifyAnswer } from './verify';
import {
  generateExam,
  getExam,
  getGrade,
  gradeExam,
  listExamsForUser,
  saveGrade,
  type ExamId,
} from './exam';
import {
  challengeNumberFor,
  getAttempt,
  getOrGenerateTodaysChallenge,
  gradeChallengeSubmission,
  saveAttempt,
  todayUtcDateKey,
  type ChallengeRecord,
} from './challenge';
import { getStreak, recordSolve, listActiveStreakers } from './streak';
import {
  consumeUnsubscribeToken,
  isUnsubscribed,
  mintUnsubscribeToken,
  sendReminderEmail,
} from './email';
import {
  consumeTrial,
  getRemainingTrials,
  refundTrial,
  type TrialFeature,
} from './trials';
import { createShare, getShare } from './share';
import type Stripe from 'stripe';

interface Env {
  ANTHROPIC_API_KEY: string;
  OPENROUTER_API_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
  ALLOWED_ORIGINS: string;
  PRO_USER_IDS?: string;
  MAX_USER_IDS?: string;
  USAGE: KVNamespace;
  USAGE_DO: DurableObjectNamespace;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_PLUS_MONTHLY: string;
  STRIPE_PRICE_PLUS_ANNUAL: string;
  STRIPE_PRICE_PRO_MONTHLY: string;
  STRIPE_PRICE_PRO_ANNUAL: string;
  STRIPE_PRICE_PLUS_SEMESTER: string;
  STRIPE_PRICE_PRO_SEMESTER: string;
  STRIPE_PRICE_PLUS_MONTHLY_OLD?: string;
  STRIPE_PRICE_PLUS_ANNUAL_OLD?: string;
  STRIPE_PRICE_PLUS_SEMESTER_OLD?: string;
  STRIPE_PRICE_PRO_MONTHLY_OLD?: string;
  STRIPE_PRICE_PRO_ANNUAL_OLD?: string;
  STRIPE_PRICE_PRO_SEMESTER_OLD?: string;
  STRIPE_SUCCESS_URL: string;
  STRIPE_CANCEL_URL: string;
  STRIPE_PORTAL_RETURN_URL: string;
  IRIS_FOUNDATION_PROMPT_1?: string;
  IRIS_FOUNDATION_PROMPT_2?: string;
  IRIS_FOUNDATION_PROMPT_3?: string;
  IRIS_FOUNDATION_PROMPT_4?: string;
  IRIS_WHY_HOW_PROMPT?: string;
  IRIS_PRACTICE_PROMPT?: string;
  IRIS_GRADE_PROMPT?: string;
  IRIS_GRADE_PROMPT_2?: string;
  // Mathpix OCR — transcribes handwritten exam attempts before Claude grades.
  // Sign up at mathpix.com → Dashboard → API Keys. Free tier: 1k pages/month.
  MATHPIX_APP_ID?: string;
  MATHPIX_APP_KEY?: string;
  // Cloudflare Turnstile secret — required for anonymous Daily Challenge
  // grading. If unset, anonymous grading is allowed without verification
  // (logged as a warning). Set via `wrangler secret put TURNSTILE_SECRET_KEY`
  // once you've created a Turnstile site in the Cloudflare dashboard.
  TURNSTILE_SECRET_KEY?: string;
  // Resend API key for outbound streak-reminder emails. If unset, the
  // scheduled reminder cron skips silently (logs a warning).
  // Set via `wrangler secret put RESEND_API_KEY`.
  RESEND_API_KEY?: string;
  // Verified sender for reminder emails, e.g. "MathIQ <streaks@mathiq.io>".
  // Set as a [vars] entry in wrangler.toml.
  REMINDER_FROM_EMAIL?: string;
  // Public origin used in email links (unsubscribe especially). Defaults to
  // the workers.dev hostname when unset.
  WORKER_PUBLIC_URL?: string;
}

const CLASSIFY_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

// Size guardrails. Anything over these is rejected with 413 so a single
// abusive request can't burn upstream tokens or hang a worker.
const MAX_PROBLEM_CHARS = 8000;       // a generous math problem
const MAX_HISTORY_CHARS = 60000;      // walkthrough-so-far for why/how
const MAX_CLASSIFY_CHARS = 2000;      // classifier input

// Daily Challenge ceilings. Per-user/IP rate limits are 1/day; the global
// ceiling is the backstop against distributed abuse on the anonymous path.
const ANON_CHALLENGE_GRADE_GLOBAL_DAILY_CAP = 500;

interface WalkthroughBody {
  courseId?: string;
  topicId?: string;
  problem?: string;
  action?: 'walkthrough' | 'why-how' | 'practice';
  walkthroughSoFar?: string;
}

interface ClassifyBody {
  problem?: string;
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    // Let the work continue past the handler return so KV writes and email
    // sends don't get truncated by cold-start exit.
    ctx.waitUntil(runStreakReminders(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Webhook from Stripe is server-to-server; no Origin, no CORS.
    if (request.method === 'POST' && url.pathname === '/api/stripe/webhook') {
      return handleStripeWebhook(request, env);
    }

    const origin = request.headers.get('Origin') ?? '';
    const allowed = env.ALLOWED_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    const originAllowed = !!origin && allowed.includes(origin);
    // Some endpoints are public-by-design and must work without an Origin
    // header. iframe loads and direct PDF downloads don't send Origin on
    // GET navigations, so the share endpoints have to be exempt — they're
    // the whole point of shareable links. Email-link clicks (unsubscribe)
    // come from third-party mail clients with no Origin either.
    const publicEndpoint =
      url.pathname === '/api/health' ||
      url.pathname === '/api/email/unsubscribe' ||
      (request.method === 'GET' && url.pathname.startsWith('/api/share/'));
    if (!originAllowed && !publicEndpoint) {
      return new Response('forbidden origin', { status: 403 });
    }

    const cors: Record<string, string> = originAllowed
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
          'Access-Control-Allow-Headers': 'content-type, authorization',
          'Access-Control-Expose-Headers':
            'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-RateLimit-Scope, X-Tier, X-Model-Used, X-Degraded, X-Premium-Allotment',
          Vary: 'Origin',
        }
      : { Vary: 'Origin' };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json({ ok: true }, 200, cors);
    }

    if (request.method === 'POST' && url.pathname === '/api/walkthrough') {
      return handleWalkthrough(request, env, cors);
    }

    if (request.method === 'POST' && url.pathname === '/api/classify') {
      return handleClassify(request, env, cors);
    }

    if (request.method === 'GET' && url.pathname === '/api/billing/state') {
      return handleBillingState(request, env, cors);
    }

    if (request.method === 'GET' && url.pathname === '/api/trials') {
      return handleTrialsGet(request, env, cors);
    }

    if (request.method === 'POST' && url.pathname === '/api/billing/checkout') {
      return handleBillingCheckout(request, env, cors);
    }

    if (request.method === 'POST' && url.pathname === '/api/billing/portal') {
      return handleBillingPortal(request, env, cors);
    }

    if (request.method === 'GET' && url.pathname === '/api/history/list') {
      return handleHistoryList(request, env, cors);
    }

    if (request.method === 'GET' && url.pathname === '/api/history/get') {
      return handleHistoryGet(request, env, cors);
    }

    if (request.method === 'POST' && url.pathname === '/api/history/save') {
      return handleHistorySave(request, env, cors);
    }

    if (request.method === 'POST' && url.pathname === '/api/history/delete') {
      return handleHistoryDelete(request, env, cors);
    }

    if (request.method === 'POST' && url.pathname === '/api/ocr') {
      return handleOcr(request, env, cors);
    }

    if (request.method === 'POST' && url.pathname === '/api/verify') {
      return handleVerify(request, env, cors);
    }

    if (request.method === 'POST' && url.pathname === '/api/exam/generate') {
      return handleExamGenerate(request, env, cors);
    }

    if (request.method === 'POST' && url.pathname === '/api/exam/grade') {
      return handleExamGrade(request, env, cors);
    }

    if (request.method === 'GET' && url.pathname === '/api/exam/list') {
      return handleExamList(request, env, cors);
    }

    if (request.method === 'GET' && url.pathname === '/api/exam/get') {
      return handleExamGet(request, env, cors);
    }

    if (request.method === 'GET' && url.pathname === '/api/challenge/today') {
      return handleChallengeToday(request, env, cors);
    }

    if (request.method === 'POST' && url.pathname === '/api/challenge/grade') {
      return handleChallengeGrade(request, env, cors);
    }

    if (request.method === 'POST' && url.pathname === '/api/challenge/latex') {
      return handleChallengeLatex(request, env, cors);
    }

    if (request.method === 'GET' && url.pathname === '/api/streak') {
      return handleStreak(request, env, cors);
    }

    // Shareable Daily Challenge attempts — public, no auth. Path is
    // /api/share/:shareId or /api/share/:shareId/pdf.
    if (request.method === 'GET' && url.pathname.startsWith('/api/share/')) {
      const rest = url.pathname.slice('/api/share/'.length);
      if (rest.endsWith('/pdf')) {
        return handleSharePdf(request, env, cors, rest.slice(0, -'/pdf'.length));
      }
      return handleShareGet(request, env, cors, rest);
    }

    if (
      url.pathname === '/api/email/unsubscribe' &&
      (request.method === 'GET' || request.method === 'POST')
    ) {
      return handleUnsubscribe(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/run-reminders') {
      return handleAdminRunReminders(request, env, cors);
    }

    if (request.method === 'POST' && url.pathname === '/api/homework/transcribe') {
      return handleHomeworkTranscribe(request, env, cors);
    }

    if (request.method === 'POST' && url.pathname === '/api/homework/latex-pdf') {
      return handleHomeworkLatexPdf(request, env, cors);
    }

    if (request.method === 'POST' && url.pathname === '/api/homework/update') {
      return handleHomeworkUpdate(request, env, cors);
    }

    if (request.method === 'GET' && url.pathname === '/api/homework/list') {
      return handleHomeworkList(request, env, cors);
    }

    if (request.method === 'GET' && url.pathname === '/api/homework/get') {
      return handleHomeworkGet(request, env, cors);
    }

    return json({ error: 'not found' }, 404, cors);
  },
};

async function handleWalkthrough(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const authState = await authenticate(request, env);
  if (authState.kind === 'invalid') {
    return json(
      { error: 'invalid_token', message: authState.message },
      401,
      cors,
    );
  }

  const tier: Tier = await resolveTier(authState, env);

  // Gate Why/How to paid tiers — Free signed-in can spend one of their
  // lifetime whyHow trials to taste the feature.
  let parsedBody: WalkthroughBody | null = null;
  try {
    parsedBody = (await request.clone().json()) as WalkthroughBody;
  } catch {
    // We'll re-parse below and surface the error there.
  }
  let whyHowAccess: AccessResult | null = null;
  if (parsedBody?.action === 'why-how') {
    whyHowAccess = await ensureFeatureAccess(env, authState, tier, 'whyHow', 'plus', cors);
    if (!whyHowAccess.ok) return whyHowAccess.response;
  }
  const counter: CounterRef =
    authState.kind === 'user'
      ? userCounter(env.USAGE_DO, authState.userId)
      : anonymousCounter(
          env.USAGE_DO,
          request.headers.get('CF-Connecting-IP') ?? 'unknown',
        );

  // Monthly Opus is the cost ceiling that sits on top of the daily caps.
  // Only signed-in users carry one — anonymous/free never reach Opus, so the
  // counter is moot for them and we skip the round trip.
  const opusMonthly: CounterRef | null =
    authState.kind === 'user'
      ? userOpusMonthlyCounter(env.USAGE_DO, authState.userId)
      : null;

  const [usedToday, opusUsedMonth] = await Promise.all([
    peek(counter),
    opusMonthly ? peek(opusMonthly) : Promise.resolve(0),
  ]);
  const decision: TierDecision = decideTier(tier, usedToday, opusUsedMonth);

  const baseHeaders = buildRateLimitHeaders(tier, usedToday, decision);

  // Over the ceiling — 429 (signed-in) or 401 (anonymous, prompt to sign in)
  if (decision.model === null) {
    if (tier === 'anonymous') {
      return json(
        {
          error: 'sign_in_required',
          message: `You've used your free walkthrough. Sign in for 5/day.`,
          limit: decision.ceiling,
          used: usedToday,
          resetAt: nextMidnightUtc(),
        },
        401,
        { ...cors, ...baseHeaders },
      );
    }
    return json(
      {
        error: 'rate_limit',
        message: `You've used all ${decision.ceiling} walkthroughs today.`,
        limit: decision.ceiling,
        used: usedToday,
        resetAt: nextMidnightUtc(),
      },
      429,
      { ...cors, ...baseHeaders },
    );
  }

  let body: WalkthroughBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400, { ...cors, ...baseHeaders });
  }

  const { courseId, topicId, problem, action, walkthroughSoFar } = body;
  if (typeof problem === 'string' && problem.length > MAX_PROBLEM_CHARS) {
    return json(
      { error: 'problem too long', limit: MAX_PROBLEM_CHARS },
      413,
      { ...cors, ...baseHeaders },
    );
  }
  if (typeof walkthroughSoFar === 'string' && walkthroughSoFar.length > MAX_HISTORY_CHARS) {
    return json(
      { error: 'context too long', limit: MAX_HISTORY_CHARS },
      413,
      { ...cors, ...baseHeaders },
    );
  }
  const walkAction: 'walkthrough' | 'why-how' | 'practice' =
    action === 'why-how' ? 'why-how' : action === 'practice' ? 'practice' : 'walkthrough';
  const walkthroughSoFarClean =
    typeof walkthroughSoFar === 'string' ? walkthroughSoFar : undefined;
  if (!courseId || !topicId) {
    return json(
      { error: 'courseId and topicId required' },
      400,
      { ...cors, ...baseHeaders },
    );
  }

  const found = findTopic(courseId, topicId);
  if (!found) {
    return json(
      { error: 'unknown course or topic' },
      404,
      { ...cors, ...baseHeaders },
    );
  }
  const { course, topic } = found;

  // Atomic increment — claims this slot in the user's daily quota.
  // The DO is single-threaded per id, so concurrent requests can't both
  // commit the same value.
  const newCount = await increment(counter);
  const usedBefore = newCount - 1;
  let finalDecision: TierDecision = decideTier(tier, usedBefore, opusUsedMonth);

  // Race-lost case: another request from this user landed first and pushed us
  // over the ceiling. Refund the increment and 429.
  if (finalDecision.model === null) {
    await decrement(counter);
    return json(
      {
        error: 'rate_limit',
        message: `You've used all ${finalDecision.ceiling} walkthroughs today.`,
        limit: finalDecision.ceiling,
        used: newCount,
        resetAt: nextMidnightUtc(),
      },
      429,
      { ...cors, ...buildRateLimitHeaders(tier, newCount, finalDecision) },
    );
  }

  // finalDecision.model is non-null here (early-return above handled null).
  // Capture into a local `let` so the monthly-Opus downgrade can reassign
  // without TS losing the type narrowing.
  let model: ModelKey = finalDecision.model;
  let degraded = finalDecision.degraded;

  // If we're about to serve Opus, atomically claim a monthly-Opus slot too.
  // Post-increment > cap means another Opus request grabbed the last slot
  // first — refund THIS one and downgrade it to Sonnet for the rest of the
  // month. The daily slot still counts (the user got a walkthrough, just on
  // the fallback model).
  let monthlyOpusInc = false;
  if (model.id === OPUS.id && opusMonthly) {
    const newOpusMonth = await increment(opusMonthly);
    if (newOpusMonth > monthlyOpusLimit(tier)) {
      await decrement(opusMonthly);
      model = SONNET;
      degraded = true;
    } else {
      monthlyOpusInc = true;
    }
  }

  // Provider dispatch
  const prompts = getIrisPrompts(env);
  const upstream =
    model.provider === 'anthropic'
      ? await callAnthropicStream({
          apiKey: env.ANTHROPIC_API_KEY,
          model: model.id,
          prompts,
          course,
          topic,
          problem,
          action: walkAction,
          walkthroughSoFar: walkthroughSoFarClean,
          signal: request.signal,
        })
      : await callOpenRouterStream({
          apiKey: env.OPENROUTER_API_KEY,
          model: model.id,
          prompts,
          course,
          topic,
          problem,
          action: walkAction,
          walkthroughSoFar: walkthroughSoFarClean,
          signal: request.signal,
        });

  if (!upstream.ok || !upstream.body) {
    if (upstream.detail) console.error('upstream walkthrough failed', upstream.status, upstream.detail);
    // Upstream failed — refund daily slot, monthly Opus, and the why-how
    // trial (if any) so the user isn't charged for it.
    await decrement(counter);
    if (monthlyOpusInc && opusMonthly) await decrement(opusMonthly);
    if (whyHowAccess) await refundAccess(env, authState, whyHowAccess);
    return json(
      { error: 'upstream_error', message: 'The walkthrough service is having trouble — try again in a moment.' },
      502,
      { ...cors, ...baseHeaders },
    );
  }

  // Re-build rate-limit headers reflecting the post-increment count.
  const postHeaders = buildRateLimitHeaders(tier, newCount, finalDecision);

  return new Response(upstream.body.pipeThrough(normalizeLatexDelimiters()), {
    status: 200,
    headers: {
      ...cors,
      ...postHeaders,
      'X-Model-Used': model.id,
      'X-Degraded': degraded ? 'true' : 'false',
      'content-type': 'text/plain; charset=utf-8',
      // `no-transform` tells Cloudflare's edge not to gzip the response, which
      // would otherwise buffer streamed tokens before flushing. We *need* the
      // browser to see each chunk as it lands so the step parser can split.
      'cache-control': 'no-store, no-transform',
      'content-encoding': 'identity',
      'x-content-type-options': 'nosniff',
    },
  });
}

async function handleClassify(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const authState: AuthState = await authenticate(request, env);
  if (authState.kind === 'invalid') {
    return json(
      { error: 'invalid_token', message: authState.message },
      401,
      cors,
    );
  }

  let body: ClassifyBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400, cors);
  }

  const { problem } = body;
  if (!problem?.trim()) {
    return json({ error: 'problem required' }, 400, cors);
  }
  if (problem.length > MAX_CLASSIFY_CHARS) {
    return json({ error: 'problem too long', limit: MAX_CLASSIFY_CHARS }, 413, cors);
  }

  const upstream = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: CLASSIFY_MODEL,
      max_tokens: 32,
      // Static catalog is cached via ephemeral cache_control — after the
      // first request in a 5-min window subsequent calls pay ~10% input.
      system: [
        {
          type: 'text',
          text: CLASSIFIER_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: `Problem:\n${problem}` }],
    }),
  });

  if (!upstream.ok) {
    console.error('classify upstream failed', upstream.status);
    return json(
      { error: 'classify_failed' },
      502,
      cors,
    );
  }

  const data = (await upstream.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };

  const text =
    (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
      .trim() || '';

  if (!text || text === 'none') {
    return json({ courseId: null, topicId: null }, 200, cors);
  }

  // Expect "courseId.topicId" format. Anything else → null.
  const dot = text.indexOf('.');
  if (dot < 1 || dot === text.length - 1) {
    return json({ courseId: null, topicId: null }, 200, cors);
  }
  const courseId = text.slice(0, dot);
  const topicId = text.slice(dot + 1);
  const course = COURSES_BY_ID[courseId];
  if (!course) {
    return json({ courseId: null, topicId: null }, 200, cors);
  }
  const valid = course.topics.some((t) => t.id === topicId);
  return json(
    valid ? { courseId, topicId } : { courseId: null, topicId: null },
    200,
    cors,
  );
}

const CLASSIFIER_SYSTEM_PROMPT = buildClassifierPrompt();

function buildClassifierPrompt(): string {
  const lines: string[] = [];
  lines.push(
    'You classify a math problem into the single best (course, topic) pair from the catalog below.',
    '',
    'The problem may be informal, colloquial, or framed as a real-world scenario — poker hands, dice rolls, mixing tanks, population growth, voting, lottery odds, geometric layouts, "how many ways," "what\'s the probability," etc. Recognize the underlying mathematical technique the problem demands, then pick the topic that teaches it. A counting question is combinatorics. A probability-of-arrangement question is combinatorics. A growth-or-decay model is differential equations. A "how fast is X changing" question is related rates. Map informal language to the right technique.',
    '',
    'Reply with EXACTLY the pair as `courseId.topicId` (e.g. `combinatorics.permutations-combinations`). No prose, no quotes, no punctuation around it.',
    '',
    'Reply `none` ONLY if the input is genuinely not a math problem (a greeting, gibberish, a question about the app, etc.). When in doubt between two topics, pick the one whose technique most directly produces the answer. Never reply `none` to bail out of an informal but legitimate math question.',
    '',
    'Catalog:',
  );
  for (const course of COURSES) {
    for (const topic of course.topics) {
      lines.push(`- ${course.id}.${topic.id}: ${course.title} — ${topic.title}. ${topic.blurb}`);
    }
  }
  return lines.join('\n');
}

function buildRateLimitHeaders(
  tier: Tier,
  used: number,
  decision: TierDecision,
): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(decision.ceiling),
    'X-RateLimit-Remaining': String(Math.max(0, decision.ceiling - used)),
    'X-RateLimit-Reset': nextMidnightUtc(),
    'X-RateLimit-Scope': tier === 'anonymous' ? 'anonymous' : 'user',
    'X-Tier': tier,
    ...(decision.premiumAllotment !== undefined
      ? { 'X-Premium-Allotment': String(decision.premiumAllotment) }
      : {}),
  };
}

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json; charset=utf-8' },
  });
}

// ─── Billing handlers ──────────────────────────────────────────────────

async function handleBillingState(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const authState = await authenticate(request, env);
  if (authState.kind !== 'user') {
    return json({ error: 'sign_in_required' }, 401, cors);
  }
  // Effective tier includes the MAX_USER_IDS / PRO_USER_IDS whitelists,
  // not just Stripe state — so dev-granted Pro/Plus accounts are reflected.
  const effectiveTier = await resolveTier(authState, env);
  const state = await getSubscription(env.USAGE, authState.userId);
  const pass = state ? null : await getActivePass(env.USAGE, authState.userId);

  if (pass) {
    return json(
      {
        tier: pass.tier,
        interval: 'semester' as const,
        status: 'active' as const,
        currentPeriodEnd: pass.expiresAt,
        manageable: false,
        accessKind: 'pass' as const,
        expiresAt: pass.expiresAt,
      },
      200,
      cors,
    );
  }

  return json(
    {
      tier: effectiveTier === 'plus' || effectiveTier === 'pro' ? effectiveTier : null,
      interval: state?.interval ?? null,
      status: state?.status ?? null,
      currentPeriodEnd: state?.currentPeriodEnd ?? null,
      manageable: !!state?.stripeCustomerId,
      accessKind: state ? ('subscription' as const) : undefined,
    },
    200,
    cors,
  );
}

interface CheckoutBody {
  tier?: SubscriptionTier;
  interval?: SubscriptionInterval;
}

async function handleBillingCheckout(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const authState = await authenticate(request, env);
  if (authState.kind !== 'user') {
    return json({ error: 'sign_in_required' }, 401, cors);
  }

  let body: CheckoutBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400, cors);
  }
  if (body.tier !== 'plus' && body.tier !== 'pro') {
    return json({ error: 'invalid tier' }, 400, cors);
  }
  if (body.interval !== 'monthly' && body.interval !== 'annual' && body.interval !== 'semester') {
    return json({ error: 'invalid interval' }, 400, cors);
  }

  // Refuse to start a Checkout session if the corresponding price id is a
  // placeholder. Better to fail loudly here than to send the user to Stripe
  // and have them see an invalid-price page.
  const priceConfigErr = validatePriceConfig(env, body.interval);
  if (priceConfigErr) {
    console.error('billing misconfigured:', priceConfigErr);
    return json({ error: 'billing_unavailable' }, 503, cors);
  }

  const stripe = makeStripe(env);
  const existing = await getSubscription(env.USAGE, authState.userId);

  // Pull email from Clerk if we don't already have a Stripe customer for this user.
  let userEmail: string | undefined;
  if (!existing?.stripeCustomerId) {
    userEmail = await fetchClerkUserEmail(env, authState.userId);
  }

  const args = {
    userId: authState.userId,
    userEmail,
    tier: body.tier,
    interval: body.interval,
    existingCustomerId: existing?.stripeCustomerId,
  };

  // Semester is a one-time payment (Stripe `mode: 'payment'`), not a
  // subscription — different Checkout endpoint, different webhook path.
  const session =
    body.interval === 'semester'
      ? await createOneTimeCheckoutSession(stripe, env, args)
      : await createCheckoutSession(stripe, env, args);

  if (!session.url) {
    return json({ error: 'checkout_failed' }, 500, cors);
  }
  return json({ url: session.url }, 200, cors);
}

async function handleBillingPortal(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const authState = await authenticate(request, env);
  if (authState.kind !== 'user') {
    return json({ error: 'sign_in_required' }, 401, cors);
  }
  const state = await getSubscription(env.USAGE, authState.userId);
  if (!state?.stripeCustomerId) {
    return json({ error: 'no_subscription' }, 404, cors);
  }
  const stripe = makeStripe(env);
  const session = await createPortalSession(stripe, env, state.stripeCustomerId);
  return json({ url: session.url }, 200, cors);
}

async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
  const raw = await request.text();
  const stripe = makeStripe(env);
  const event = await verifyWebhook(stripe, env, raw, request.headers.get('stripe-signature'));
  if (!event) {
    return new Response('invalid signature', { status: 400 });
  }

  // Idempotency: Stripe retries deliver the same event id; skip if we've
  // already processed it within the dedup window.
  if (await isEventProcessed(env.USAGE, event.id)) {
    return new Response('ok (duplicate)', { status: 200 });
  }

  try {
    await processStripeEvent(env, stripe, event);
    await markEventProcessed(env.USAGE, event.id);
    return new Response('ok', { status: 200 });
  } catch (err) {
    // Log only the event id + type, never the payload or the raw error.
    console.error('stripe webhook handler error', event.id, event.type);
    void err;
    return new Response('handler error', { status: 500 });
  }
}

async function processStripeEvent(
  env: Env,
  stripe: Stripe,
  event: Stripe.Event,
): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (!session.id) return;
      const userId = session.client_reference_id ?? session.metadata?.userId;
      const customerId =
        typeof session.customer === 'string' ? session.customer : session.customer?.id;
      if (!userId || !customerId) return;
      await rememberCustomer(env.USAGE, customerId, userId);

      // Subscription path: `customer.subscription.created` will follow and
      // do the heavy lifting. Nothing more to do here.
      if (session.mode !== 'payment') return;

      // One-time Semester pass — no follow-up subscription event will fire.
      // Resolve tier + create PassState now.
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
        limit: 1,
      });
      const priceId = lineItems.data[0]?.price?.id;
      if (!priceId) {
        console.error('checkout payment session missing price', session.id);
        return;
      }
      const mapping = priceIdToTierInterval(env, priceId);
      if (!mapping || mapping.interval !== 'semester') {
        console.error('unexpected price for payment session', priceId, session.id);
        return;
      }
      const purchasedAt = Math.floor(Date.now() / 1000);
      const expiresAt = addCalendarMonths(purchasedAt, 4);
      const pass: PassState = {
        kind: 'pass',
        tier: mapping.tier,
        purchasedAt,
        expiresAt,
        priceId,
        stripeCustomerId: customerId,
        stripeCheckoutSessionId: session.id,
      };
      await setPass(env.USAGE, userId, pass);
      return;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      if (!sub.id || !sub.customer) return;
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
      const userId =
        sub.metadata?.userId ?? (await findUserByCustomer(env.USAGE, customerId));
      if (!userId) return;
      await rememberCustomer(env.USAGE, customerId, userId);
      const state = subscriptionToState(env, sub);
      if (state) await setSubscription(env.USAGE, userId, state);
      return;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      if (!sub.id || !sub.customer) return;
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
      const userId =
        sub.metadata?.userId ?? (await findUserByCustomer(env.USAGE, customerId));
      if (!userId) return;
      await clearSubscription(env.USAGE, userId);
      return;
    }
    default:
      return;
  }
}

// ─── History handlers ──────────────────────────────────────────────────

const MAX_HISTORY_WALKTHROUGH_CHARS = 80000;

interface HistorySaveBody {
  courseId?: string;
  topicId?: string;
  problem?: string | null;
  walkthrough?: string;
  modelUsed?: string | null;
}

async function handleHistorySave(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const authState = await authenticate(request, env);
  if (authState.kind !== 'user') {
    return json({ error: 'sign_in_required' }, 401, cors);
  }
  let body: HistorySaveBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400, cors);
  }
  if (!body.courseId || !body.topicId || typeof body.walkthrough !== 'string') {
    return json({ error: 'courseId, topicId, walkthrough required' }, 400, cors);
  }
  if (body.walkthrough.length > MAX_HISTORY_WALKTHROUGH_CHARS) {
    return json(
      { error: 'walkthrough too long', limit: MAX_HISTORY_WALKTHROUGH_CHARS },
      413,
      cors,
    );
  }
  const found = findTopic(body.courseId, body.topicId);
  if (!found) {
    return json({ error: 'unknown course or topic' }, 404, cors);
  }
  const record: HistoryRecord = {
    id: newHistoryId(),
    userId: authState.userId,
    courseId: body.courseId,
    topicId: body.topicId,
    topicTitle: found.topic.title,
    problem: body.problem ?? null,
    walkthrough: body.walkthrough,
    modelUsed: body.modelUsed ?? null,
    createdAt: Date.now(),
  };
  await saveHistory(env.USAGE, record);
  return json({ id: record.id }, 200, cors);
}

async function handleHistoryList(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const authState = await authenticate(request, env);
  if (authState.kind !== 'user') {
    return json({ error: 'sign_in_required' }, 401, cors);
  }
  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const result = await listHistory(env.USAGE, authState.userId, cursor);
  return json(result, 200, cors);
}

async function handleHistoryGet(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const authState = await authenticate(request, env);
  if (authState.kind !== 'user') {
    return json({ error: 'sign_in_required' }, 401, cors);
  }
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id required' }, 400, cors);
  const record = await getHistory(env.USAGE, authState.userId, id);
  if (!record) return json({ error: 'not_found' }, 404, cors);
  return json(record, 200, cors);
}

interface HistoryDeleteBody {
  id?: string;
}

async function handleHistoryDelete(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const authState = await authenticate(request, env);
  if (authState.kind !== 'user') {
    return json({ error: 'sign_in_required' }, 401, cors);
  }
  let body: HistoryDeleteBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400, cors);
  }
  if (!body.id) return json({ error: 'id required' }, 400, cors);
  await deleteHistory(env.USAGE, authState.userId, body.id);
  return json({ ok: true }, 200, cors);
}

// ─── OCR handler ──────────────────────────────────────────────────────

const MAX_OCR_BASE64_CHARS = 8 * 1024 * 1024;       // ~6MB raw image
const ALLOWED_OCR_MEDIA = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
]);
/** Exam grading accepts everything OCR does PLUS multi-page PDFs.
 *  PDFs route through Mathpix's /v3/pdf endpoint (async + per-page billing). */
const ALLOWED_GRADE_MEDIA = new Set([
  ...ALLOWED_OCR_MEDIA,
  'application/pdf',
]);
const MAX_GRADE_BASE64_CHARS = 20 * 1024 * 1024;    // ~15MB raw — PDFs run larger

// Content-length ceilings used to 413 oversized uploads before request.json()
// parses the body. The +4 KiB covers JSON wrapper overhead.
const MAX_OCR_BODY_BYTES = MAX_OCR_BASE64_CHARS + 4096;
const MAX_GRADE_BODY_BYTES = MAX_GRADE_BASE64_CHARS + 4096;

function assertContentLength(
  request: Request,
  max: number,
  cors: Record<string, string>,
): Response | null {
  const cl = Number(request.headers.get('content-length') ?? 0);
  if (cl > max) return json({ error: 'request too large', limit: max }, 413, cors);
  return null;
}

interface OcrBody {
  image?: string;
  mediaType?: string;
}

async function handleOcr(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const tooLarge = assertContentLength(request, MAX_OCR_BODY_BYTES, cors);
  if (tooLarge) return tooLarge;
  const authState = await authenticate(request, env);
  if (authState.kind === 'invalid') {
    return json({ error: 'invalid_token', message: authState.message }, 401, cors);
  }
  const tier: Tier = await resolveTier(authState, env);

  let body: OcrBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400, cors);
  }
  if (!body.image || typeof body.image !== 'string') {
    return json({ error: 'image required' }, 400, cors);
  }
  if (!body.mediaType || !ALLOWED_OCR_MEDIA.has(body.mediaType)) {
    return json({ error: 'unsupported media type' }, 400, cors);
  }
  if (body.image.length > MAX_OCR_BASE64_CHARS) {
    return json({ error: 'image too large', limit: MAX_OCR_BASE64_CHARS }, 413, cors);
  }

  const access = await ensureFeatureAccess(env, authState, tier, 'photoInput', 'plus', cors);
  if (!access.ok) return access.response;

  const result = await extractProblemFromImage({
    apiKey: env.ANTHROPIC_API_KEY,
    imageBase64: body.image,
    mediaType: body.mediaType,
  });

  if (!result.ok) {
    await refundAccess(env, authState, access);
    console.error('ocr upstream failed', result.status, result.detail);
    return json({ error: 'ocr_failed' }, 502, cors);
  }
  if (result.notAMathProblem) {
    return json({ problem: null, notAMathProblem: true }, 200, cors);
  }
  return json({ problem: result.problem }, 200, cors);
}

// ─── Verify handler ──────────────────────────────────────────────────

const MAX_VERIFY_CHARS = 30000;

interface VerifyBody {
  walkthrough?: string;
}

async function handleVerify(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const authState = await authenticate(request, env);
  // Allow anonymous + free + paid — verification is part of the walkthrough
  // package; gating it would hurt trust.
  if (authState.kind === 'invalid') {
    return json({ error: 'invalid_token', message: authState.message }, 401, cors);
  }

  let body: VerifyBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400, cors);
  }
  if (!body.walkthrough || typeof body.walkthrough !== 'string') {
    return json({ error: 'walkthrough required' }, 400, cors);
  }
  if (body.walkthrough.length > MAX_VERIFY_CHARS) {
    return json({ error: 'walkthrough too long', limit: MAX_VERIFY_CHARS }, 413, cors);
  }
  if (!/\*\*Answer:\*\*/i.test(body.walkthrough)) {
    return json({ verdict: 'unclear', reason: 'no answer block' }, 200, cors);
  }

  const result = await verifyAnswer({
    apiKey: env.ANTHROPIC_API_KEY,
    walkthrough: body.walkthrough,
  });

  if (!result.ok) {
    console.error('verify upstream failed', result.status);
    return json({ error: 'verify_failed' }, 502, cors);
  }
  return json({ verdict: result.verdict ?? 'unclear', reason: result.reason ?? null }, 200, cors);
}

interface ExamGenerateBody {
  courseId?: string;
  exam?: ExamId;
}

async function handleExamGenerate(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const authState = await authenticate(request, env);
  if (authState.kind === 'invalid') {
    return json({ error: 'invalid_token', message: authState.message }, 401, cors);
  }
  if (authState.kind !== 'user') {
    return json(
      { error: 'sign_in_required', message: 'Exam mode requires a MathIQ Pro account.' },
      401,
      cors,
    );
  }

  const tier = await resolveTier(authState, env);
  const examGenAccess = await ensureFeatureAccess(env, authState, tier, 'examGen', 'pro', cors);
  if (!examGenAccess.ok) return examGenAccess.response;

  let body: ExamGenerateBody;
  try {
    body = await request.json();
  } catch {
    if (examGenAccess.trialConsumed) await refundAccess(env, authState, examGenAccess);
    return json({ error: 'invalid JSON body' }, 400, cors);
  }
  if (!body.courseId || typeof body.courseId !== 'string') {
    if (examGenAccess.trialConsumed) await refundAccess(env, authState, examGenAccess);
    return json({ error: 'courseId required' }, 400, cors);
  }
  if (
    body.exam !== 'exam1' &&
    body.exam !== 'exam2' &&
    body.exam !== 'exam3' &&
    body.exam !== 'final'
  ) {
    if (examGenAccess.trialConsumed) await refundAccess(env, authState, examGenAccess);
    return json({ error: 'exam must be one of exam1, exam2, exam3, final' }, 400, cors);
  }

  const course = COURSES_BY_ID[body.courseId];
  if (!course) {
    if (examGenAccess.trialConsumed) await refundAccess(env, authState, examGenAccess);
    return json({ error: 'unknown courseId' }, 400, cors);
  }

  // Exam Mode has three counters:
  //   1. examCounter   — per-day cap on exam generations (EXAM_DAILY_CAP = 2)
  //   2. counter       — the shared daily walkthrough/feature slot
  //   3. opusMonthly   — the monthly Opus ceiling (exam always uses Opus)
  // The 2/day cap is the real ceiling; daily and monthly are belt-and-suspenders.
  const examCounter = userExamDailyCounter(env.USAGE_DO, authState.userId);
  const counter = userCounter(env.USAGE_DO, authState.userId);
  const opusMonthly = userOpusMonthlyCounter(env.USAGE_DO, authState.userId);

  const [examUsedToday, usedToday] = await Promise.all([
    peek(examCounter),
    peek(counter),
  ]);

  if (examUsedToday >= EXAM_DAILY_CAP) {
    if (examGenAccess.trialConsumed) await refundAccess(env, authState, examGenAccess);
    return json(
      {
        error: 'rate_limit',
        message: `You've generated ${EXAM_DAILY_CAP} exams today. Try again tomorrow.`,
        limit: EXAM_DAILY_CAP,
        used: examUsedToday,
        resetAt: nextMidnightUtc(),
      },
      429,
      cors,
    );
  }

  const decision = decideTier(tier, usedToday);
  if (decision.model === null) {
    if (examGenAccess.trialConsumed) await refundAccess(env, authState, examGenAccess);
    return json(
      {
        error: 'rate_limit',
        message: `You've used all ${decision.ceiling} Pro slots today.`,
        limit: decision.ceiling,
        used: usedToday,
        resetAt: nextMidnightUtc(),
      },
      429,
      cors,
    );
  }

  // Atomic claims. Order: daily slot → exam slot → monthly Opus. Refund in
  // reverse order on any post-check failure.
  const newCount = await increment(counter);
  const postDailyDecision = decideTier(tier, newCount - 1);
  if (postDailyDecision.model === null) {
    await decrement(counter);
    if (examGenAccess.trialConsumed) await refundAccess(env, authState, examGenAccess);
    return json(
      { error: 'rate_limit', message: `You've used all ${decision.ceiling} Pro slots today.`, resetAt: nextMidnightUtc() },
      429,
      cors,
    );
  }

  const newExamCount = await increment(examCounter);
  if (newExamCount > EXAM_DAILY_CAP) {
    await decrement(examCounter);
    await decrement(counter);
    if (examGenAccess.trialConsumed) await refundAccess(env, authState, examGenAccess);
    return json(
      {
        error: 'rate_limit',
        message: `You've generated ${EXAM_DAILY_CAP} exams today. Try again tomorrow.`,
        limit: EXAM_DAILY_CAP,
        used: newExamCount,
        resetAt: nextMidnightUtc(),
      },
      429,
      cors,
    );
  }

  await increment(opusMonthly);

  const result = await generateExam(
    {
      apiKey: env.ANTHROPIC_API_KEY,
      course,
      exam: body.exam,
      userId: authState.userId,
    },
    env.USAGE,
  );

  if (!result.ok || !result.record) {
    // Refund all four slots on upstream failure (daily, exam, monthly Opus, trial).
    await decrement(opusMonthly);
    await decrement(examCounter);
    await decrement(counter);
    if (examGenAccess.trialConsumed) await refundAccess(env, authState, examGenAccess);
    if (result.detail) console.error('exam generate failed', result.status, result.detail);
    return json(
      { error: 'upstream_error', message: 'Exam generation failed — try again in a moment.' },
      502,
      cors,
    );
  }

  return json(result.record, 200, cors);
}

const EXAM_DAILY_CAP = 2;

interface ExamGradeBody {
  examId?: string;
  image?: string;
  mediaType?: string;
}

async function handleExamGrade(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const tooLarge = assertContentLength(request, MAX_GRADE_BODY_BYTES, cors);
  if (tooLarge) return tooLarge;
  const authState = await authenticate(request, env);
  if (authState.kind === 'invalid') {
    return json({ error: 'invalid_token', message: authState.message }, 401, cors);
  }
  if (authState.kind !== 'user') {
    return json({ error: 'sign_in_required' }, 401, cors);
  }

  const tier = await resolveTier(authState, env);
  const examGradeAccess = await ensureFeatureAccess(env, authState, tier, 'examGrade', 'pro', cors);
  if (!examGradeAccess.ok) return examGradeAccess.response;

  let body: ExamGradeBody;
  try {
    body = await request.json();
  } catch {
    if (examGradeAccess.trialConsumed) await refundAccess(env, authState, examGradeAccess);
    return json({ error: 'invalid JSON body' }, 400, cors);
  }
  if (!body.examId || typeof body.examId !== 'string') {
    if (examGradeAccess.trialConsumed) await refundAccess(env, authState, examGradeAccess);
    return json({ error: 'examId required' }, 400, cors);
  }
  if (!body.image || typeof body.image !== 'string') {
    if (examGradeAccess.trialConsumed) await refundAccess(env, authState, examGradeAccess);
    return json({ error: 'image required' }, 400, cors);
  }
  if (!body.mediaType || !ALLOWED_GRADE_MEDIA.has(body.mediaType)) {
    if (examGradeAccess.trialConsumed) await refundAccess(env, authState, examGradeAccess);
    return json({ error: 'unsupported media type' }, 400, cors);
  }
  if (body.image.length > MAX_GRADE_BASE64_CHARS) {
    if (examGradeAccess.trialConsumed) await refundAccess(env, authState, examGradeAccess);
    return json({ error: 'file too large', limit: MAX_GRADE_BASE64_CHARS }, 413, cors);
  }

  const record = await getExam(env.USAGE, authState.userId, body.examId);
  if (!record) {
    if (examGradeAccess.trialConsumed) await refundAccess(env, authState, examGradeAccess);
    return json(
      {
        error: 'exam_not_found',
        message: 'That exam has expired or was never generated. Generate a new one.',
      },
      404,
      cors,
    );
  }

  // Grading uses Opus (same as generate). Counts against the daily walkthrough
  // slot AND the monthly Opus ceiling, but not the exam-per-day cap — that's
  // only on generation.
  const counter = userCounter(env.USAGE_DO, authState.userId);
  const opusMonthly = userOpusMonthlyCounter(env.USAGE_DO, authState.userId);
  const usedToday = await peek(counter);
  const decision = decideTier(tier, usedToday);
  if (decision.model === null) {
    if (examGradeAccess.trialConsumed) await refundAccess(env, authState, examGradeAccess);
    return json(
      {
        error: 'rate_limit',
        message: `You've used all ${decision.ceiling} Pro slots today.`,
        limit: decision.ceiling,
        used: usedToday,
        resetAt: nextMidnightUtc(),
      },
      429,
      cors,
    );
  }

  // Mathpix OCR pre-pass. Separating OCR from grading eliminates the
  // "Claude auto-corrects what it sees" failure mode — Mathpix has no
  // math priors and transcribes exactly what's on the page, then Claude
  // grades the transcribed text instead of looking at the photo.
  if (!env.MATHPIX_APP_ID || !env.MATHPIX_APP_KEY) {
    if (examGradeAccess.trialConsumed) await refundAccess(env, authState, examGradeAccess);
    console.error('[exam-grade] Mathpix credentials missing');
    return json(
      { error: 'service_unavailable', message: 'Exam grading is temporarily unavailable. Try again shortly.' },
      503,
      cors,
    );
  }

  // PDFs go through Mathpix's async /v3/pdf endpoint (multi-page, no
  // dimension cap). Single images go through /v3/text (synchronous, faster).
  const ocr =
    body.mediaType === 'application/pdf'
      ? await extractStudentWorkFromPdf({
          appId: env.MATHPIX_APP_ID,
          appKey: env.MATHPIX_APP_KEY,
          pdfBase64: body.image,
        })
      : await extractStudentWork({
          appId: env.MATHPIX_APP_ID,
          appKey: env.MATHPIX_APP_KEY,
          imageBase64: body.image,
          mediaType: body.mediaType,
        });
  if (!ocr.ok || !ocr.text) {
    if (examGradeAccess.trialConsumed) await refundAccess(env, authState, examGradeAccess);
    console.error('[exam-grade] Mathpix failed', ocr.status, ocr.detail);
    const detailLower = (ocr.detail ?? '').toLowerCase();
    const isPdf = body.mediaType === 'application/pdf';
    const noun = isPdf ? 'PDF' : 'photo';
    const message =
      ocr.status === 401
        ? 'Exam grading is temporarily unavailable. Try again shortly.'
        : ocr.status === 504
          ? `Your ${noun} took too long to transcribe. Try a shorter attempt or split it across two uploads.`
          : detailLower.includes('content not found') || detailLower.includes('no content')
            ? `Couldn't find any work in the ${noun}. Make sure your handwriting is visible and the file isn't blank.`
            : detailLower.includes('decode') || detailLower.includes('not supported')
              ? `That file format could not be read. Upload a PDF or a PNG/JPEG image.`
              : `Could not read the ${noun}. Try a clearer, better-lit scan with the whole page visible.`;
    return json({ error: 'ocr_failed', message }, 502, cors);
  }

  await increment(counter);
  await increment(opusMonthly);

  const prompts = getIrisPrompts(env);
  const result = await gradeExam({
    apiKey: env.ANTHROPIC_API_KEY,
    gradePrompt: prompts.grade,
    record,
    studentWorkText: ocr.text,
    ocrConfidence: ocr.confidence,
  });

  if (!result.ok || !result.result) {
    await decrement(opusMonthly);
    await decrement(counter);
    if (examGradeAccess.trialConsumed) await refundAccess(env, authState, examGradeAccess);
    if (result.detail) console.error('exam grade failed', result.status, result.detail);
    const message =
      result.detail && result.detail.startsWith('Grader hallucinated')
        ? result.detail
        : 'Grading failed — try again in a moment.';
    return json({ error: 'upstream_error', message }, 502, cors);
  }

  // Persist the grade so the user can revisit results later (and so the
  // exam list endpoint can show graded state).
  await saveGrade(env.USAGE, authState.userId, result.result);

  return json(result.result, 200, cors);
}

async function handleExamList(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const authState = await authenticate(request, env);
  if (authState.kind !== 'user') {
    return json({ error: 'sign_in_required' }, 401, cors);
  }
  const tier = await resolveTier(authState, env);
  if (tier !== 'pro') {
    return json({ error: 'upgrade_required' }, 403, cors);
  }
  const url = new URL(request.url);
  const courseId = url.searchParams.get('courseId') ?? undefined;
  const items = await listExamsForUser(env.USAGE, authState.userId, courseId);
  return json({ items }, 200, cors);
}

async function handleExamGet(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const authState = await authenticate(request, env);
  if (authState.kind !== 'user') {
    return json({ error: 'sign_in_required' }, 401, cors);
  }
  const tier = await resolveTier(authState, env);
  if (tier !== 'pro') {
    return json({ error: 'upgrade_required' }, 403, cors);
  }
  const url = new URL(request.url);
  const examId = url.searchParams.get('examId');
  if (!examId) {
    return json({ error: 'examId required' }, 400, cors);
  }
  const record = await getExam(env.USAGE, authState.userId, examId);
  if (!record) {
    return json({ error: 'exam_not_found' }, 404, cors);
  }
  const grade = await getGrade(env.USAGE, authState.userId, examId);
  return json({ record, grade }, 200, cors);
}

// ─── Homework Helper ──────────────────────────────────────────────────────

interface HomeworkTranscribeBody {
  image?: string;
  mediaType?: string;
  sourceFilename?: string;
}

async function handleHomeworkTranscribe(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const tooLarge = assertContentLength(request, MAX_GRADE_BODY_BYTES, cors);
  if (tooLarge) return tooLarge;
  const authState = await authenticate(request, env);
  if (authState.kind === 'invalid') {
    return json({ error: 'invalid_token', message: authState.message }, 401, cors);
  }
  if (authState.kind !== 'user') {
    return json({ error: 'sign_in_required' }, 401, cors);
  }

  const tier = await resolveTier(authState, env);
  const transcribeAccess = await ensureFeatureAccess(env, authState, tier, 'handwrittenPdf', 'plus', cors);
  if (!transcribeAccess.ok) return transcribeAccess.response;

  let body: HomeworkTranscribeBody;
  try {
    body = await request.json();
  } catch {
    if (transcribeAccess.trialConsumed) await refundAccess(env, authState, transcribeAccess);
    return json({ error: 'invalid JSON body' }, 400, cors);
  }
  if (!body.image || typeof body.image !== 'string') {
    if (transcribeAccess.trialConsumed) await refundAccess(env, authState, transcribeAccess);
    return json({ error: 'image required' }, 400, cors);
  }
  if (!body.mediaType || !ALLOWED_GRADE_MEDIA.has(body.mediaType)) {
    if (transcribeAccess.trialConsumed) await refundAccess(env, authState, transcribeAccess);
    return json({ error: 'unsupported media type' }, 400, cors);
  }
  if (body.image.length > MAX_GRADE_BASE64_CHARS) {
    if (transcribeAccess.trialConsumed) await refundAccess(env, authState, transcribeAccess);
    return json({ error: 'file too large', limit: MAX_GRADE_BASE64_CHARS }, 413, cors);
  }

  // Counts as one walkthrough slot. Increment after Mathpix succeeds so OCR
  // failures don't burn the user's slot.
  const counter = userCounter(env.USAGE_DO, authState.userId);
  const usedToday = await peek(counter);
  const decision = decideTier(tier, usedToday);
  if (decision.model === null) {
    if (transcribeAccess.trialConsumed) await refundAccess(env, authState, transcribeAccess);
    return json(
      {
        error: 'rate_limit',
        message: `You've used all ${decision.ceiling} slots today.`,
        limit: decision.ceiling,
        used: usedToday,
        resetAt: nextMidnightUtc(),
      },
      429,
      cors,
    );
  }

  if (!env.MATHPIX_APP_ID || !env.MATHPIX_APP_KEY) {
    if (transcribeAccess.trialConsumed) await refundAccess(env, authState, transcribeAccess);
    console.error('[homework-transcribe] Mathpix credentials missing');
    return json(
      { error: 'service_unavailable', message: 'Homework transcription is temporarily unavailable. Try again shortly.' },
      503,
      cors,
    );
  }

  const ocr =
    body.mediaType === 'application/pdf'
      ? await extractStudentWorkFromPdf({
          appId: env.MATHPIX_APP_ID,
          appKey: env.MATHPIX_APP_KEY,
          pdfBase64: body.image,
        })
      : await extractStudentWork({
          appId: env.MATHPIX_APP_ID,
          appKey: env.MATHPIX_APP_KEY,
          imageBase64: body.image,
          mediaType: body.mediaType,
        });
  if (!ocr.ok || !ocr.text) {
    if (transcribeAccess.trialConsumed) await refundAccess(env, authState, transcribeAccess);
    console.error('[homework-transcribe] Mathpix failed', ocr.status, ocr.detail);
    const detailLower = (ocr.detail ?? '').toLowerCase();
    const isPdf = body.mediaType === 'application/pdf';
    const noun = isPdf ? 'PDF' : 'photo';
    const message =
      ocr.status === 401
        ? 'Homework transcription is temporarily unavailable. Try again shortly.'
        : ocr.status === 504
          ? `Your ${noun} took too long to transcribe. Try a shorter file or split it across two uploads.`
          : detailLower.includes('content not found') || detailLower.includes('no content')
            ? `Couldn't find any work in the ${noun}. Make sure your handwriting is visible and the file isn't blank.`
            : detailLower.includes('decode') || detailLower.includes('not supported')
              ? `That file format could not be read. Upload a PDF or a PNG/JPEG image.`
              : `Could not read the ${noun}. Try a clearer, better-lit scan with the whole page visible.`;
    return json({ error: 'ocr_failed', message }, 502, cors);
  }

  await increment(counter);

  // Cleanup pass — Claude sees the original page + raw Mathpix output,
  // returns the cleaned transcription plus an `uncertain` list of fixes
  // that need human verification. Confident fixes are applied silently.
  // Falls back to raw Mathpix output on any failure so a transient
  // Anthropic blip doesn't kill the whole transcription.
  let finalText = ocr.text;
  let uncertain: UncertainFix[] = [];
  const cleanup = await cleanupTranscription({
    apiKey: env.ANTHROPIC_API_KEY,
    mediaType: body.mediaType,
    sourceBase64: body.image,
    rawMmd: ocr.text,
  });
  if (cleanup.ok && cleanup.cleaned) {
    finalText = cleanup.cleaned;
    uncertain = cleanup.uncertain ?? [];
  } else if (cleanup.detail) {
    console.error('[homework-cleanup] fell back to raw mathpix:', cleanup.detail);
  }

  const record: HomeworkRecord = {
    hwId: newHomeworkId(),
    userId: authState.userId,
    mmd: finalText,
    mediaType: body.mediaType,
    sourceFilename:
      typeof body.sourceFilename === 'string' ? body.sourceFilename.slice(0, 120) : undefined,
    createdAt: Date.now(),
  };
  await saveHomework(env.USAGE, record);

  return json({ hwId: record.hwId, mmd: record.mmd, uncertain }, 200, cors);
}

interface HomeworkUpdateBody {
  hwId?: string;
  mmd?: string;
}

async function handleHomeworkUpdate(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const authState = await authenticate(request, env);
  if (authState.kind !== 'user') {
    return json({ error: 'sign_in_required' }, 401, cors);
  }
  const tier = await resolveTier(authState, env);
  if (tier !== 'plus' && tier !== 'pro') {
    return json({ error: 'upgrade_required' }, 403, cors);
  }

  let body: HomeworkUpdateBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400, cors);
  }
  if (!body.hwId || typeof body.hwId !== 'string') {
    return json({ error: 'hwId required' }, 400, cors);
  }
  if (typeof body.mmd !== 'string') {
    return json({ error: 'mmd required' }, 400, cors);
  }
  // Same KV-friendly size guard the transcription itself respects.
  if (body.mmd.length > 200_000) {
    return json({ error: 'mmd too large' }, 413, cors);
  }

  const ok = await updateHomeworkMmd(env.USAGE, authState.userId, body.hwId, body.mmd);
  if (!ok) {
    return json({ error: 'homework_not_found' }, 404, cors);
  }
  return json({ ok: true }, 200, cors);
}

async function handleHomeworkList(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const authState = await authenticate(request, env);
  if (authState.kind !== 'user') {
    return json({ error: 'sign_in_required' }, 401, cors);
  }
  const tier = await resolveTier(authState, env);
  if (tier !== 'plus' && tier !== 'pro') {
    return json({ error: 'upgrade_required' }, 403, cors);
  }
  const items = await listHomeworkForUser(env.USAGE, authState.userId);
  return json({ items }, 200, cors);
}

async function handleHomeworkGet(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const authState = await authenticate(request, env);
  if (authState.kind !== 'user') {
    return json({ error: 'sign_in_required' }, 401, cors);
  }
  const tier = await resolveTier(authState, env);
  if (tier !== 'plus' && tier !== 'pro') {
    return json({ error: 'upgrade_required' }, 403, cors);
  }
  const url = new URL(request.url);
  const hwId = url.searchParams.get('hwId');
  if (!hwId) {
    return json({ error: 'hwId required' }, 400, cors);
  }
  const record = await getHomework(env.USAGE, authState.userId, hwId);
  if (!record) {
    return json({ error: 'homework_not_found' }, 404, cors);
  }
  return json({ record }, 200, cors);
}

interface HomeworkLatexBody {
  hwId?: string;
  title?: string;
}

async function handleHomeworkLatexPdf(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const authState = await authenticate(request, env);
  if (authState.kind === 'invalid') {
    return json({ error: 'invalid_token', message: authState.message }, 401, cors);
  }
  if (authState.kind !== 'user') {
    return json({ error: 'sign_in_required' }, 401, cors);
  }

  const tier = await resolveTier(authState, env);

  let body: HomeworkLatexBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400, cors);
  }
  if (!body.hwId || typeof body.hwId !== 'string') {
    return json({ error: 'hwId required' }, 400, cors);
  }

  const record = await getHomework(env.USAGE, authState.userId, body.hwId);
  if (!record) {
    return json(
      {
        error: 'homework_not_found',
        message: "That homework transcription has expired or wasn't found. Upload it again.",
      },
      404,
      cors,
    );
  }

  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : undefined;

  // Cache keyed by hashed (mmd + title). Identical re-renders are free
  // (no Claude call, no slot charged, no trial consumed). Editing the
  // homework changes the mmd → cache miss → fresh call → fresh slot.
  const cacheKey = await latexCacheKey(record.mmd, title);
  const cacheKvKey = `latex:user:${authState.userId}:${body.hwId}:${cacheKey}`;
  const cached = await env.USAGE.get(cacheKvKey);
  if (cached) {
    return json({ pdfBase64: cached }, 200, cors);
  }

  // Cache miss — gate on Pro tier or consume a lifetime LaTeX trial.
  const latexAccess = await ensureFeatureAccess(env, authState, tier, 'latex', 'pro', cors);
  if (!latexAccess.ok) return latexAccess.response;

  // First render for this (hwId, mmd, title) — counts as 1 Pro slot.
  const counter = userCounter(env.USAGE_DO, authState.userId);
  const usedToday = await peek(counter);
  const decision = decideTier(tier, usedToday);
  if (decision.model === null) {
    if (latexAccess.trialConsumed) await refundAccess(env, authState, latexAccess);
    return json(
      {
        error: 'rate_limit',
        message: `You've used all ${decision.ceiling} Pro slots today.`,
        limit: decision.ceiling,
        used: usedToday,
        resetAt: nextMidnightUtc(),
      },
      429,
      { ...cors, ...buildRateLimitHeaders(tier, usedToday, decision) },
    );
  }

  // Compile the .mmd → .tex → PDF.
  //
  // Primary path: ask Claude to convert the cleaned .mmd to publication-
  // quality LaTeX. This produces proper enumerate/section environments,
  // preserved math, and overall "human typeset it" structure.
  //
  // Fallback path: the hand-rolled mmdToTex + wrapTexSource if Claude's
  // call fails or returns malformed output. Less polished but reliable.
  let tex: string;
  let claudeSucceeded = false;
  const latexGen = await generateLatexFromMmd({
    apiKey: env.ANTHROPIC_API_KEY,
    mmd: record.mmd,
    title,
  });
  if (latexGen.ok && latexGen.tex) {
    tex = latexGen.tex;
    claudeSucceeded = true;
  } else {
    if (latexGen.detail) {
      console.error('[homework-latex] Claude generation failed, falling back to mmdToTex:', latexGen.detail);
    }
    const texBody = mmdToTex(record.mmd);
    tex = wrapTexSource(texBody, { title });
  }

  const result = await compileLatex(tex);

  if (!result.ok || !result.pdfBase64) {
    if (latexAccess.trialConsumed) await refundAccess(env, authState, latexAccess);
    console.error('[homework-latex] compile failed', result.status, (result.detail ?? '').slice(0, 400));
    return json(
      {
        error: 'compile_failed',
        message: 'The LaTeX compile service is having trouble. Download the .tex source below and compile locally, or try again in a few minutes.',
        texSource: tex,
      },
      502,
      cors,
    );
  }

  // Only charge a slot when Claude actually ran. Fallback path used the
  // hand-rolled converter — no Anthropic spend, so no slot charged.
  let postCount = usedToday;
  let postDecision = decision;
  if (claudeSucceeded) {
    postCount = await increment(counter);
    postDecision = decideTier(tier, postCount);
    // 7-day TTL — long enough that a student revisiting their homework
    // later in the week still gets a free re-render.
    await env.USAGE.put(cacheKvKey, result.pdfBase64, { expirationTtl: 7 * 24 * 60 * 60 });
  }

  return json(
    { pdfBase64: result.pdfBase64 },
    200,
    { ...cors, ...buildRateLimitHeaders(tier, postCount, postDecision) },
  );
}

async function latexCacheKey(mmd: string, title: string | undefined): Promise<string> {
  const enc = new TextEncoder().encode(`${mmd} ${title ?? ''}`);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Add N calendar months to a unix timestamp (seconds), anchored on UTC so
 * the result is consistent regardless of where the worker instance runs.
 * If the source day-of-month doesn't exist in the target month (e.g. Aug 31
 * + 6 months → Feb 31), JS's Date constructor rolls forward — Mar 3 in a
 * common year. That's customer-favorable, which is the right default here.
 */
function addCalendarMonths(unixSeconds: number, months: number): number {
  const d = new Date(unixSeconds * 1000);
  const target = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth() + months,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
  );
  return Math.floor(target / 1000);
}

function validatePriceConfig(env: Env, interval: SubscriptionInterval): string | null {
  // Only validate the price IDs relevant to the requested interval so that
  // an unconfigured Semester product doesn't block Monthly/Annual checkout.
  const ids =
    interval === 'semester'
      ? [env.STRIPE_PRICE_PLUS_SEMESTER, env.STRIPE_PRICE_PRO_SEMESTER]
      : [
          env.STRIPE_PRICE_PLUS_MONTHLY,
          env.STRIPE_PRICE_PLUS_ANNUAL,
          env.STRIPE_PRICE_PRO_MONTHLY,
          env.STRIPE_PRICE_PRO_ANNUAL,
        ];
  for (const id of ids) {
    if (!id || !id.startsWith('price_') || id.includes('REPLACE')) {
      return 'stripe price ids are not configured';
    }
  }
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_SECRET_KEY.startsWith('sk_')) {
    return 'stripe secret key not configured';
  }
  return null;
}

interface ReminderRunStats {
  configured: boolean;
  sent: number;
  skipped: number;
  total: number;
  skipReasons: Record<string, number>;
}

async function runStreakReminders(env: Env): Promise<ReminderRunStats> {
  const streakers = await listActiveStreakers(env.USAGE);
  if (!env.RESEND_API_KEY || !env.REMINDER_FROM_EMAIL) {
    console.warn('[reminders] RESEND_API_KEY or REMINDER_FROM_EMAIL not set; skipping');
    return {
      configured: false,
      sent: 0,
      skipped: streakers.length,
      total: streakers.length,
      skipReasons: { not_configured: streakers.length },
    };
  }
  const today = todayUtcDateKey();
  const reminderSentKey = (uid: string) => `lastReminderSent:${uid}`;
  const unsubBase =
    (env.WORKER_PUBLIC_URL && env.WORKER_PUBLIC_URL.length > 0)
      ? env.WORKER_PUBLIC_URL
      : 'https://mathiq-api.t-hamilton0416.workers.dev';

  let sent = 0;
  let skipped = 0;
  const skipReasons: Record<string, number> = {};
  const bump = (reason: string) => {
    skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
    skipped++;
  };

  for (const entry of streakers) {
    if (entry.lastSolvedDate === today) {
      bump('already_solved_today');
      continue;
    }
    // Compute how stale the last solve is. The streak is only recoverable
    // by today's solve if the gap is 1 day, OR 2 days with a freeze available.
    const gap = daysBetweenUtcDates(entry.lastSolvedDate, today);
    const recoverable = gap === 1 || (gap === 2 && entry.freezes > 0);
    if (!recoverable) {
      bump('streak_already_broken');
      continue;
    }
    // Idempotency: don't double-send if the cron retries within the same day.
    const already = await env.USAGE.get(reminderSentKey(entry.userId));
    if (already === today) {
      bump('already_reminded_today');
      continue;
    }
    if (await isUnsubscribed(env.USAGE, entry.userId)) {
      bump('unsubscribed');
      continue;
    }
    const user = await fetchClerkUser(env, entry.userId);
    if (!user) {
      bump('clerk_lookup_failed');
      continue;
    }
    const token = await mintUnsubscribeToken(env.USAGE, entry.userId);
    const unsubscribeUrl = `${unsubBase}/api/email/unsubscribe?t=${token}`;
    const ok = await sendReminderEmail({
      to: user.email,
      firstName: user.firstName,
      streakDays: entry.current,
      unsubscribeUrl,
      resendApiKey: env.RESEND_API_KEY,
      fromEmail: env.REMINDER_FROM_EMAIL,
    });
    if (ok) {
      // 36-hour TTL — comfortably past tomorrow's cron run, when the key
      // would no longer be relevant anyway (lastSolvedDate would have moved).
      await env.USAGE.put(reminderSentKey(entry.userId), today, {
        expirationTtl: 36 * 60 * 60,
      });
      sent++;
    } else {
      bump('send_failed');
    }
  }
  console.log(`[reminders] sent=${sent} skipped=${skipped} total=${streakers.length}`);
  return { configured: true, sent, skipped, total: streakers.length, skipReasons };
}

/** Manually trigger runStreakReminders. Gated by Clerk auth + MAX_USER_IDS
 *  allowlist (admin only). Returns the stats so we can debug from the browser. */
async function handleAdminRunReminders(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const authState = await authenticate(request, env);
  if (authState.kind !== 'user') {
    return json({ error: 'unauthorized' }, 401, cors);
  }
  const allowlist = (env.MAX_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowlist.includes(authState.userId)) {
    return json({ error: 'forbidden' }, 403, cors);
  }
  const stats = await runStreakReminders(env);
  return json({ ok: true, ...stats }, 200, cors);
}

function daysBetweenUtcDates(prior: string, today: string): number {
  const [py, pm, pd] = prior.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(py, pm - 1, pd)) / (24 * 60 * 60 * 1000),
  );
}

async function fetchClerkUserEmail(env: Env, userId: string): Promise<string | undefined> {
  const user = await fetchClerkUser(env, userId);
  return user?.email;
}

async function fetchClerkUser(
  env: Env,
  userId: string,
): Promise<{ email: string; firstName: string | null } | null> {
  try {
    const resp = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
      headers: { Authorization: `Bearer ${env.CLERK_SECRET_KEY}` },
    });
    if (!resp.ok) return null;
    const user = (await resp.json()) as {
      email_addresses?: Array<{ id: string; email_address: string }>;
      primary_email_address_id?: string | null;
      first_name?: string | null;
    };
    if (!user.email_addresses?.length) return null;
    const primary = user.email_addresses.find((e) => e.id === user.primary_email_address_id);
    const email = (primary ?? user.email_addresses[0]).email_address;
    return { email, firstName: user.first_name?.trim() || null };
  } catch {
    return null;
  }
}

async function handleUnsubscribe(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get('t');
  if (!token) return unsubscribePage('Invalid unsubscribe link.', 400);

  const userId = await consumeUnsubscribeToken(env.USAGE, token);
  if (!userId) {
    return unsubscribePage(
      'That unsubscribe link has expired or already been used.',
      400,
    );
  }
  // RFC 8058 one-click POST — Gmail/Outlook require a successful body-less
  // response, not the HTML confirmation page that humans see.
  if (request.method === 'POST') {
    return new Response('ok', { status: 200 });
  }
  return unsubscribePage(
    'You have been unsubscribed from MathIQ streak reminders.',
    200,
  );
}

function unsubscribePage(message: string, status: number): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>MathIQ — Unsubscribe</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',sans-serif;max-width:540px;margin:60px auto;padding:24px;color:#1a2b1a;background:#d4e26a;line-height:1.55;">
  <div style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;letter-spacing:0.18em;color:rgba(26,43,26,0.6);text-transform:uppercase;margin-bottom:10px;">
    MATHIQ
  </div>
  <h1 style="font-size:22px;font-weight:700;line-height:1.2;letter-spacing:-0.01em;margin:0 0 20px;">
    ${message.replace(/[&<>"']/g, (c) =>
      c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
    )}
  </h1>
  <a href="https://mathiq.io/" style="display:inline-block;background:#1a4d6e;color:#d4e26a;padding:12px 22px;text-decoration:none;font-weight:600;font-size:14px;">
    Back to MathIQ &rarr;
  </a>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

// ─── Daily Challenge ──────────────────────────────────────────────────

interface ChallengeGradeBody {
  image?: string;
  mediaType?: string;
  studentAnswer?: string;
  turnstileToken?: string;
}

const MAX_TYPED_ANSWER_CHARS = 2000;

async function handleChallengeToday(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  // Public — no auth required. Anonymous visitors see the problem too.
  const record = await getOrGenerateTodaysChallenge(env);
  if (!record) {
    return json(
      { error: 'challenge_unavailable', message: "Today's challenge is being prepared — try again in a moment." },
      503,
      cors,
    );
  }
  return json(
    {
      date: record.date,
      challengeNumber: challengeNumberFor(record.date),
      courseId: record.courseId,
      courseTitle: record.courseTitle,
      topicId: record.topicId,
      topicTitle: record.topicTitle,
      difficulty: record.difficulty,
      problemText: record.problemText,
    },
    200,
    cors,
  );
}

async function handleChallengeGrade(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const tooLarge = assertContentLength(request, MAX_GRADE_BODY_BYTES, cors);
  if (tooLarge) return tooLarge;
  const authState = await authenticate(request, env);
  if (authState.kind === 'invalid') {
    return json({ error: 'invalid_token', message: authState.message }, 401, cors);
  }

  let body: ChallengeGradeBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400, cors);
  }
  const typedAnswer: string | null =
    typeof body.studentAnswer === 'string' && body.studentAnswer.trim().length > 0
      ? body.studentAnswer.trim()
      : null;
  const imageBase64: string | null =
    typeof body.image === 'string' && body.image.length > 0 ? body.image : null;
  if (typedAnswer && imageBase64) {
    return json({ error: 'choose one', message: 'Send either a typed answer or an image, not both.' }, 400, cors);
  }
  if (!typedAnswer && !imageBase64) {
    return json({ error: 'image or studentAnswer required' }, 400, cors);
  }
  if (imageBase64) {
    if (!body.mediaType || !ALLOWED_GRADE_MEDIA.has(body.mediaType)) {
      return json({ error: 'unsupported media type' }, 400, cors);
    }
    if (imageBase64.length > MAX_GRADE_BASE64_CHARS) {
      return json({ error: 'file too large', limit: MAX_GRADE_BASE64_CHARS }, 413, cors);
    }
  }
  if (typedAnswer && typedAnswer.length > MAX_TYPED_ANSWER_CHARS) {
    return json({ error: 'typed answer too long', limit: MAX_TYPED_ANSWER_CHARS }, 413, cors);
  }

  // ── Rate-limit + abuse check, split by auth state ─────────────────
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const userCounters: CounterRef[] = []; // for refund tracking
  let isAnon = false;

  if (authState.kind === 'user') {
    const userGrade = userChallengeGradeCounter(env.USAGE_DO, authState.userId);
    const used = await peek(userGrade);
    if (used >= 1) {
      return json(
        { error: 'rate_limit', message: "You've already graded today's challenge.", resetAt: nextMidnightUtc() },
        429,
        cors,
      );
    }
    const newCount = await increment(userGrade);
    if (newCount > 1) {
      await decrement(userGrade);
      return json(
        { error: 'rate_limit', message: "You've already graded today's challenge.", resetAt: nextMidnightUtc() },
        429,
        cors,
      );
    }
    userCounters.push(userGrade);
  } else {
    // Anonymous path: Turnstile + per-IP + global ceiling.
    isAnon = true;
    if (env.TURNSTILE_SECRET_KEY) {
      if (!body.turnstileToken || typeof body.turnstileToken !== 'string') {
        return json({ error: 'turnstile_required', message: 'Verify you are human to grade.' }, 400, cors);
      }
      const valid = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, body.turnstileToken, ip);
      if (!valid) {
        return json({ error: 'turnstile_failed', message: 'Verification failed. Refresh and try again.' }, 403, cors);
      }
    } else {
      console.warn('[challenge-grade] TURNSTILE_SECRET_KEY not configured — allowing anonymous grade without verification');
    }

    const ipCounter = anonChallengeGradeCounter(env.USAGE_DO, ip);
    const ipUsed = await peek(ipCounter);
    if (ipUsed >= 1) {
      return json(
        { error: 'rate_limit', message: "You've already graded today. Sign in for streak tracking.", resetAt: nextMidnightUtc() },
        429,
        cors,
      );
    }
    const globalCounter = anonChallengeGradeGlobalCounter(env.USAGE_DO);
    const globalUsed = await peek(globalCounter);
    if (globalUsed >= ANON_CHALLENGE_GRADE_GLOBAL_DAILY_CAP) {
      return json(
        { error: 'service_unavailable', message: "Today's free grading capacity is full. Sign in to continue." },
        503,
        cors,
      );
    }
    const newIp = await increment(ipCounter);
    if (newIp > 1) {
      await decrement(ipCounter);
      return json({ error: 'rate_limit', resetAt: nextMidnightUtc() }, 429, cors);
    }
    const newGlobal = await increment(globalCounter);
    if (newGlobal > ANON_CHALLENGE_GRADE_GLOBAL_DAILY_CAP) {
      await decrement(globalCounter);
      await decrement(ipCounter);
      return json({ error: 'service_unavailable' }, 503, cors);
    }
    userCounters.push(ipCounter, globalCounter);
  }

  const refundCounters = async () => {
    for (const c of userCounters) await decrement(c);
  };

  // ── Fetch today's challenge so the grader knows what to grade against
  const record = await getOrGenerateTodaysChallenge(env);
  if (!record) {
    await refundCounters();
    return json({ error: 'challenge_unavailable' }, 503, cors);
  }

  // ── Resolve student work text — either OCR'd from the photo or typed directly
  let studentWorkText: string;
  if (imageBase64) {
    if (!env.MATHPIX_APP_ID || !env.MATHPIX_APP_KEY) {
      await refundCounters();
      console.error('[challenge-grade] Mathpix credentials missing');
      return json(
        { error: 'service_unavailable', message: 'Challenge grading is temporarily unavailable.' },
        503,
        cors,
      );
    }
    const ocr =
      body.mediaType === 'application/pdf'
        ? await extractStudentWorkFromPdf({
            appId: env.MATHPIX_APP_ID,
            appKey: env.MATHPIX_APP_KEY,
            pdfBase64: imageBase64,
          })
        : await extractStudentWork({
            appId: env.MATHPIX_APP_ID,
            appKey: env.MATHPIX_APP_KEY,
            imageBase64,
            mediaType: body.mediaType!,
          });
    if (!ocr.ok || !ocr.text) {
      await refundCounters();
      console.error('[challenge-grade] mathpix failed', ocr.status, ocr.detail);
      return json(
        { error: 'ocr_failed', message: 'Could not read your work. Try a clearer, well-lit photo.' },
        502,
        cors,
      );
    }
    studentWorkText = ocr.text;
  } else {
    studentWorkText = typedAnswer!;
  }

  // ── Grade with Sonnet
  const grade = await gradeChallengeSubmission(env.ANTHROPIC_API_KEY, record, studentWorkText);
  if (!grade) {
    await refundCounters();
    return json(
      { error: 'grade_failed', message: 'Grading failed — try again in a moment.' },
      502,
      cors,
    );
  }

  // ── Persist (signed-in only) + update streak + mint a shareable link
  let streakState = null;
  let shareId: string | null = null;
  if (authState.kind === 'user') {
    await saveAttempt(env.USAGE, {
      userId: authState.userId,
      date: record.date,
      studentMmd: studentWorkText,
      grade,
      submittedAt: Date.now(),
    });
    streakState = await recordSolve(env.USAGE, authState.userId, grade.correct, record.date);
    // Auto-mint a shareable id so the user can copy a real link straight
    // away — no extra "make this shareable" step. The id is opaque (64-bit
    // hex) and resolves only to the attempt+grade, never to identifiable
    // user data.
    const share = await createShare(env.USAGE, authState.userId, record.date);
    shareId = share.shareId;
  }

  return json(
    {
      grade,
      streak: streakState,
      challengeNumber: challengeNumberFor(record.date),
      anonymous: isAnon,
      shareId,
    },
    200,
    cors,
  );
}

async function handleChallengeLatex(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const authState = await authenticate(request, env);
  if (authState.kind !== 'user') {
    return json({ error: 'sign_in_required', message: 'Sign in to render your challenge as a typeset PDF.' }, 401, cors);
  }

  const date = todayUtcDateKey();

  // Cache hit? Free re-download, no slot consumed.
  const cacheKey = `challenge-latex-pdf:user:${authState.userId}:${date}`;
  const cached = await env.USAGE.get(cacheKey);
  if (cached) {
    return json({ pdfBase64: cached, cached: true }, 200, cors);
  }

  // Must have graded the challenge before rendering
  const attempt = await getAttempt(env.USAGE, authState.userId, date);
  if (!attempt) {
    return json(
      { error: 'no_attempt', message: 'Grade the daily challenge first — then you can render your work.' },
      404,
      cors,
    );
  }

  // Atomic claim of the 1/day LaTeX slot
  const counter = userChallengeLatexCounter(env.USAGE_DO, authState.userId);
  const used = await peek(counter);
  if (used >= 1) {
    return json(
      { error: 'rate_limit', message: "You've already rendered today's challenge.", resetAt: nextMidnightUtc() },
      429,
      cors,
    );
  }
  const newCount = await increment(counter);
  if (newCount > 1) {
    await decrement(counter);
    return json(
      { error: 'rate_limit', message: "You've already rendered today's challenge.", resetAt: nextMidnightUtc() },
      429,
      cors,
    );
  }

  // Need the challenge record for the title
  const record = await getOrGenerateTodaysChallenge(env);
  const challengeNum = record ? challengeNumberFor(date) : 0;
  const title = record
    ? `MathIQ Daily Challenge #${challengeNum} · ${record.topicTitle}`
    : `MathIQ Daily Challenge · ${date}`;

  // Generate LaTeX from the stored MMD. Same primary/fallback path as
  // handleHomeworkLatexPdf — Claude-generated TeX is the premium output,
  // hand-rolled mmdToTex is the safe fallback.
  let tex: string;
  const latexGen = await generateLatexFromMmd({
    apiKey: env.ANTHROPIC_API_KEY,
    mmd: attempt.studentMmd,
    title,
  });
  if (latexGen.ok && latexGen.tex) {
    tex = latexGen.tex;
  } else {
    if (latexGen.detail) {
      console.error('[challenge-latex] Claude gen failed, falling back:', latexGen.detail);
    }
    const texBody = mmdToTex(attempt.studentMmd);
    tex = wrapTexSource(texBody, { title });
  }

  const compiled = await compileLatex(tex);
  if (!compiled.ok || !compiled.pdfBase64) {
    await decrement(counter);
    console.error('[challenge-latex] compile failed', compiled.status, (compiled.detail ?? '').slice(0, 300));
    return json(
      {
        error: 'compile_failed',
        message: 'LaTeX compile is having trouble. Try again in a few minutes.',
        texSource: tex,
      },
      502,
      cors,
    );
  }

  // Cache the PDF so re-downloads are free for 24h
  await env.USAGE.put(cacheKey, compiled.pdfBase64, { expirationTtl: 24 * 60 * 60 });

  return json({ pdfBase64: compiled.pdfBase64, cached: false }, 200, cors);
}

async function handleStreak(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const authState = await authenticate(request, env);
  if (authState.kind !== 'user') {
    return json({ error: 'sign_in_required' }, 401, cors);
  }
  // Pass today's date so getStreak applies the monthly freeze refill on
  // the response. Otherwise the UI would show last month's freeze count
  // until the user next submits.
  const streak = await getStreak(env.USAGE, authState.userId, todayUtcDateKey());
  return json(streak, 200, cors);
}

/**
 * Public read of a shared Daily Challenge attempt. Returns the challenge
 * problem + the sharer's grade + a flag indicating whether they rendered
 * a LaTeX PDF (the actual PDF is served separately by /pdf).
 *
 * Never returns the sharer's userId or any other identifiable info.
 */
async function handleShareGet(
  request: Request,
  env: Env,
  cors: Record<string, string>,
  shareId: string,
): Promise<Response> {
  const share = await getShare(env.USAGE, shareId);
  if (!share) {
    return json({ error: 'not_found', message: "This shared challenge expired or was never created." }, 404, cors);
  }
  const challenge = await getOrGenerateTodaysChallenge(env, share.date);
  if (!challenge) {
    return json({ error: 'challenge_unavailable' }, 503, cors);
  }
  const attempt = await getAttempt(env.USAGE, share.userId, share.date);
  if (!attempt) {
    return json({ error: 'not_found' }, 404, cors);
  }
  const pdfCacheKey = `challenge-latex-pdf:user:${share.userId}:${share.date}`;
  const hasPdf = (await env.USAGE.get(pdfCacheKey)) !== null;

  return json(
    {
      shareId: share.shareId,
      date: share.date,
      challengeNumber: challengeNumberFor(share.date),
      courseTitle: challenge.courseTitle,
      topicTitle: challenge.topicTitle,
      difficulty: challenge.difficulty,
      problemText: challenge.problemText,
      grade: attempt.grade,
      hasPdf,
    },
    200,
    cors,
  );
}

/**
 * Serve the typeset LaTeX PDF for a shared attempt. Returned as
 * `application/pdf` so browsers can embed it directly.
 */
async function handleSharePdf(
  request: Request,
  env: Env,
  cors: Record<string, string>,
  shareId: string,
): Promise<Response> {
  const share = await getShare(env.USAGE, shareId);
  if (!share) {
    return new Response('not found', { status: 404, headers: cors });
  }
  const pdfCacheKey = `challenge-latex-pdf:user:${share.userId}:${share.date}`;
  const pdfBase64 = await env.USAGE.get(pdfCacheKey);
  if (!pdfBase64) {
    return new Response('no pdf', { status: 404, headers: cors });
  }
  // Decode base64 → bytes. Chunked to avoid large fromCharCode call stack.
  const bin = atob(pdfBase64);
  const len = bin.length;
  const buf = new Uint8Array(len);
  for (let i = 0; i < len; i++) buf[i] = bin.charCodeAt(i);
  return new Response(buf, {
    status: 200,
    headers: {
      ...cors,
      'content-type': 'application/pdf',
      'cache-control': 'public, max-age=3600',
      'content-disposition': `inline; filename="mathiq-challenge-${share.date}.pdf"`,
    },
  });
}

// ─── Trials access gate ──────────────────────────────────────────────

type AccessResult =
  | { ok: true; trialConsumed: false }
  | { ok: true; trialConsumed: true; feature: TrialFeature; remaining: number }
  | { ok: false; response: Response };

/**
 * Decide whether a request to a premium feature is allowed.
 *
 *   - Pro tier always granted (any feature)
 *   - Plus tier granted for Plus features; Pro features pitch the Pro upgrade
 *   - Free signed-in: try a lifetime trial; consume one if available, else 402
 *   - Anonymous: 401 sign_in_required
 *
 * Returns AccessResult — caller spreads the deny response or proceeds and
 * refunds the trial on upstream failure when `trialConsumed === true`.
 */
async function ensureFeatureAccess(
  env: Env,
  authState: AuthState,
  tier: Tier,
  feature: TrialFeature,
  minTier: 'plus' | 'pro',
  cors: Record<string, string>,
): Promise<AccessResult> {
  if (tier === 'pro') return { ok: true, trialConsumed: false };
  if (tier === 'plus' && minTier === 'plus') return { ok: true, trialConsumed: false };

  if (authState.kind !== 'user') {
    return {
      ok: false,
      response: json(
        { error: 'sign_in_required', feature, message: 'Sign in to try this feature.' },
        401,
        cors,
      ),
    };
  }

  // Plus user hitting a Pro-only feature. Monthly Pro-trial-for-Plus is a
  // future phase — for now, pitch the upgrade directly.
  if (tier === 'plus' && minTier === 'pro') {
    return {
      ok: false,
      response: json(
        { error: 'upgrade_required', feature, currentTier: 'plus' },
        403,
        cors,
      ),
    };
  }

  // Free signed-in — try a lifetime trial.
  const remaining = await consumeTrial(env.USAGE, authState.userId, feature);
  if (remaining === null) {
    return {
      ok: false,
      response: json(
        {
          error: 'trial_exhausted',
          feature,
          message: 'You’ve used your free trial of this feature. Upgrade to continue.',
        },
        402,
        cors,
      ),
    };
  }
  return { ok: true, trialConsumed: true, feature, remaining };
}

async function refundAccess(env: Env, authState: AuthState, access: AccessResult): Promise<void> {
  if (!access.ok || !access.trialConsumed) return;
  if (authState.kind !== 'user') return;
  await refundTrial(env.USAGE, authState.userId, access.feature);
}

async function handleTrialsGet(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const authState = await authenticate(request, env);
  if (authState.kind !== 'user') {
    return json({ error: 'sign_in_required' }, 401, cors);
  }
  const tier = await resolveTier(authState, env);
  const remaining = await getRemainingTrials(env.USAGE, authState.userId);
  return json({ tier, remaining }, 200, cors);
}

/**
 * Verify a Cloudflare Turnstile token. Returns true on valid challenge.
 * Free service; no per-request cost.
 */
async function verifyTurnstile(
  secretKey: string,
  token: string,
  remoteip?: string,
): Promise<boolean> {
  try {
    const params = new URLSearchParams();
    params.set('secret', secretKey);
    params.set('response', token);
    if (remoteip && remoteip !== 'unknown') params.set('remoteip', remoteip);
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!resp.ok) return false;
    const data = (await resp.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
