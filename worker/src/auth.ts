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
      authorizedParties: env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()),
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
