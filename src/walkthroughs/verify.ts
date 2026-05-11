const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? 'http://localhost:8787';

export type Verdict = 'correct' | 'incorrect' | 'unclear';

export interface VerifyResponse {
  verdict: Verdict;
  reason: string | null;
}

export async function verifyWalkthrough(args: {
  walkthrough: string;
  getToken: () => Promise<string | null>;
  signal?: AbortSignal;
}): Promise<VerifyResponse | null> {
  const token = await args.getToken();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const resp = await fetch(`${WORKER_URL}/api/verify`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ walkthrough: args.walkthrough }),
      signal: args.signal,
    });
    if (!resp.ok) return null;
    return (await resp.json()) as VerifyResponse;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    return null;
  }
}
