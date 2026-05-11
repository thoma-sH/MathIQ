/**
 * MathIQ API worker.
 *
 *   POST /api/walkthrough  — auth + tier-aware rate limit + streaming
 *   POST /api/classify     — auth optional, no rate limit (cheap call)
 *   GET  /api/health       — no auth
 */
import { COURSES_BY_ID, findTopic } from './courses';
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

interface Env {
  ANTHROPIC_API_KEY: string;
  OPENROUTER_API_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
  ALLOWED_ORIGINS: string;
  PRO_USER_IDS?: string;
  USAGE: KVNamespace;
}

const CLASSIFY_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

interface WalkthroughBody {
  courseId?: string;
  topicId?: string;
  problem?: string;
}

interface ClassifyBody {
  courseId?: string;
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

  const tier: Tier = resolveTier(authState, env);
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

  const { courseId, topicId, problem } = body;
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
        })
      : await callOpenRouterStream({
          apiKey: env.OPENROUTER_API_KEY,
          model: model.id,
          course,
          topic,
          problem,
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
      'cache-control': 'no-store',
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

  const { courseId, problem } = body;
  if (!courseId || !problem?.trim()) {
    return json({ error: 'courseId and problem required' }, 400, cors);
  }

  const course = COURSES_BY_ID[courseId];
  if (!course) {
    return json({ error: 'unknown course' }, 404, cors);
  }

  const topicList = course.topics
    .map((t) => `- ${t.id}: ${t.title} — ${t.blurb}`)
    .join('\n');

  const upstream = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: CLASSIFY_MODEL,
      max_tokens: 64,
      system:
        'You classify math problems into topics. Reply with EXACTLY the topic id (the part before the colon) of the topic that best matches the problem. Reply with nothing else — no prose, no quotes, no punctuation. If none of the topics fits, reply with the single word: none.',
      messages: [
        {
          role: 'user',
          content: `Course: ${course.title}\n\nTopics:\n${topicList}\n\nProblem:\n${problem}\n\nWhich topic id best matches this problem?`,
        },
      ],
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
    return json({ topicId: null }, 200, cors);
  }
  const valid = course.topics.some((t) => t.id === text);
  return json({ topicId: valid ? text : null }, 200, cors);
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
