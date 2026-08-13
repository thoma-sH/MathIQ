/**
 * Dependency probe behind `GET /api/health`.
 *
 * The endpoint used to return a static `{ ok: true }`. That stayed green
 * while KV was failing, the Durable Object was unreachable, or a secret had
 * gone missing — so an uptime monitor pointed at it reported success during
 * an outage. A health check that can't fail is worse than no health check,
 * because it manufactures confidence.
 *
 * What it probes:
 *   kv             — one read of a key that need not exist. `null` is a
 *                    healthy answer; the point is that the binding is wired
 *                    and KV answers at all.
 *   durableObject  — one `/peek` against a fixed counter name. `/peek` only
 *                    reads inside the DO, so this never mutates a real
 *                    user's quota and never writes storage.
 *   config         — presence of the secrets whose absence turns the main
 *                    paths into 500s.
 *
 * What it deliberately does NOT do: call Anthropic, Stripe, or Clerk. This
 * route is unauthenticated and exempt from the origin allowlist, so anything
 * billable here is a way for a stranger to spend money. Presence of a key is
 * checked; validity is not.
 *
 * Both network probes are bounded — a dependency that hangs should report
 * `fail` quickly rather than holding the request open until the monitor
 * times out, because the timeout tells you nothing about which one broke.
 */
import { peek } from './rateLimit';

export interface HealthEnv {
  USAGE: KVNamespace;
  USAGE_DO: DurableObjectNamespace;
  ANTHROPIC_API_KEY: string;
  CLERK_SECRET_KEY: string;
  STRIPE_SECRET_KEY: string;
}

export type CheckStatus = 'ok' | 'fail';

export interface HealthReport {
  ok: boolean;
  checks: {
    kv: CheckStatus;
    durableObject: CheckStatus;
    config: CheckStatus;
  };
}

/** Key read by the KV probe. Never written — absence is a healthy result. */
const PROBE_KEY = 'health:probe';

/** Fixed DO name for the probe, kept clear of the `user:` / `anon:` spaces. */
const PROBE_COUNTER = 'health:probe';

const PROBE_TIMEOUT_MS = 3000;

/** Secrets the request paths can't run without. Presence only — see above. */
const REQUIRED_SECRETS = [
  'ANTHROPIC_API_KEY',
  'CLERK_SECRET_KEY',
  'STRIPE_SECRET_KEY',
] as const;

export async function checkHealth(env: HealthEnv): Promise<HealthReport> {
  const [kv, durableObject] = await Promise.all([probeKv(env), probeDurableObject(env)]);
  const config: CheckStatus = REQUIRED_SECRETS.every((k) => nonEmpty(env[k])) ? 'ok' : 'fail';
  const checks = { kv, durableObject, config };
  return {
    ok: kv === 'ok' && durableObject === 'ok' && config === 'ok',
    checks,
  };
}

async function probeKv(env: HealthEnv): Promise<CheckStatus> {
  return probe(() => env.USAGE.get(PROBE_KEY));
}

async function probeDurableObject(env: HealthEnv): Promise<CheckStatus> {
  return probe(() => peek({ ns: env.USAGE_DO, name: PROBE_COUNTER }));
}

/** Run a probe, mapping "threw" and "took too long" alike onto `fail`. */
async function probe(run: () => Promise<unknown>): Promise<CheckStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = Symbol('timeout');
  try {
    const timeout = new Promise<typeof expired>((resolve) => {
      timer = setTimeout(() => resolve(expired), PROBE_TIMEOUT_MS);
    });
    return (await Promise.race([run(), timeout])) === expired ? 'fail' : 'ok';
  } catch {
    return 'fail';
  } finally {
    // Guarded rather than passing `timer` straight through: workers-types
    // declares clearTimeout as (number | null), so an unset handle doesn't
    // typecheck there even though @types/node would accept it.
    if (timer !== undefined) clearTimeout(timer);
  }
}

function nonEmpty(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
