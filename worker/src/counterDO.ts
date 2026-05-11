/**
 * Atomic daily usage counter as a Durable Object.
 *
 * Each (userId or IP) gets one DO instance. The DO is single-threaded per
 * id, so read-modify-write inside it is atomic — concurrent requests from
 * the same user can no longer both peek the same value and both commit,
 * bypassing the quota.
 *
 * Endpoints (POST except peek):
 *   /peek  — returns { count }
 *   /inc   — atomically increment, returns { count } (post-increment)
 *   /dec   — atomically decrement (refund on upstream failure), returns { count }
 *
 * Daily reset is built in: if the stored date doesn't match today's UTC
 * date, count is reset to 0 before the operation.
 */
export interface DOEnv {}

export class UsageCounter {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    switch (url.pathname) {
      case '/peek':
        return this.respond(await this.currentCount());
      case '/inc':
        return this.respond(await this.mutate(1));
      case '/dec':
        return this.respond(await this.mutate(-1));
      default:
        return new Response('not found', { status: 404 });
    }
  }

  private async currentCount(): Promise<number> {
    const today = utcDate();
    const storedDate = (await this.state.storage.get<string>('date')) ?? '';
    const stored = (await this.state.storage.get<number>('count')) ?? 0;
    return storedDate === today ? stored : 0;
  }

  /** Atomic mutate: reset if it's a new day, then add `delta`, clamped at 0. */
  private async mutate(delta: number): Promise<number> {
    const today = utcDate();
    const storedDate = (await this.state.storage.get<string>('date')) ?? '';
    let count = (await this.state.storage.get<number>('count')) ?? 0;
    if (storedDate !== today) {
      count = 0;
      await this.state.storage.put('date', today);
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
