const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? 'http://localhost:8787';

export interface ClassifyResult {
  courseId: string;
  topicId: string;
}

/**
 * Ask the worker which (course, topic) pair best matches the user's problem.
 * Scans all 108 topics across all courses; cross-course routing supported.
 * Returns null if the classifier couldn't find a confident match.
 */
export async function classifyTopic(args: {
  problem: string;
  getToken?: () => Promise<string | null>;
}): Promise<ClassifyResult | null> {
  const token = await args.getToken?.();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(`${WORKER_URL}/api/classify`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ problem: args.problem }),
  });

  if (!resp.ok) return null;
  try {
    const body = (await resp.json()) as {
      courseId: string | null;
      topicId: string | null;
    };
    if (body.courseId && body.topicId) {
      return { courseId: body.courseId, topicId: body.topicId };
    }
    return null;
  } catch {
    return null;
  }
}
