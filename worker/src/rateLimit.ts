/**
 * Daily per-key rate limiter backed by Cloudflare KV.
 *
 * Keys: `usage:user:<userId>:<YYYY-MM-DD>` for signed-in users
 *       `usage:anon:<ip>:<YYYY-MM-DD>`     for anonymous requests
 *
 * Counters expire at midnight UTC the next day (TTL ~25h to be safe).
 */

export interface RateLimitOutcome {
  ok: boolean;
  /** What the limit was for this scope. */
  limit: number;
  /** How many were used after this request was counted. */
  used: number;
  /** ISO timestamp at which the counter resets (next midnight UTC). */
  resetAt: string;
  /** 'user' or 'anonymous' */
  scope: 'user' | 'anonymous';
}

const USER_DAILY_LIMIT = 5;
const ANONYMOUS_DAILY_LIMIT = 1;

function dateKey(d = new Date()): string {
  // YYYY-MM-DD in UTC
  return d.toISOString().slice(0, 10);
}

function nextMidnightUtc(d = new Date()): string {
  const next = new Date(d);
  next.setUTCHours(24, 0, 0, 0);
  return next.toISOString();
}

export async function checkAndIncrement(
  kv: KVNamespace,
  key: string,
  limit: number,
  scope: 'user' | 'anonymous',
): Promise<RateLimitOutcome> {
  const fullKey = `usage:${key}:${dateKey()}`;
  const raw = await kv.get(fullKey);
  const current = raw ? parseInt(raw, 10) || 0 : 0;

  if (current >= limit) {
    return {
      ok: false,
      limit,
      used: current,
      resetAt: nextMidnightUtc(),
      scope,
    };
  }

  const next = current + 1;
  // Expire ~25h out so the entry self-cleans the day after.
  await kv.put(fullKey, String(next), { expirationTtl: 60 * 60 * 25 });

  return {
    ok: true,
    limit,
    used: next,
    resetAt: nextMidnightUtc(),
    scope,
  };
}

export function checkUser(
  kv: KVNamespace,
  userId: string,
): Promise<RateLimitOutcome> {
  return checkAndIncrement(kv, `user:${userId}`, USER_DAILY_LIMIT, 'user');
}

export function checkAnonymous(
  kv: KVNamespace,
  ip: string,
): Promise<RateLimitOutcome> {
  return checkAndIncrement(kv, `anon:${ip}`, ANONYMOUS_DAILY_LIMIT, 'anonymous');
}
