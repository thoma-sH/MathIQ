import { KEY_ANALYTICS_SID, readString, writeString } from '../lib/storage';

const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? 'http://localhost:8787';

/** Off unless a build explicitly turns it on. A tester's browser and a local
 *  dev server both stay silent. */
export const ANALYTICS_ENABLED = import.meta.env.VITE_ANALYTICS === '1';

const SID_SHAPE = /^[a-z0-9-]{8,64}$/i;

let cached: string | null = null;

function newId(): string {
  // Only has to be unique, never unguessable — so a missing randomUUID (an
  // insecure origin, an older browser) falls back rather than throwing.
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The device-local session id. Shape-checked on the way out of storage: it
 *  becomes part of a KV key, so a hand-edited value is untrusted input. */
export function sessionId(): string {
  if (cached) return cached;
  const stored = readString(KEY_ANALYTICS_SID);
  cached = stored && SID_SHAPE.test(stored) ? stored : newId();
  if (cached !== stored) writeString(KEY_ANALYTICS_SID, cached);
  return cached;
}

export function resetSessionId(): void {
  cached = newId();
  writeString(KEY_ANALYTICS_SID, cached);
}

/** Fire-and-forget. Never throws, never awaits, never blocks a render — an
 *  analytics failure the student can see is worse than no analytics. */
export function send(body: unknown): void {
  if (!ANALYTICS_ENABLED) return;
  try {
    void fetch(`${WORKER_URL}/api/event`, {
      method: 'POST',
      // text/plain keeps this a CORS *simple* request: no preflight, so one
      // round trip instead of two.
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(body),
      // Survives the unload that a navigation away from a walkthrough causes,
      // which is exactly the event a drop-off funnel needs to keep.
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Blocked, offline, or no fetch at all. The app does not care.
  }
}
