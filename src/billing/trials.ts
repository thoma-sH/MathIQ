/**
 * Client API for lifetime per-feature trials.
 *
 * Each signed-in Free user has a small allotment of every premium feature
 * (3 photo / 5 why-how / 2 handwritten / 1 LaTeX / 1 exam / 2 grade) that
 * decrement as they're used. When a count hits 0, the worker returns
 * `402 trial_exhausted` on that endpoint — the frontend surfaces the
 * upgrade modal.
 */
const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? 'http://localhost:8787';

export type TrialFeature =
  | 'photoInput'
  | 'whyHow'
  | 'handwrittenPdf'
  | 'latex'
  | 'examGen'
  | 'examGrade';

export type TrialState = Record<TrialFeature, number>;

export interface TrialsResponse {
  /** Effective tier — Free users see trials decrement, Plus/Pro never spend them. */
  tier: 'anonymous' | 'free' | 'plus' | 'pro';
  remaining: TrialState;
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

export async function fetchTrials(opts: AuthOpts): Promise<TrialsResponse | null> {
  const resp = await fetch(`${WORKER_URL}/api/trials`, {
    method: 'GET',
    headers: await authHeaders(opts.getToken),
  });
  if (!resp.ok) return null;
  return (await resp.json()) as TrialsResponse;
}

/** Friendly display name + feature copy for the upgrade modal. */
export const FEATURE_DISPLAY: Record<TrialFeature, { label: string; capacity: number }> = {
  photoInput: { label: 'Photo input', capacity: 3 },
  whyHow: { label: 'Why & how', capacity: 5 },
  handwrittenPdf: { label: 'Handwritten to PDF', capacity: 2 },
  latex: { label: 'LaTeX Mode', capacity: 1 },
  examGen: { label: 'Exam Mode', capacity: 1 },
  examGrade: { label: 'Exam grading', capacity: 2 },
};
