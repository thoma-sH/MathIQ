import type { Course } from './types';

const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? 'http://localhost:8787';

export async function classifyTopic(args: {
  course: Course;
  problem: string;
  getToken?: () => Promise<string | null>;
}): Promise<string | null> {
  const token = await args.getToken?.();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(`${WORKER_URL}/api/classify`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ courseId: args.course.id, problem: args.problem }),
  });

  if (!resp.ok) return null;
  try {
    const body = (await resp.json()) as { topicId: string | null };
    return body.topicId ?? null;
  } catch {
    return null;
  }
}
