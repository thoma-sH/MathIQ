/**
 * Atomic usage counter as a Durable Object.
 *
 * Each (userId or IP) gets one DO instance. The DO is single-threaded per
 * id, so read-modify-write inside it is atomic — concurrent requests from
 * the same user can no longer both peek the same value and both commit,
 * bypassing the quota.
 * Since each userId is a single-threaded per id = thread-safe & deadlock-free
 *
 * Endpoints (POST except peek):
 *   /peek  — returns { count }
 *   /inc   — atomically increment, returns { count } (post-increment)
 *   /dec   — atomically decrement (refund on upstream failure), returns { count }
 *
 * Period rollover:
 *   The caller passes the desired rollover key via `?period=<key>`. The DO
 *   stores it alongside the count; when the caller sends a different key
 *   than the one stored, the count resets to 0 before the operation. This
 *   lets the same DO class back both daily counters (key = "2026-05-15")
 *   and monthly counters (key = "2026-05") without code branching.
 *
 *   Backward compat: when `period` is absent the DO defaults to today's UTC
 *   date — the same auto-reset behavior the daily counters always had.
 */
export interface DOEnv {}

export class UsageCounter {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const periodKey = url.searchParams.get('period') ?? utcDate();
    switch (url.pathname) {
      case '/peek':
        return this.respond(await this.currentCount(periodKey));
      case '/inc':
        return this.respond(await this.mutate(1, periodKey));
      case '/dec':
        return this.respond(await this.mutate(-1, periodKey));
      default:
        return new Response('not found', { status: 404 });
    }
  }

  private async currentCount(periodKey: string): Promise<number> {
    const stored = (await this.state.storage.get<string>('date')) ?? '';
    const count = (await this.state.storage.get<number>('count')) ?? 0;
    return stored === periodKey ? count : 0;
  }

  /** Atomic mutate: reset if it's a new period, then add `delta`, clamped at 0. */
  private async mutate(delta: number, periodKey: string): Promise<number> {
    const stored = (await this.state.storage.get<string>('date')) ?? '';
    let count = (await this.state.storage.get<number>('count')) ?? 0;
    if (stored !== periodKey) {
      count = 0;
      await this.state.storage.put('date', periodKey);
    }
    count = Math.max(0, count + delta);
    await this.state.storage.put('count', count);
    return count;
  }

  private respond(count: number): Response {
    return new Response(JSON.stringify({ count }), {
      headers: { 'content-type': 'application/json' },
    });
  }
}

function utcDate(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}
