const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? 'http://localhost:8787';

export interface HistoryRecord {
  id: string;
  userId: string;
  courseId: string;
  topicId: string;
  topicTitle: string;
  problem: string | null;
  walkthrough: string;
  modelUsed: string | null;
  createdAt: number;
}

export interface HistoryListItem {
  id: string;
  courseId: string;
  topicId: string;
  topicTitle: string;
  problemSnippet: string | null;
  createdAt: number;
}

export interface HistoryListResponse {
  items: HistoryListItem[];
  cursor: string | null;
}

interface AuthOpts {
  getToken: () => Promise<string | null>;
}

async function authHeaders(getToken: AuthOpts['getToken']): Promise<Record<string, string>> {
  const token = await getToken();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export async function listHistory(opts: AuthOpts & { cursor?: string }): Promise<HistoryListResponse> {
  const url = new URL(`${WORKER_URL}/api/history/list`);
  if (opts.cursor) url.searchParams.set('cursor', opts.cursor);
  const resp = await fetch(url, { method: 'GET', headers: await authHeaders(opts.getToken) });
  if (!resp.ok) return { items: [], cursor: null };
  return (await resp.json()) as HistoryListResponse;
}

export async function getHistoryRecord(opts: AuthOpts & { id: string }): Promise<HistoryRecord | null> {
  const url = new URL(`${WORKER_URL}/api/history/get`);
  url.searchParams.set('id', opts.id);
  const resp = await fetch(url, { method: 'GET', headers: await authHeaders(opts.getToken) });
  if (!resp.ok) return null;
  return (await resp.json()) as HistoryRecord;
}

export async function saveHistoryRecord(
  opts: AuthOpts & {
    courseId: string;
    topicId: string;
    problem: string | null;
    walkthrough: string;
    modelUsed: string | null;
  },
): Promise<{ id: string } | null> {
  const resp = await fetch(`${WORKER_URL}/api/history/save`, {
    method: 'POST',
    headers: await authHeaders(opts.getToken),
    body: JSON.stringify({
      courseId: opts.courseId,
      topicId: opts.topicId,
      problem: opts.problem,
      walkthrough: opts.walkthrough,
      modelUsed: opts.modelUsed,
    }),
  });
  if (!resp.ok) return null;
  return (await resp.json()) as { id: string };
}

export async function deleteHistoryRecord(opts: AuthOpts & { id: string }): Promise<boolean> {
  const resp = await fetch(`${WORKER_URL}/api/history/delete`, {
    method: 'POST',
    headers: await authHeaders(opts.getToken),
    body: JSON.stringify({ id: opts.id }),
  });
  return resp.ok;
}
