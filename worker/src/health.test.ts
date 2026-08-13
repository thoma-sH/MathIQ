import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkHealth, type HealthEnv } from './health';

function fakeKv(get: () => Promise<unknown>): KVNamespace {
  return { get } as unknown as KVNamespace;
}

/** Records every URL the probe asks the DO for, so tests can assert the
 *  probe stays on the read-only `/peek` path. */
interface FakeDo {
  ns: DurableObjectNamespace;
  calls: string[];
}

function fakeDurableObject(respond: () => Promise<Response>): FakeDo {
  const calls: string[] = [];
  const ns = {
    idFromName: (name: string) => ({ name }),
    get: () => ({
      fetch: (url: string) => {
        calls.push(url);
        return respond();
      },
    }),
  } as unknown as DurableObjectNamespace;
  return { ns, calls };
}

const okCounter = () => Promise.resolve(new Response(JSON.stringify({ count: 0 })));

function env(overrides: Partial<HealthEnv> = {}): HealthEnv {
  return {
    USAGE: fakeKv(() => Promise.resolve(null)),
    USAGE_DO: fakeDurableObject(okCounter).ns,
    ANTHROPIC_API_KEY: 'sk-ant-test',
    CLERK_SECRET_KEY: 'sk_test',
    STRIPE_SECRET_KEY: 'sk_live_test',
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('checkHealth — healthy worker', () => {
  it('reports ok with every check passing', async () => {
    const report = await checkHealth(env());
    expect(report).toEqual({
      ok: true,
      checks: { kv: 'ok', durableObject: 'ok', config: 'ok' },
    });
  });

  it('treats a missing KV key as healthy', async () => {
    // The probe key is never written, so `null` is the expected answer.
    // Reading absence as failure would make the endpoint permanently red.
    const report = await checkHealth(env({ USAGE: fakeKv(() => Promise.resolve(null)) }));
    expect(report.checks.kv).toBe('ok');
  });

  it('probes the Durable Object read-only', async () => {
    // /peek never writes storage. If this ever became /inc, a public
    // unauthenticated endpoint would be mutating quota counters.
    const fake = fakeDurableObject(okCounter);
    await checkHealth(env({ USAGE_DO: fake.ns }));
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toContain('/peek');
    expect(fake.calls[0]).not.toContain('/inc');
  });
});

describe('checkHealth — dependency failures', () => {
  it('fails when KV throws', async () => {
    const report = await checkHealth(
      env({ USAGE: fakeKv(() => Promise.reject(new Error('KV unreachable'))) }),
    );
    expect(report.ok).toBe(false);
    expect(report.checks.kv).toBe('fail');
    // A single broken dependency shouldn't take the others down with it —
    // the point of the report is knowing *which* one went.
    expect(report.checks.durableObject).toBe('ok');
    expect(report.checks.config).toBe('ok');
  });

  it('fails when the Durable Object throws', async () => {
    const fake = fakeDurableObject(() => Promise.reject(new Error('DO unreachable')));
    const report = await checkHealth(env({ USAGE_DO: fake.ns }));
    expect(report.ok).toBe(false);
    expect(report.checks.durableObject).toBe('fail');
    expect(report.checks.kv).toBe('ok');
  });

  it('fails when the Durable Object answers with unparseable junk', async () => {
    const fake = fakeDurableObject(() => Promise.resolve(new Response('<html>502</html>')));
    const report = await checkHealth(env({ USAGE_DO: fake.ns }));
    expect(report.checks.durableObject).toBe('fail');
  });
});

describe('checkHealth — configuration', () => {
  it('fails when a required secret is missing', async () => {
    const report = await checkHealth(env({ ANTHROPIC_API_KEY: undefined as unknown as string }));
    expect(report.ok).toBe(false);
    expect(report.checks.config).toBe('fail');
  });

  it('fails when a required secret is empty or whitespace', async () => {
    // An unset `wrangler secret` can surface as an empty string rather than
    // undefined, which would otherwise read as configured.
    expect((await checkHealth(env({ STRIPE_SECRET_KEY: '' }))).checks.config).toBe('fail');
    expect((await checkHealth(env({ CLERK_SECRET_KEY: '   ' }))).checks.config).toBe('fail');
  });

  it('checks presence only, never validity', async () => {
    // Calling Anthropic or Stripe per health check would let a stranger
    // spend money on an unauthenticated route.
    const report = await checkHealth(env({ ANTHROPIC_API_KEY: 'obviously-not-a-real-key' }));
    expect(report.checks.config).toBe('ok');
  });
});

describe('checkHealth — hung dependencies', () => {
  it('fails a probe that never settles rather than hanging the request', async () => {
    vi.useFakeTimers();
    const report = checkHealth(env({ USAGE: fakeKv(() => new Promise(() => {})) }));
    await vi.advanceTimersByTimeAsync(3000);
    expect((await report).checks.kv).toBe('fail');
  });
});
