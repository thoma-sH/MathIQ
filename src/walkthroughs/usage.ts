/**
 * Client API for the quota snapshot behind the model picker.
 *
 * The walkthrough response headers carry the same numbers, but they only
 * arrive *after* a walkthrough — the picker has to show "3 of 5 max left"
 * before the user has typed anything, so it reads this first and then keeps
 * itself current from the headers.
 */
const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? 'http://localhost:8787';

export interface UsageBucket {
  used: number;
  limit: number;
  remaining: number;
}

export interface UsageState {
  tier: 'anonymous' | 'free' | 'plus' | 'pro';
  scope: 'anonymous' | 'user';
  resetAt: string;
  monthlyResetAt: string | null;
  daily: UsageBucket;
  /** Null for tiers that can't reach the premium model at all. */
  opusDaily: UsageBucket | null;
  opusMonthly: UsageBucket | null;
  canChooseModel: boolean;
}

export async function fetchUsage(opts: {
  getToken: () => Promise<string | null>;
  signal?: AbortSignal;
}): Promise<UsageState | null> {
  const token = await opts.getToken();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(`${WORKER_URL}/api/usage`, {
    method: 'GET',
    headers,
    signal: opts.signal,
  });
  if (!resp.ok) return null;
  return (await resp.json()) as UsageState;
}
