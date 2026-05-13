/**
 * Client helper for /api/exam/generate (and /api/exam/grade once that lands).
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

export interface ExamProblemGrade {
  index: number;
  topicId: string;
  topicTitle: string;
  score: number;
  max: number;
  correct: boolean;
  feedback: string;
}

export interface ExamTopicBreakdown {
  topicId: string;
  topicTitle: string;
  score: number;
  max: number;
}

export interface ExamGradeResult {
  examId: string;
  courseId: string;
  problems: ExamProblemGrade[];
  totalScore: number;
  totalMax: number;
  topicBreakdown: ExamTopicBreakdown[];
  studyRecommendations: string[];
  gradedAt: number;
}

export interface ExamListEntry {
  examId: string;
  courseId: string;
  courseTitle: string;
  examTitle: string;
  exam: ExamId;
  problemCount: number;
  createdAt: number;
  graded: boolean;
  totalScore?: number;
  totalMax?: number;
  gradedAt?: number;
}

interface ListOpts {
  courseId?: string;
  getToken: () => Promise<string | null>;
}

export async function listExams(opts: ListOpts): Promise<ExamListEntry[]> {
  const token = await opts.getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const qs = opts.courseId ? `?courseId=${encodeURIComponent(opts.courseId)}` : '';
  const resp = await fetch(`${WORKER_URL}/api/exam/list${qs}`, { headers });
  if (!resp.ok) return [];
  const data = (await resp.json()) as { items: ExamListEntry[] };
  return data.items;
}

interface GetOpts {
  examId: string;
  getToken: () => Promise<string | null>;
}

export async function getExam(
  opts: GetOpts,
): Promise<{ record: ExamRecord; grade: ExamGradeResult | null } | null> {
  const token = await opts.getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const resp = await fetch(
    `${WORKER_URL}/api/exam/get?examId=${encodeURIComponent(opts.examId)}`,
    { headers },
  );
  if (!resp.ok) return null;
  return (await resp.json()) as { record: ExamRecord; grade: ExamGradeResult | null };
}

interface GradeOpts {
  examId: string;
  file: File;
  getToken: () => Promise<string | null>;
}

const ALLOWED_GRADE_MEDIA = new Set([
  'application/pdf',
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
]);
const MAX_GRADE_BYTES = 15 * 1024 * 1024;

/** iOS Safari sometimes hands back File objects with an empty `type` string,
 *  particularly for files picked from Files.app. Fall back to the filename
 *  extension so PDFs and PNGs still get the right MIME type. */
function inferMediaType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  return '';
}

export async function gradeExam(opts: GradeOpts): Promise<ExamGradeResult> {
  const mediaType = inferMediaType(opts.file);
  if (!ALLOWED_GRADE_MEDIA.has(mediaType)) {
    throw new ExamError(
      'bad_request',
      'Use a PDF or a JPEG/PNG/WebP photo of your attempt.',
    );
  }
  if (opts.file.size > MAX_GRADE_BYTES) {
    throw new ExamError(
      'bad_request',
      'File is too large — try compressing the PDF or lowering photo resolution.',
    );
  }

  const { base64 } = await fileToBase64(opts.file);
  const token = await opts.getToken();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(`${WORKER_URL}/api/exam/grade`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ examId: opts.examId, image: base64, mediaType }),
  });

  if (resp.status === 401) {
    throw new ExamError('sign_in_required', 'Sign in to grade your exam.');
  }
  if (resp.status === 403) {
    throw new ExamError('upgrade_required', 'Exam grading is a MathIQ Pro feature.');
  }
  if (resp.status === 404) {
    throw new ExamError(
      'bad_request',
      "That exam expired or wasn't found. Generate a fresh exam to grade.",
    );
  }
  if (resp.status === 429) {
    throw new ExamError('rate_limit', "You've used all your daily Pro slots.");
  }
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ message: '' }));
    throw new ExamError(
      'upstream_error',
      (body as { message?: string }).message ?? 'Grading failed.',
    );
  }
  return (await resp.json()) as ExamGradeResult;
}

function fileToBase64(file: File): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new ExamError('other', 'Failed to read the file.'));
    reader.onload = () => {
      const url = reader.result as string;
      const commaIdx = url.indexOf(',');
      const base64 = commaIdx >= 0 ? url.slice(commaIdx + 1) : url;
      resolve({ base64, mediaType: file.type });
    };
    reader.readAsDataURL(file);
  });
}
