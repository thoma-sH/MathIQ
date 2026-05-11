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
  commit,
  nextMidnightUtc,
  peek,
  userCounter,
  type CounterRef,
} from './rateLimit';
import { decideTier, resolveTier, type Tier, type TierDecision } from './tier';
import { callAnthropicStream } from './anthropic';
import { callOpenRouterStream } from './openrouter';
import { normalizeLatexDelimiters } from './normalize';
import {
  clearSubscription,
  findUserByCustomer,
  getSubscription,
  isEntitled,
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
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_PLUS_MONTHLY: string;
  STRIPE_PRICE_PLUS_ANNUAL: string;
  STRIPE_PRICE_PRO_MONTHLY: string;
  STRIPE_PRICE_PRO_ANNUAL: string;
  STRIPE_SUCCESS_URL: string;
  STRIPE_CANCEL_URL: string;
  STRIPE_PORTAL_RETURN_URL: string;
}

const CLASSIFY_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

interface WalkthroughBody {
  courseId?: string;
  topicId?: string;
  problem?: string;
  action?: 'walkthrough' | 'why-how';
  walkthroughSoFar?: string;
}

interface ClassifyBody {
  problem?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin') ?? '';
    const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
    const corsOrigin = allowed.includes(origin) ? origin : allowed[0];

    const cors: Record<string, string> = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
      'Access-Control-Allow-Headers': 'content-type, authorization',
      'Access-Control-Expose-Headers':
        'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-RateLimit-Scope, X-Tier, X-Model-Used, X-Degraded, X-Premium-Allotment',
      Vary: 'Origin',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

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

    if (request.method === 'POST' && url.pathname === '/api/stripe/webhook') {
      return handleStripeWebhook(request, env);
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
      ? userCounter(env.USAGE, authState.userId)
      : anonymousCounter(
          env.USAGE,
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
  const walkAction: 'walkthrough' | 'why-how' =
    action === 'why-how' ? 'why-how' : 'walkthrough';
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

  // Provider dispatch
  const model = decision.model;
  const upstream =
    model.provider === 'anthropic'
      ? await callAnthropicStream({
          apiKey: env.ANTHROPIC_API_KEY,
          model: model.id,
          course,
          topic,
          problem,
          action: walkAction,
          walkthroughSoFar: walkthroughSoFarClean,
        })
      : await callOpenRouterStream({
          apiKey: env.OPENROUTER_API_KEY,
          model: model.id,
          course,
          topic,
          problem,
          action: walkAction,
          walkthroughSoFar: walkthroughSoFarClean,
        });

  if (!upstream.ok || !upstream.body) {
    return json(
      { error: `upstream ${upstream.status}`, detail: upstream.detail ?? '' },
      upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status,
      { ...cors, ...baseHeaders },
    );
  }

  // Increment counter only on successful upstream call dispatch.
  await commit(counter, usedToday + 1);

  // Re-build rate-limit headers reflecting the post-commit count.
  const postHeaders = buildRateLimitHeaders(tier, usedToday + 1, decision);

  return new Response(upstream.body.pipeThrough(normalizeLatexDelimiters()), {
    status: 200,
    headers: {
      ...cors,
      ...postHeaders,
      'X-Model-Used': model.id,
      'X-Degraded': decision.degraded ? 'true' : 'false',
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
    return json(
      { error: `anthropic ${upstream.status}` },
      upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status,
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
  const state = await getSubscription(env.USAGE, authState.userId);
  const entitled = isEntitled(state);
  return json(
    {
      tier: entitled && state ? state.tier : null,
      interval: entitled && state ? state.interval : null,
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

  try {
    await processStripeEvent(env, stripe, event);
    return new Response('ok', { status: 200 });
  } catch (err) {
    console.error('stripe webhook error', err);
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
      const userId = session.client_reference_id ?? session.metadata?.userId;
      const customerId =
        typeof session.customer === 'string' ? session.customer : session.customer?.id;
      if (!userId || !customerId) return;
      await rememberCustomer(env.USAGE, customerId, userId);
      // Subscription details land via customer.subscription.created right after this.
      return;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
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
