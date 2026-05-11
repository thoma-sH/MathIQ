/**
 * Daily per-key counter, backed by Cloudflare KV.
 *
 * Keys:
 *   usage:user:<userId>:<YYYY-MM-DD>
 *   usage:anon:<ip>:<YYYY-MM-DD>
 *
 * Two-step API: `peek()` reads the current count without mutating, and
 * `commit()` increments by 1. The split lets the caller make a tier
 * decision (which model? are we degraded?) based on current count, then
 * commit once the upstream call is actually being made.
 */

export interface CounterRef {
  kv: KVNamespace;
  key: string;
}

export function userCounter(kv: KVNamespace, userId: string): CounterRef {
  return { kv, key: `usage:user:${userId}:${dateKey()}` };
}

export function anonymousCounter(kv: KVNamespace, ip: string): CounterRef {
  return { kv, key: `usage:anon:${ip}:${dateKey()}` };
}

export async function peek(ref: CounterRef): Promise<number> {
  const raw = await ref.kv.get(ref.key);
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

export async function commit(ref: CounterRef, next: number): Promise<void> {
  // Expire ~25h out so the entry self-cleans the day after.
  await ref.kv.put(ref.key, String(next), { expirationTtl: 60 * 60 * 25 });
}

function dateKey(d = new Date()): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

export function nextMidnightUtc(d = new Date()): string {
  const next = new Date(d);
  next.setUTCHours(24, 0, 0, 0);
  return next.toISOString();
}
