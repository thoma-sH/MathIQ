/**
 * Client helpers for the Homework Helper endpoints.
 *
 * Two flows:
 *  - transcribeHomework: upload an image or PDF, get back the .mmd
 *    transcription + a stable `hwId` to reference it later.
 *  - compileLatexPdf: take an `hwId` and produce a typeset LaTeX PDF
 *    (Pro only).
 */

const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? 'http://localhost:8787';

export type HomeworkErrorKind =
  | 'sign_in_required'
  | 'upgrade_required'
  | 'rate_limit'
  | 'upstream_error'
  | 'bad_request'
  | 'compile_failed'
  | 'other';

export class HomeworkError extends Error {
  readonly kind: HomeworkErrorKind;
  /** When compile_failed, the .tex source is included so the user has a fallback. */
  readonly texSource?: string;
  constructor(kind: HomeworkErrorKind, message: string, texSource?: string) {
    super(message);
    this.kind = kind;
    this.name = 'HomeworkError';
    this.texSource = texSource;
  }
}

export interface TranscribeResult {
  hwId: string;
  mmd: string;
}

const ALLOWED_MEDIA = new Set([
  'application/pdf',
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
]);
const MAX_BYTES = 15 * 1024 * 1024;

/** iOS Safari sometimes hands back a File with empty `type` for items
 *  picked from Files.app. Fall back to the filename extension. */
function inferMediaType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  return '';
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new HomeworkError('other', 'Failed to read the file.'));
    reader.onload = () => {
      const url = reader.result as string;
      const commaIdx = url.indexOf(',');
      resolve(commaIdx >= 0 ? url.slice(commaIdx + 1) : url);
    };
    reader.readAsDataURL(file);
  });
}

interface TranscribeOpts {
  file: File;
  getToken: () => Promise<string | null>;
}

export async function transcribeHomework(opts: TranscribeOpts): Promise<TranscribeResult> {
  const mediaType = inferMediaType(opts.file);
  if (!ALLOWED_MEDIA.has(mediaType)) {
    throw new HomeworkError(
      'bad_request',
      'Use a PDF or a JPEG/PNG/WebP photo of your work.',
    );
  }
  if (opts.file.size > MAX_BYTES) {
    throw new HomeworkError(
      'bad_request',
      'File is too large — try compressing the PDF or lowering photo resolution.',
    );
  }

  const base64 = await fileToBase64(opts.file);
  const token = await opts.getToken();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(`${WORKER_URL}/api/homework/transcribe`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      image: base64,
      mediaType,
      sourceFilename: opts.file.name,
    }),
  });

  if (resp.status === 401) {
    throw new HomeworkError('sign_in_required', 'Sign in to use Homework Helper.');
  }
  if (resp.status === 403) {
    throw new HomeworkError('upgrade_required', 'Homework Helper is a MathIQ+ feature.');
  }
  if (resp.status === 429) {
    throw new HomeworkError('rate_limit', "You've used all your daily slots.");
  }
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ message: '' }));
    throw new HomeworkError(
      'upstream_error',
      (body as { message?: string }).message ?? 'Transcription failed.',
    );
  }
  return (await resp.json()) as TranscribeResult;
}

interface CompileLatexOpts {
  hwId: string;
  title?: string;
  getToken: () => Promise<string | null>;
}

export async function compileLatexPdf(opts: CompileLatexOpts): Promise<{ pdfBase64: string }> {
  const token = await opts.getToken();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(`${WORKER_URL}/api/homework/latex-pdf`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ hwId: opts.hwId, title: opts.title }),
  });

  if (resp.status === 401) {
    throw new HomeworkError('sign_in_required', 'Sign in to use LaTeX Mode.');
  }
  if (resp.status === 403) {
    throw new HomeworkError('upgrade_required', 'LaTeX Mode is a MathIQ Pro feature.');
  }
  if (resp.status === 404) {
    throw new HomeworkError(
      'bad_request',
      "That homework transcription expired. Upload your work again.",
    );
  }
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ message: '', texSource: undefined }));
    const b = body as { message?: string; texSource?: string };
    throw new HomeworkError(
      'compile_failed',
      b.message ?? 'LaTeX compile failed.',
      b.texSource,
    );
  }
  return (await resp.json()) as { pdfBase64: string };
}
