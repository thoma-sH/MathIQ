/**
 * Daily Challenge client API. Talks to the worker's /api/challenge/* and
 * /api/streak endpoints. Anonymous-friendly except for streak + LaTeX render.
 */
const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? 'http://localhost:8787';

export type ChallengeDifficulty = 'easy' | 'mid' | 'hard' | 'cumulative';

export interface TodaysChallenge {
  date: string;
  challengeNumber: number;
  courseId: string;
  courseTitle: string;
  topicId: string;
  topicTitle: string;
  difficulty: ChallengeDifficulty;
  problemText: string;
}

export interface ChallengeGradeResult {
  correct: boolean;
  studentAnswer: string;
  feedback: string;
}

export interface StreakState {
  current: number;
  longest: number;
  lastSolvedDate: string | null;
}

export interface ChallengeGradeResponse {
  grade: ChallengeGradeResult;
  streak: StreakState | null;
  challengeNumber: number;
  anonymous: boolean;
  /** Opaque share id minted by the worker on successful grade. Anonymous
   *  submissions don't get one (we don't track anonymous attempts). */
  shareId: string | null;
}

export interface SharedChallenge {
  shareId: string;
  date: string;
  challengeNumber: number;
  courseTitle: string;
  topicTitle: string;
  difficulty: ChallengeDifficulty;
  problemText: string;
  grade: ChallengeGradeResult;
  hasPdf: boolean;
}

/** Public read of a shared attempt. No auth required. */
export async function fetchSharedAttempt(shareId: string): Promise<SharedChallenge | null> {
  const resp = await fetch(`${WORKER_URL}/api/share/${encodeURIComponent(shareId)}`);
  if (!resp.ok) return null;
  return (await resp.json()) as SharedChallenge;
}

/** Direct URL to the PDF for a shared attempt — drop this into an iframe src. */
export function sharedPdfUrl(shareId: string): string {
  return `${WORKER_URL}/api/share/${encodeURIComponent(shareId)}/pdf`;
}

interface AuthOpts {
  getToken: () => Promise<string | null>;
}

async function authHeaders(getToken: AuthOpts['getToken']): Promise<Record<string, string>> {
  const token = await getToken();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export async function fetchTodaysChallenge(): Promise<TodaysChallenge | null> {
  // Public endpoint — no auth needed.
  const resp = await fetch(`${WORKER_URL}/api/challenge/today`, {
    method: 'GET',
  });
  if (!resp.ok) return null;
  return (await resp.json()) as TodaysChallenge;
}

export async function submitChallengeGrade(args: {
  /** Base64-encoded image or PDF. No data: prefix. */
  image: string;
  mediaType: string;
  /** Cloudflare Turnstile token. Required for anonymous, ignored for signed-in. */
  turnstileToken?: string;
  /** From useAuth() — supply null if anonymous. */
  getToken?: AuthOpts['getToken'];
}): Promise<ChallengeGradeResponse> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (args.getToken) {
    const token = await args.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const resp = await fetch(`${WORKER_URL}/api/challenge/grade`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      image: args.image,
      mediaType: args.mediaType,
      turnstileToken: args.turnstileToken,
    }),
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ error: 'unknown' }));
    const err = body as { error?: string; message?: string };
    throw new Error(err.message ?? err.error ?? `grade failed: ${resp.status}`);
  }

  return (await resp.json()) as ChallengeGradeResponse;
}

export interface ChallengeLatexResponse {
  pdfBase64: string;
  cached: boolean;
}

export async function renderChallengeLatex(opts: AuthOpts): Promise<ChallengeLatexResponse> {
  const resp = await fetch(`${WORKER_URL}/api/challenge/latex`, {
    method: 'POST',
    headers: await authHeaders(opts.getToken),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ error: 'unknown' }));
    const err = body as { error?: string; message?: string };
    throw new Error(err.message ?? err.error ?? `latex failed: ${resp.status}`);
  }
  return (await resp.json()) as ChallengeLatexResponse;
}

export async function fetchStreak(opts: AuthOpts): Promise<StreakState | null> {
  const resp = await fetch(`${WORKER_URL}/api/streak`, {
    method: 'GET',
    headers: await authHeaders(opts.getToken),
  });
  if (!resp.ok) return null;
  return (await resp.json()) as StreakState;
}
