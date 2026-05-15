/**
 * Counter refs and tiny RPC client for the UsageCounter Durable Object.
 *
 * Pattern (daily walkthrough quota):
 *   const used = await peek(counter);          // for the model decision
 *   if (decision.model === null) return 429;
 *   const newCount = await increment(counter); // atomic + 1
 *   // double-check post-increment in case of a race
 *   if (decideTier(tier, newCount - 1).model === null) {
 *     await decrement(counter); return 429;
 *   }
 *   const upstream = await callModel(...);
 *   if (!upstream.ok) { await decrement(counter); return 502; }
 *
 * Three counter shapes share the same UsageCounter class, distinguished by
 * the DO name and (where rollover differs from daily) an explicit period key:
 *   userCounter             — daily walkthrough/feature slots
 *   userOpusMonthlyCounter  — month-scoped premium-model spend
 *   userExamDailyCounter    — daily Exam Mode generation cap
 */

export interface CounterRef {
  ns: DurableObjectNamespace;
  name: string;
  /** Rollover key sent to the DO. Omit for the default (today's UTC date). */
  period?: string;
}

export function userCounter(ns: DurableObjectNamespace, userId: string): CounterRef {
  return { ns, name: `user:${userId}:${dateKey()}` };
}

export function anonymousCounter(ns: DurableObjectNamespace, ip: string): CounterRef {
  return { ns, name: `anon:${ip}:${dateKey()}` };
}

/** Monthly Opus counter — the safety net that stops a single whale from
 *  burning a year of revenue in one month. Rolls over on calendar UTC month. */
export function userOpusMonthlyCounter(
  ns: DurableObjectNamespace,
  userId: string,
): CounterRef {
  const month = monthKey();
  return { ns, name: `user:${userId}:opus:${month}`, period: month };
}

/** Daily Exam Mode counter — caps Pro users at N exam generations per day
 *  so one user can't generate 20 exams (20 × Opus × 15 problems each) overnight. */
export function userExamDailyCounter(
  ns: DurableObjectNamespace,
  userId: string,
): CounterRef {
  return { ns, name: `user:${userId}:exam:${dateKey()}` };
}

async function callCounter(ref: CounterRef, path: '/peek' | '/inc' | '/dec'): Promise<number> {
  const id = ref.ns.idFromName(ref.name);
  const stub = ref.ns.get(id);
  const qs = ref.period ? `?period=${encodeURIComponent(ref.period)}` : '';
  const resp = await stub.fetch(`https://counter${path}${qs}`, {
    method: path === '/peek' ? 'GET' : 'POST',
  });
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

function monthKey(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}

export function nextMidnightUtc(d = new Date()): string {
  const next = new Date(d);
  next.setUTCHours(24, 0, 0, 0);
  return next.toISOString();
}
