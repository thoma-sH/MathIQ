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

/** Word-level OCR fix Claude wasn't fully confident about. Surfaced as an
 *  inline "Did you mean…?" prompt in the review step. */
export interface UncertainFix {
  id: string;
  original: string;
  applied: string;
  alternatives: string[];
  context: string;
  reason: string;
}

export interface TranscribeResult {
  hwId: string;
  mmd: string;
  uncertain: UncertainFix[];
}

const ALLOWED_MEDIA = new Set([
  'application/pdf',
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  // iOS default photo format. We re-encode to JPEG in the canvas pipeline
  // before sending, so Mathpix never sees raw HEIC.
  'image/heic', 'image/heif',
]);
const MAX_BYTES = 15 * 1024 * 1024;

// Mathpix /v3/text caps at ~5000px on the long edge AND ~5 MB on the
// request body. The body cap binds first for dense content like
// handwritten math on lined paper — JPEG can't compress the high-frequency
// strokes much, so a 4000×3000 q=0.85 page would still ship at 3-4 MB
// pre-base64 and blow the 5 MB ceiling once data-URI wrapping inflates it
// by ~33%. 3000px / q=0.80 keeps a typical page well under 2 MB while
// preserving plenty of resolution for OCR (~1.5 pixels per pencil stroke
// at letter-size paper).
const MAX_IMAGE_LONG_EDGE = 3000;
const RESIZE_JPEG_QUALITY = 0.8;

/** iOS Safari sometimes hands back a File with empty `type` for items
 *  picked from Files.app. Fall back to the filename extension. */
function inferMediaType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic') return 'image/heic';
  if (ext === 'heif') return 'image/heif';
  return '';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new HomeworkError('other', 'Failed to read the file.'));
    reader.onload = () => {
      const url = reader.result as string;
      const commaIdx = url.indexOf(',');
      resolve(commaIdx >= 0 ? url.slice(commaIdx + 1) : url);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Decode an image File using the most EXIF-aware path available. The
 * iPhone landscape-flag problem (photo bytes are landscape, EXIF says
 * "rotate 90°") only resolves correctly when the decoder honours the
 * orientation tag — `createImageBitmap` with `imageOrientation: 'from-image'`
 * does, and modern Safari/Chrome's `<img>` element does by default since
 * around 2020. We try the bitmap path first because it's also the only one
 * that gives us a deterministic ImageBitmap (no layout-side effects).
 */
async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Some older Safari builds throw on the option, and some decoders
      // (HEIC on certain iOS versions) bail here. Fall through to <img>.
    }
  }
  return loadViaImgElement(file);
}

function loadViaImgElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new HomeworkError(
          'bad_request',
          "Couldn't read that image. Try a JPEG or PNG photo.",
        ),
      );
    };
    img.src = url;
  });
}

/**
 * Normalize a homework upload before it hits Mathpix.
 *
 *  - PDFs pass through (Mathpix's /v3/pdf endpoint has its own dimension
 *    handling and accepts the file directly).
 *  - Images are decoded with EXIF orientation applied, downscaled to
 *    {@link MAX_IMAGE_LONG_EDGE} if larger, and re-encoded as JPEG. The
 *    re-encode also strips the EXIF rotation tag — pixels are already in
 *    display-orientation, so Mathpix sees them right-way-up regardless of
 *    whether it honours EXIF.
 *
 * Returns the (possibly rewritten) blob and the media type to advertise
 * to the worker. Images always come back as `image/jpeg` so callers can
 * stop caring about HEIC/HEIF/PNG/WebP source formats.
 */
async function prepareImageForUpload(file: File): Promise<{ blob: Blob; mediaType: string }> {
  if (file.type === 'application/pdf') {
    return { blob: file, mediaType: 'application/pdf' };
  }

  const source = await decodeImage(file);
  const sourceW = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const sourceH = 'naturalHeight' in source ? source.naturalHeight : source.height;
  const longEdge = Math.max(sourceW, sourceH);
  const scale = longEdge > MAX_IMAGE_LONG_EDGE ? MAX_IMAGE_LONG_EDGE / longEdge : 1;
  const targetW = Math.max(1, Math.round(sourceW * scale));
  const targetH = Math.max(1, Math.round(sourceH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new HomeworkError('other', 'Your browser cannot prepare images for upload.');
  }
  ctx.drawImage(source, 0, 0, targetW, targetH);

  if ('close' in source) source.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', RESIZE_JPEG_QUALITY);
  });
  if (!blob) {
    throw new HomeworkError('other', 'Failed to encode the photo for upload.');
  }
  return { blob, mediaType: 'image/jpeg' };
}

interface TranscribeOpts {
  file: File;
  getToken: () => Promise<string | null>;
}

export async function transcribeHomework(opts: TranscribeOpts): Promise<TranscribeResult> {
  const inputMediaType = inferMediaType(opts.file);
  if (!ALLOWED_MEDIA.has(inputMediaType)) {
    throw new HomeworkError(
      'bad_request',
      'Use a PDF or a JPEG/PNG/WebP/HEIC photo of your work.',
    );
  }
  if (opts.file.size > MAX_BYTES) {
    throw new HomeworkError(
      'bad_request',
      'File is too large — try compressing the PDF or lowering photo resolution.',
    );
  }

  const { blob, mediaType } = await prepareImageForUpload(opts.file);
  const base64 = await blobToBase64(blob);
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
    throw new HomeworkError('sign_in_required', 'Sign in to use Handwritten to PDF.');
  }
  if (resp.status === 403) {
    throw new HomeworkError('upgrade_required', 'Handwritten to PDF is a MathIQ+ feature.');
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
  const data = (await resp.json()) as Partial<TranscribeResult>;
  return {
    hwId: data.hwId ?? '',
    mmd: data.mmd ?? '',
    uncertain: Array.isArray(data.uncertain) ? data.uncertain : [],
  };
}

interface UpdateOpts {
  hwId: string;
  mmd: string;
  getToken: () => Promise<string | null>;
}

/** Save a corrected version of the homework transcription back to the
 *  server. Used as the user steps through "Did you mean…?" prompts. */
export async function updateHomeworkMmd(opts: UpdateOpts): Promise<void> {
  const token = await opts.getToken();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(`${WORKER_URL}/api/homework/update`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ hwId: opts.hwId, mmd: opts.mmd }),
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ message: '' }));
    throw new HomeworkError(
      'upstream_error',
      (body as { message?: string }).message ?? 'Failed to save correction.',
    );
  }
}

export interface HomeworkListEntry {
  hwId: string;
  title: string;
  mediaType: string;
  createdAt: number;
  mmdLength: number;
}

interface ListOpts {
  getToken: () => Promise<string | null>;
}

/** Past 90 days of the user's transcriptions. Most recent first. */
export async function listHomework(opts: ListOpts): Promise<HomeworkListEntry[]> {
  const token = await opts.getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const resp = await fetch(`${WORKER_URL}/api/homework/list`, { headers });
  if (!resp.ok) return [];
  const data = (await resp.json()) as { items: HomeworkListEntry[] };
  return data.items;
}

interface GetOpts {
  hwId: string;
  getToken: () => Promise<string | null>;
}

export interface FullHomeworkRecord {
  hwId: string;
  userId: string;
  mmd: string;
  mediaType: string;
  sourceFilename?: string;
  createdAt: number;
}

export async function getHomework(opts: GetOpts): Promise<FullHomeworkRecord | null> {
  const token = await opts.getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const resp = await fetch(
    `${WORKER_URL}/api/homework/get?hwId=${encodeURIComponent(opts.hwId)}`,
    { headers },
  );
  if (!resp.ok) return null;
  const data = (await resp.json()) as { record: FullHomeworkRecord };
  return data.record;
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
