import { describe, it, expect } from 'vitest';
import { consumeTrial, getRemainingTrials, INITIAL_TRIALS, refundTrial } from './trials';

/**
 * In-memory stand-ins. The counter fake mirrors UsageCounter's contract —
 * one count per name, reset when the period key changes, clamped at zero —
 * so these exercise the real arithmetic in trials.ts against the same
 * behaviour the Durable Object has.
 */
function fakeEnv(kvRecords: Record<string, string> = {}) {
  const counts = new Map<string, { period: string; count: number }>();
  const ns = {
    idFromName: (name: string) => ({ name }),
    get: (id: { name: string }) => ({
      fetch: async (url: string) => {
        const u = new URL(url);
        const period = u.searchParams.get('period') ?? 'today';
        const cur = counts.get(id.name) ?? { period, count: 0 };
        if (cur.period !== period) {
          cur.period = period;
          cur.count = 0;
        }
        if (u.pathname === '/inc') cur.count += 1;
        if (u.pathname === '/dec') cur.count = Math.max(0, cur.count - 1);
        counts.set(id.name, cur);
        return new Response(JSON.stringify({ count: cur.count }));
      },
    }),
  } as unknown as DurableObjectNamespace;
  const kv = {
    get: async (k: string) => kvRecords[k] ?? null,
  } as unknown as KVNamespace;
  return { USAGE: kv, USAGE_DO: ns, counts };
}

describe('trials on the counter', () => {
  it('starts every feature at the initial allotment', async () => {
    const env = fakeEnv();
    expect(await getRemainingTrials(env, 'u1')).toEqual(INITIAL_TRIALS);
  });

  it('consumes down to zero and then refuses', async () => {
    const env = fakeEnv();
    expect(await consumeTrial(env, 'u1', 'latex')).toBe(0);
    expect(await consumeTrial(env, 'u1', 'latex')).toBeNull();
    expect((await getRemainingTrials(env, 'u1')).latex).toBe(0);
  });

  it('hands a refused increment straight back', async () => {
    const env = fakeEnv();
    await consumeTrial(env, 'u1', 'latex');
    await consumeTrial(env, 'u1', 'latex');
    expect(env.counts.get('user:u1:trial:latex')?.count).toBe(1);
  });

  it('refunds, but never above the allotment', async () => {
    const env = fakeEnv();
    await consumeTrial(env, 'u1', 'whyHow');
    await refundTrial(env, 'u1', 'whyHow');
    await refundTrial(env, 'u1', 'whyHow');
    expect((await getRemainingTrials(env, 'u1')).whyHow).toBe(INITIAL_TRIALS.whyHow);
  });

  it('honours what a KV record says was already spent', async () => {
    const env = fakeEnv({
      'trials:user:u1': JSON.stringify({ ...INITIAL_TRIALS, whyHow: 2 }),
    });
    expect((await getRemainingTrials(env, 'u1')).whyHow).toBe(2);
    expect(await consumeTrial(env, 'u1', 'whyHow')).toBe(1);
    expect(await consumeTrial(env, 'u1', 'whyHow')).toBe(0);
    expect(await consumeTrial(env, 'u1', 'whyHow')).toBeNull();
  });

  it('is keyed per user and per feature', async () => {
    const env = fakeEnv();
    await consumeTrial(env, 'u1', 'latex');
    expect((await getRemainingTrials(env, 'u2')).latex).toBe(INITIAL_TRIALS.latex);
    expect((await getRemainingTrials(env, 'u1')).examGen).toBe(INITIAL_TRIALS.examGen);
  });
});
