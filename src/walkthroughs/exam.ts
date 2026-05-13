/**
 * Client helper for /api/exam/generate.
 */
import type { ExamId } from '../router';

const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? 'http://localhost:8787';

export interface ExamProblem {
  index: number;
  topicId: string;
  topicTitle: string;
  problemText: string;
}

export interface ExamRecord {
  examId: string;
  courseId: string;
  exam: ExamId;
  examTitle: string;
  courseTitle: string;
  problems: ExamProblem[];
  createdAt: number;
}

export type ExamErrorKind =
  | 'sign_in_required'
  | 'upgrade_required'
  | 'rate_limit'
  | 'upstream_error'
  | 'bad_request'
  | 'other';

export class ExamError extends Error {
  readonly kind: ExamErrorKind;
  constructor(kind: ExamErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = 'ExamError';
  }
}

interface GenerateOpts {
  courseId: string;
  exam: ExamId;
  getToken: () => Promise<string | null>;
}

export async function generateExam(opts: GenerateOpts): Promise<ExamRecord> {
  const token = await opts.getToken();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(`${WORKER_URL}/api/exam/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ courseId: opts.courseId, exam: opts.exam }),
  });

  if (resp.status === 401) {
    throw new ExamError('sign_in_required', 'Sign in to use exam mode.');
  }
  if (resp.status === 403) {
    throw new ExamError('upgrade_required', 'Exam mode is a MathIQ Pro feature.');
  }
  if (resp.status === 429) {
    throw new ExamError('rate_limit', "You've used all your daily Pro slots.");
  }
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ message: '' }));
    throw new ExamError(
      'upstream_error',
      (body as { message?: string }).message ?? 'Exam generation failed.',
    );
  }
  return (await resp.json()) as ExamRecord;
}
