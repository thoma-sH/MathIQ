const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? 'http://localhost:8787';

export interface ClassifyResult {
  courseId: string;
  topicId: string;
}

/**
 * A failure to *ask*, as distinct from the classifier answering "nowhere".
 * Callers used to fold both into "couldn't place that — try rephrasing",
 * which told a student in airplane mode, or one who had hit the daily search
 * cap, to reword a perfectly good problem. The message is written to be shown.
 */
export class ClassifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClassifyError';
  }
}

/**
 * Ask the worker which (course, topic) pair best matches the user's problem.
 * Scans all 108 topics across all courses; cross-course routing supported.
 * Returns null if the classifier couldn't find a confident match; throws
 * ClassifyError when the question never got a proper answer.
 */
export async function classifyTopic(args: {
  problem: string;
  getToken?: () => Promise<string | null>;
  signal?: AbortSignal;
}): Promise<ClassifyResult | null> {
  const token = await args.getToken?.();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let resp: Response;
  try {
    resp = await fetch(`${WORKER_URL}/api/classify`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ problem: args.problem }),
      signal: args.signal,
    });
  } catch (err) {
    // Bubble aborts so callers can ignore stale results.
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw new ClassifyError("Couldn't reach MathIQ. Check your connection and try again.");
  }

  if (resp.status === 429) {
    const body = (await resp.json().catch(() => ({}))) as { message?: string };
    throw new ClassifyError(body.message ?? "You've run today's searches. Try again tomorrow.");
  }
  if (resp.status === 401) {
    throw new ClassifyError('Your sign-in has expired. Sign in again and retry.');
  }
  if (resp.status === 413) {
    throw new ClassifyError("That's too long to search. Trim it to the problem itself.");
  }
  if (!resp.ok) {
    throw new ClassifyError("Iris couldn't place that just now. Try again in a moment.");
  }

  const body = (await resp.json()) as {
    courseId: string | null;
    topicId: string | null;
  };
  if (body.courseId && body.topicId) {
    return { courseId: body.courseId, topicId: body.topicId };
  }
  return null;
}
