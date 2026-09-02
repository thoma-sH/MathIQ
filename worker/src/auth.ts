/**
 * Clerk JWT verification for the MathIQ worker.
 *
 * Returns:
 *   { kind: 'user', userId } — valid Clerk session token
 *   { kind: 'anonymous' }    — no Authorization header
 *   { kind: 'invalid', message } — header present but token bad
 */
import { createClerkClient, type ClerkOptions } from '@clerk/backend';

export type AuthState =
  | { kind: 'user'; userId: string }
  | { kind: 'anonymous' }
  | { kind: 'invalid'; message: string };

/** The Vite dev servers. Added to the allowed origins by the worker itself,
 *  and only while it is being served from localhost — never from config. */
const LOCAL_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
];

/**
 * Origins allowed to call the API — and, for Clerk, the parties a session
 * token may have been issued to. The configured list is production only. A
 * deployed worker therefore never accepts a local page, whatever
 * ALLOWED_ORIGINS says, while `wrangler dev` keeps working with no extra
 * config because it can see it is running on localhost.
 */
export function allowedOrigins(env: { ALLOWED_ORIGINS: string }, url: URL): string[] {
  const configured = env.ALLOWED_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  return local ? [...configured, ...LOCAL_DEV_ORIGINS] : configured;
}

export async function authenticate(
  request: Request,
  env: { CLERK_SECRET_KEY: string; CLERK_PUBLISHABLE_KEY: string; ALLOWED_ORIGINS: string },
): Promise<AuthState> {
  const auth = request.headers.get('Authorization');
  if (!auth) return { kind: 'anonymous' };

  const options: ClerkOptions = {
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
  };
  const clerk = createClerkClient(options);

  try {
    const requestState = await clerk.authenticateRequest(request, {
      authorizedParties: allowedOrigins(env, new URL(request.url)),
    });

    if (!requestState.isAuthenticated) {
      return { kind: 'invalid', message: requestState.reason ?? 'unauthenticated' };
    }

    const userId = requestState.toAuth().userId;
    if (!userId) return { kind: 'invalid', message: 'no userId in token' };

    return { kind: 'user', userId };
  } catch (err) {
    return {
      kind: 'invalid',
      message: err instanceof Error ? err.message : 'auth error',
    };
  }
}
