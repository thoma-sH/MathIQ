/**
 * Frontend billing client. Talks to the worker's /api/billing/* endpoints
 * and Stripe (via redirect — we never touch card data on the client).
 */
const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? 'http://localhost:8787';

export type Tier = 'plus' | 'pro';
export type Interval = 'monthly' | 'annual';

export interface SubscriptionStateResponse {
  tier: Tier | null;
  interval: Interval | null;
  status: string | null;
  currentPeriodEnd: number | null;
  manageable: boolean;
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

export async function fetchSubscriptionState(opts: AuthOpts): Promise<SubscriptionStateResponse | null> {
  const resp = await fetch(`${WORKER_URL}/api/billing/state`, {
    method: 'GET',
    headers: await authHeaders(opts.getToken),
  });
  if (resp.status === 401) return null;
  if (!resp.ok) return null;
  return (await resp.json()) as SubscriptionStateResponse;
}

export async function startCheckout(args: AuthOpts & { tier: Tier; interval: Interval }): Promise<void> {
  const resp = await fetch(`${WORKER_URL}/api/billing/checkout`, {
    method: 'POST',
    headers: await authHeaders(args.getToken),
    body: JSON.stringify({ tier: args.tier, interval: args.interval }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ error: 'unknown' }));
    throw new Error((body as { error?: string }).error ?? `checkout failed: ${resp.status}`);
  }
  const { url } = (await resp.json()) as { url: string };
  window.location.assign(url);
}

export async function openCustomerPortal(opts: AuthOpts): Promise<void> {
  const resp = await fetch(`${WORKER_URL}/api/billing/portal`, {
    method: 'POST',
    headers: await authHeaders(opts.getToken),
  });
  if (!resp.ok) {
    throw new Error(`portal failed: ${resp.status}`);
  }
  const { url } = (await resp.json()) as { url: string };
  window.location.assign(url);
}
