import { describe, it, expect } from 'vitest';
import {
  parseEventBody,
  readFunnel,
  recordEvent,
  type FunnelSession,
  type ParsedEvent,
} from './events';

/** In-memory KV covering the three calls events.ts makes: get as json, put,
 *  and a prefix list. Enough to exercise the real merge and rollup. */
function fakeKv(seed: Record<string, unknown> = {}) {
  const store = new Map<string, string>(
    Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]),
  );
  const kv = {
    get: async (key: string) => {
      const raw = store.get(key);
      return raw === undefined ? null : JSON.parse(raw);
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    list: async ({ prefix }: { prefix: string }) => ({
      keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true as const,
      cursor: undefined,
    }),
  } as unknown as KVNamespace;
  return { kv, store };
}

const today = new Date().toISOString().slice(0, 10);

function ok(raw: unknown): ParsedEvent {
  const parsed = parseEventBody(raw);
  if (!parsed.ok) throw new Error(`expected a valid body, got: ${parsed.reason}`);
  return parsed.value;
}

describe('event validation', () => {
  it('accepts a well-formed event', () => {
    const v = ok({ event: 'route_view', sid: 'abcd1234-ef', props: { route: 'topic' } });
    expect(v.event).toBe('route_view');
    expect(v.sid).toBe('abcd1234-ef');
    expect(v.props.route).toBe('topic');
  });

  it('refuses an event name that is not on the allowlist', () => {
    const parsed = parseEventBody({ event: 'arbitrary_key', sid: 'abcd1234-ef' });
    expect(parsed).toMatchObject({ ok: false });
  });

  it('refuses a session id that could not have come from the client', () => {
    for (const sid of ['short', '../../etc', 'has space', 'a'.repeat(65)]) {
      expect(parseEventBody({ event: 'route_view', sid })).toMatchObject({ ok: false });
    }
  });

  it('refuses a body that is not an object', () => {
    for (const raw of [null, 'route_view', 42, ['route_view']]) {
      expect(parseEventBody(raw)).toMatchObject({ ok: false });
    }
  });

  it('keeps only whitelisted props, and truncates what it keeps', () => {
    const v = ok({
      event: 'walkthrough_error',
      sid: 'abcd1234-ef',
      props: {
        kind: 'network',
        ms: 1200,
        detail: 'x'.repeat(500),
        password: 'hunter2',
        nested: { a: 1 },
        ttft_ms: Number.NaN,
      },
    });
    expect(v.props.kind).toBe('network');
    expect(v.props.ms).toBe(1200);
    expect(String(v.props.detail)).toHaveLength(80);
    expect(v.props).not.toHaveProperty('password');
    expect(v.props).not.toHaveProperty('nested');
    // NaN would serialise as null and break the rollup's arithmetic.
    expect(v.props).not.toHaveProperty('ttft_ms');
  });

  it('drops a user id that is not shaped like one', () => {
    expect(ok({ event: 'route_view', sid: 'abcd1234-ef', userId: 'user_2abc' }).userId)
      .toBe('user_2abc');
    expect(ok({ event: 'route_view', sid: 'abcd1234-ef', userId: 'a b/c' }).userId)
      .toBeUndefined();
  });
});

describe('session records', () => {
  it('opens a session and counts repeats of the same step', async () => {
    const { kv, store } = fakeKv();
    const e = ok({ event: 'route_view', sid: 'abcd1234-ef', props: { route: 'home' } });
    await recordEvent(kv, e);
    await recordEvent(kv, e);
    const saved = JSON.parse(store.get(`funnel:${today}:abcd1234-ef`)!) as FunnelSession;
    expect(saved.steps.route_view).toBe(2);
    expect(saved.lastRoute).toBe('home');
    expect(saved.firstSeen).toBeLessThanOrEqual(saved.lastSeen);
  });

  it('attributes the whole session once it signs in', async () => {
    const { kv, store } = fakeKv();
    await recordEvent(kv, ok({ event: 'route_view', sid: 'abcd1234-ef' }));
    await recordEvent(
      kv,
      ok({ event: 'problem_submitted', sid: 'abcd1234-ef', userId: 'user_2abc' }),
    );
    const saved = JSON.parse(store.get(`funnel:${today}:abcd1234-ef`)!) as FunnelSession;
    expect(saved.userId).toBe('user_2abc');
    expect(saved.lastEvent).toBe('problem_submitted');
  });

  it('keeps the last error kind so a drop-off says why', async () => {
    const { kv, store } = fakeKv();
    await recordEvent(
      kv,
      ok({ event: 'walkthrough_error', sid: 'abcd1234-ef', props: { kind: 'rate_limit' } }),
    );
    const saved = JSON.parse(store.get(`funnel:${today}:abcd1234-ef`)!) as FunnelSession;
    expect(saved.lastErrorKind).toBe('rate_limit');
  });
});

describe('the readout', () => {
  it('counts each step once per session, however often it fired', async () => {
    const { kv } = fakeKv();
    // One session walks the whole funnel, viewing three routes on the way.
    for (const e of ['route_view', 'route_view', 'route_view', 'problem_submitted'] as const) {
      await recordEvent(kv, ok({ event: e, sid: 'sessionaaa1' }));
    }
    // A second only ever looks at a page.
    await recordEvent(kv, ok({ event: 'route_view', sid: 'sessionbbb2' }));

    const report = await readFunnel(kv, 1);
    expect(report.total.sessions).toBe(2);
    expect(report.total.steps.route_view).toBe(2);
    expect(report.total.steps.problem_submitted).toBe(1);
    expect(report.total.steps.walkthrough_completed).toBe(0);
  });

  it('reports a quiet window as zeroes rather than nothing', async () => {
    const { kv } = fakeKv();
    const report = await readFunnel(kv, 7);
    expect(report.days).toHaveLength(7);
    expect(report.total.sessions).toBe(0);
    expect(report.total.steps.route_view).toBe(0);
  });
});
