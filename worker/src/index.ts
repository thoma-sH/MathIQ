/**
 * MathIQ API worker.
 *
 *   POST /api/walkthrough  — auth + rate limit + streaming proxy to Anthropic
 *   POST /api/classify     — auth optional, no rate limit (cheap call)
 *   GET  /api/health       — no auth
 */
import { COURSES_BY_ID, findTopic } from './courses';
import { buildSystemPrompt } from './prompt';
import { authenticate, type AuthState } from './auth';
import { checkAnonymous, checkUser, type RateLimitOutcome } from './rateLimit';

interface Env {
  ANTHROPIC_API_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
  ALLOWED_ORIGINS: string;
  USAGE: KVNamespace;
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const WALKTHROUGH_MODEL = 'claude-sonnet-4-6';
const CLASSIFY_MODEL = 'claude-haiku-4-5-20251001';

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
        'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-RateLimit-Scope',
      Vary: 'Origin',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json({ ok: true, model: WALKTHROUGH_MODEL }, 200, cors);
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

  // Rate limit gate
  let outcome: RateLimitOutcome;
  if (authState.kind === 'user') {
    outcome = await checkUser(env.USAGE, authState.userId);
  } else {
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    outcome = await checkAnonymous(env.USAGE, ip);
  }

  const rateHeaders = {
    'X-RateLimit-Limit': String(outcome.limit),
    'X-RateLimit-Remaining': String(Math.max(0, outcome.limit - outcome.used)),
    'X-RateLimit-Reset': outcome.resetAt,
    'X-RateLimit-Scope': outcome.scope,
  };

  if (!outcome.ok) {
    if (authState.kind === 'anonymous') {
      return json(
        {
          error: 'sign_in_required',
          message: `You've used your free walkthrough. Sign in for ${5} walkthroughs/day.`,
          limit: outcome.limit,
          used: outcome.used,
          resetAt: outcome.resetAt,
        },
        401,
        { ...cors, ...rateHeaders },
      );
    }
    return json(
      {
        error: 'rate_limit',
        message: `You've used your ${outcome.limit} walkthroughs today.`,
        limit: outcome.limit,
        used: outcome.used,
        resetAt: outcome.resetAt,
      },
      429,
      { ...cors, ...rateHeaders },
    );
  }

  let body: WalkthroughBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400, { ...cors, ...rateHeaders });
  }

  const { courseId, topicId, problem } = body;
  if (!courseId || !topicId) {
    return json(
      { error: 'courseId and topicId required' },
      400,
      { ...cors, ...rateHeaders },
    );
  }

  const found = findTopic(courseId, topicId);
  if (!found) {
    return json(
      { error: 'unknown course or topic' },
      404,
      { ...cors, ...rateHeaders },
    );
  }
  const { course, topic } = found;

  const problemText = problem?.trim() || topic.exampleProblem;
  const userText = problem
    ? `Walk me through this ${course.title.toLowerCase()} problem step by step:\n\n${problemText}`
    : `Walk me through the canonical example for ${topic.title} step by step:\n\n${problemText}`;

  const upstream = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: WALKTHROUGH_MODEL,
      max_tokens: 4096,
      system: buildSystemPrompt(course, topic),
      messages: [{ role: 'user', content: userText }],
      stream: true,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    return json(
      { error: `anthropic ${upstream.status}`, detail: detail.slice(0, 500) },
      upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status,
      { ...cors, ...rateHeaders },
    );
  }

  const transformed = transformAnthropicSse(upstream.body);

  return new Response(transformed, {
    status: 200,
    headers: {
      ...cors,
      ...rateHeaders,
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
  // Classify is free of rate limit but still requires non-invalid auth
  // (anonymous OK; bad token rejected).
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

  const upstream = await fetch(ANTHROPIC_URL, {
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

function transformAnthropicSse(
  body: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = body.getReader();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const event = JSON.parse(payload);
              if (
                event.type === 'content_block_delta' &&
                event.delta?.type === 'text_delta'
              ) {
                const text = event.delta.text as string;
                if (text) controller.enqueue(encoder.encode(text));
              }
            } catch {
              // skip malformed event lines silently
            }
          }
        }
      } catch (err) {
        controller.error(err);
        return;
      }
      controller.close();
    },
  });
}

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json; charset=utf-8' },
  });
}
