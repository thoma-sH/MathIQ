import { resetSessionId, send, sessionId } from './beacon';

/**
 * Beta funnel instrumentation, first-party.
 *
 * Events go to MathIQ's own worker and are rolled up per session in KV — the
 * same shape the cache metrics already use. No vendor, no third-party script,
 * no session recording, and no new cookie: the only thing kept on the device
 * is an opaque session id in the existing `mathiq:` localStorage namespace.
 *
 * Every call here is a no-op unless the build sets VITE_ANALYTICS=1.
 */
export type AnalyticsEvent =
  | 'route_view'
  | 'problem_submitted'
  | 'walkthrough_first_token'
  | 'walkthrough_completed'
  | 'walkthrough_error';

let userId: string | null = null;

export function track(event: AnalyticsEvent, props?: Record<string, unknown>): void {
  // No client timestamp: the worker stamps first and last seen from its own
  // clock, which is the one the rollup is read against.
  send({ event, sid: sessionId(), props, ...(userId ? { userId } : {}) });
}

/** Ties the anonymous session that precedes sign-in to the Clerk user, so a
 *  drop-off maps to someone we can go ask. The id alone — the funnel has no
 *  use for an email address, and not collecting one is the smaller promise. */
export function identify(id: string): void {
  userId = id;
}

/** A real sign-out starts a fresh session: the next person on this device is
 *  not the one who just left. */
export function resetIdentity(): void {
  userId = null;
  resetSessionId();
}
