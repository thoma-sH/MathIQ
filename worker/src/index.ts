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
  anonymousCounter,
  decrement,
  increment,
  nextMidnightUtc,
  peek,
  userCounter,
  type CounterRef,
} from './rateLimit';
export { UsageCounter } from './counterDO';
import { decideTier, resolveTier, type Tier, type TierDecision } from './tier';
import { callAnthropicStream } from './anthropic';
import { callOpenRouterStream } from './openrouter';
import { getIrisPrompts } from './prompt';
import { normalizeLatexDelimiters } from './normalize';
import {
  clearSubscription,
  findUserByCustomer,
  getSubscription,
  isEventProcessed,
  markEventProcessed,
  rememberCustomer,
  setSubscription,
  type SubscriptionInterval,
  type SubscriptionTier,
} from './subscription';
import {
  createCheckoutSession,
  createPortalSession,
  makeStripe,
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
  STRIPE_SUCCESS_URL: string;
  STRIPE_CANCEL_URL: string;
  STRIPE_PORTAL_RETURN_URL: string;
  IRIS_FOUNDATION_PROMPT_1?: string;
  IRIS_FOUNDATION_PROMPT_2?: string;
  IRIS_FOUNDATION_PROMPT_3?: string;
  IRIS_FOUNDATION_PROMPT_4?: string;
  IRIS_WHY_HOW_PROMPT?: string;
  IRIS_PRACTICE_PROMPT?: string;
}

const CLASSIFY_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

// Size guardrails. Anything over these is rejected with 413 so a single
// abusive request can't burn upstream tokens or hang a worker.
const MAX_PROBLEM_CHARS = 8000;       // a generous math problem
const MAX_HISTORY_CHARS = 60000;      // walkthrough-so-far for why/how
const MAX_CLASSIFY_CHARS = 2000;      // classifier input

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
    // Health check doesn't need CORS; everything else requires a known Origin.
    if (!originAllowed && url.pathname !== '/api/health') {
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

  // Gate Why/How to paid tiers only.
  let parsedBody: WalkthroughBody | null = null;
  try {
    parsedBody = (await request.clone().json()) as WalkthroughBody;
  } catch {
    // We'll re-parse below and surface the error there.
  }
  if (
    parsedBody?.action === 'why-how' &&
    tier !== 'plus' &&
    tier !== 'pro'
  ) {
    return json(
      {
        error: 'upgrade_required',
        message: 'Why & how is a MathIQ+ feature.',
      },
      403,
      cors,
    );
  }
  const counter: CounterRef =
    authState.kind === 'user'
      ? userCounter(env.USAGE_DO, authState.userId)
      : anonymousCounter(
          env.USAGE_DO,
          request.headers.get('CF-Connecting-IP') ?? 'unknown',
        );

  const usedToday = await peek(counter);
  const decision: TierDecision = decideTier(tier, usedToday);

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
  const finalDecision: TierDecision = decideTier(tier, usedBefore);

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

  // Provider dispatch
  const model = finalDecision.model;
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
        });

  if (!upstream.ok || !upstream.body) {
    if (upstream.detail) console.error('upstream walkthrough failed', upstream.status, upstream.detail);
    // Upstream failed — refund the slot so the user isn't charged for it.
    await decrement(counter);
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
      'X-Degraded': finalDecision.degraded ? 'true' : 'false',
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
  return json(
    {
      tier: effectiveTier === 'plus' || effectiveTier === 'pro' ? effectiveTier : null,
      interval: state?.interval ?? null,
      status: state?.status ?? null,
      currentPeriodEnd: state?.currentPeriodEnd ?? null,
      manageable: !!state?.stripeCustomerId,
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
  if (body.interval !== 'monthly' && body.interval !== 'annual') {
    return json({ error: 'invalid interval' }, 400, cors);
  }

  // Refuse to start a Checkout session if the corresponding price id is a
  // placeholder. Better to fail loudly here than to send the user to Stripe
  // and have them see an invalid-price page.
  const priceConfigErr = validatePriceConfig(env);
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

  const session = await createCheckoutSession(stripe, env, {
    userId: authState.userId,
    userEmail,
    tier: body.tier,
    interval: body.interval,
    existingCustomerId: existing?.stripeCustomerId,
  });

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

interface OcrBody {
  image?: string;
  mediaType?: string;
}

async function handleOcr(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const authState = await authenticate(request, env);
  if (authState.kind !== 'user') {
    return json({ error: 'sign_in_required' }, 401, cors);
  }
  const tier: Tier = await resolveTier(authState, env);
  if (tier !== 'plus' && tier !== 'pro') {
    return json(
      { error: 'upgrade_required', message: 'Image input is a MathIQ+ feature.' },
      403,
      cors,
    );
  }

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

  const result = await extractProblemFromImage({
    apiKey: env.ANTHROPIC_API_KEY,
    imageBase64: body.image,
    mediaType: body.mediaType,
  });

  if (!result.ok) {
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
  if (tier !== 'pro') {
    return json(
      {
        error: 'upgrade_required',
        message: 'Exam mode is a MathIQ Pro feature.',
      },
      403,
      cors,
    );
  }

  let body: ExamGenerateBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400, cors);
  }
  if (!body.courseId || typeof body.courseId !== 'string') {
    return json({ error: 'courseId required' }, 400, cors);
  }
  if (
    body.exam !== 'exam1' &&
    body.exam !== 'exam2' &&
    body.exam !== 'exam3' &&
    body.exam !== 'final'
  ) {
    return json({ error: 'exam must be one of exam1, exam2, exam3, final' }, 400, cors);
  }

  const course = COURSES_BY_ID[body.courseId];
  if (!course) {
    return json({ error: 'unknown courseId' }, 400, cors);
  }

  // Exam generation counts against the user's daily Opus quota (1 slot).
  const counter = userCounter(env.USAGE_DO, authState.userId);
  const usedToday = await peek(counter);
  const decision = decideTier(tier, usedToday);
  if (decision.model === null) {
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
  await increment(counter);

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
    // Refund the slot on upstream failure.
    await decrement(counter);
    if (result.detail) console.error('exam generate failed', result.status, result.detail);
    return json(
      { error: 'upstream_error', message: 'Exam generation failed — try again in a moment.' },
      502,
      cors,
    );
  }

  return json(result.record, 200, cors);
}

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
  const authState = await authenticate(request, env);
  if (authState.kind === 'invalid') {
    return json({ error: 'invalid_token', message: authState.message }, 401, cors);
  }
  if (authState.kind !== 'user') {
    return json({ error: 'sign_in_required' }, 401, cors);
  }

  const tier = await resolveTier(authState, env);
  if (tier !== 'pro') {
    return json(
      { error: 'upgrade_required', message: 'Exam grading is a MathIQ Pro feature.' },
      403,
      cors,
    );
  }

  let body: ExamGradeBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400, cors);
  }
  if (!body.examId || typeof body.examId !== 'string') {
    return json({ error: 'examId required' }, 400, cors);
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

  const record = await getExam(env.USAGE, authState.userId, body.examId);
  if (!record) {
    return json(
      {
        error: 'exam_not_found',
        message: 'That exam has expired or was never generated. Generate a new one.',
      },
      404,
      cors,
    );
  }

  // Grading counts against the user's daily Pro quota (1 slot).
  const counter = userCounter(env.USAGE_DO, authState.userId);
  const usedToday = await peek(counter);
  const decision = decideTier(tier, usedToday);
  if (decision.model === null) {
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
  await increment(counter);

  const prompts = getIrisPrompts(env);
  const result = await gradeExam({
    apiKey: env.ANTHROPIC_API_KEY,
    gradePrompt: prompts.grade,
    record,
    imageBase64: body.image,
    mediaType: body.mediaType,
  });

  if (!result.ok || !result.result) {
    await decrement(counter);
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

function validatePriceConfig(env: Env): string | null {
  const ids = [
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

async function fetchClerkUserEmail(env: Env, userId: string): Promise<string | undefined> {
  try {
    const resp = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
      headers: { Authorization: `Bearer ${env.CLERK_SECRET_KEY}` },
    });
    if (!resp.ok) return undefined;
    const user = (await resp.json()) as {
      email_addresses?: Array<{ id: string; email_address: string }>;
      primary_email_address_id?: string | null;
    };
    if (!user.email_addresses?.length) return undefined;
    const primary = user.email_addresses.find((e) => e.id === user.primary_email_address_id);
    return (primary ?? user.email_addresses[0]).email_address;
  } catch {
    return undefined;
  }
}
