/**
 * Daily per-key counter. Implemented as a Durable Object so concurrent
 * requests from the same user can't both pass the ceiling check.
 *
 * Pattern:
 *   const used = await peek(counter);          // for the model decision
 *   if (decision.model === null) return 429;
 *   const newCount = await increment(counter); // atomic + 1
 *   // double-check post-increment in case of a race
 *   if (decideTier(tier, newCount - 1).model === null) {
 *     await decrement(counter); return 429;
 *   }
 *   const upstream = await callModel(...);
 *   if (!upstream.ok) { await decrement(counter); return 502; }
 */

export interface CounterRef {
  ns: DurableObjectNamespace;
  name: string;
}

export function userCounter(ns: DurableObjectNamespace, userId: string): CounterRef {
  return { ns, name: `user:${userId}:${dateKey()}` };
}

export function anonymousCounter(ns: DurableObjectNamespace, ip: string): CounterRef {
  return { ns, name: `anon:${ip}:${dateKey()}` };
}

async function callCounter(ref: CounterRef, path: '/peek' | '/inc' | '/dec'): Promise<number> {
  const id = ref.ns.idFromName(ref.name);
  const stub = ref.ns.get(id);
  const resp = await stub.fetch(`https://counter${path}`, { method: path === '/peek' ? 'GET' : 'POST' });
  const body = (await resp.json()) as { count: number };
  return body.count;
}

export async function peek(ref: CounterRef): Promise<number> {
  return callCounter(ref, '/peek');
}

/** Atomic increment, returns post-increment count. */
export async function increment(ref: CounterRef): Promise<number> {
  return callCounter(ref, '/inc');
}

/** Atomic decrement (refund), returns post-decrement count. */
export async function decrement(ref: CounterRef): Promise<number> {
  return callCounter(ref, '/dec');
}

function dateKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function nextMidnightUtc(d = new Date()): string {
  const next = new Date(d);
  next.setUTCHours(24, 0, 0, 0);
  return next.toISOString();
}
