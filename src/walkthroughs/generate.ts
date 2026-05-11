import type { Course, Topic } from './types';

const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? 'http://localhost:8787';

export type WalkthroughErrorKind =
  | 'sign_in_required'
  | 'rate_limit'
  | 'other';

export class WalkthroughError extends Error {
  kind: WalkthroughErrorKind;
  data?: {
    limit?: number;
    used?: number;
    resetAt?: string;
    detail?: string;
    status?: number;
  };

  constructor(kind: WalkthroughErrorKind, message: string, data?: WalkthroughError['data']) {
    super(message);
    this.kind = kind;
    this.data = data;
  }
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  /** 'anonymous' if the user is unauthenticated, 'user' if signed in. */
  scope: 'anonymous' | 'user';
  /** 'anonymous' | 'free' | 'plus' | 'pro' */
  tier: 'anonymous' | 'free' | 'plus' | 'pro';
  /** Which model the worker actually used for this response. */
  modelUsed?: string;
  /** True if the user is on the degraded (fallback) model because they
   *  exhausted their premium allotment. Only meaningful for Pro tier. */
  degraded: boolean;
  /** For Pro: how many premium walkthroughs they get before degrading. */
  premiumAllotment?: number;
}

export type WalkthroughAction = 'walkthrough' | 'why-how' | 'practice';

export interface GenerateRequest {
  course: Course;
  topic: Topic;
  /** The problem to walk through. If omitted, uses the topic's example. */
  problem?: string;
  signal?: AbortSignal;
  /** Clerk's getToken function, if the user is signed in. */
  getToken?: () => Promise<string | null>;
  /** Called once when the worker responds, with current usage info. */
  onRateLimitInfo?: (info: RateLimitInfo) => void;
  /** 'walkthrough' = full one-shot walkthrough; 'why-how' = explain a specific step from the prior walkthrough. */
  action?: WalkthroughAction;
  /** For action='why-how': the walkthrough text up to and including the step being explained. */
  walkthroughSoFar?: string;
}

export async function* streamWalkthrough(req: GenerateRequest): AsyncGenerator<string> {
  const token = await req.getToken?.();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(`${WORKER_URL}/api/walkthrough`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      courseId: req.course.id,
      topicId: req.topic.id,
      problem: req.problem,
      action: req.action ?? 'walkthrough',
      walkthroughSoFar: req.walkthroughSoFar,
    }),
    signal: req.signal,
  });

  emitRateLimit(resp, req.onRateLimitInfo);

  if (resp.status === 401) {
    const body = await resp.json().catch(() => ({})) as { message?: string };
    throw new WalkthroughError(
      'sign_in_required',
      body.message ?? 'Sign in to continue.',
    );
  }

  if (resp.status === 429) {
    const body = await resp.json().catch(() => ({})) as {
      limit?: number;
      used?: number;
      resetAt?: string;
    };
    throw new WalkthroughError(
      'rate_limit',
      `You've used your ${body.limit ?? 'daily'} walkthroughs.`,
      body,
    );
  }

  if (!resp.ok || !resp.body) {
    let detail = '';
    try {
      const body = (await resp.json()) as { error?: string; detail?: string };
      detail = body.detail ?? body.error ?? '';
    } catch {
      // ignore
    }
    throw new WalkthroughError('other', `Walkthrough failed: ${resp.status}`, {
      status: resp.status,
      detail,
    });
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    if (chunk) yield chunk;
  }
}

function emitRateLimit(
  resp: Response,
  cb: GenerateRequest['onRateLimitInfo'],
): void {
  if (!cb) return;
  const limitHeader = resp.headers.get('X-RateLimit-Limit');
  const remainingHeader = resp.headers.get('X-RateLimit-Remaining');
  if (!limitHeader || !remainingHeader) return;
  const limit = parseInt(limitHeader, 10);
  const remaining = parseInt(remainingHeader, 10);
  if (!Number.isFinite(limit) || !Number.isFinite(remaining)) return;

  const scopeHeader = resp.headers.get('X-RateLimit-Scope');
  const scope: 'anonymous' | 'user' = scopeHeader === 'user' ? 'user' : 'anonymous';

  const tierHeader = resp.headers.get('X-Tier');
  const tier: 'anonymous' | 'free' | 'plus' | 'pro' =
    tierHeader === 'pro'
      ? 'pro'
      : tierHeader === 'plus'
        ? 'plus'
        : tierHeader === 'free'
          ? 'free'
          : 'anonymous';

  const modelUsed = resp.headers.get('X-Model-Used') ?? undefined;
  const degraded = resp.headers.get('X-Degraded') === 'true';
  const allotmentHeader = resp.headers.get('X-Premium-Allotment');
  const premiumAllotment = allotmentHeader ? parseInt(allotmentHeader, 10) : undefined;

  cb({
    limit,
    remaining,
    scope,
    tier,
    modelUsed,
    degraded,
    premiumAllotment: Number.isFinite(premiumAllotment as number) ? premiumAllotment : undefined,
  });
}
