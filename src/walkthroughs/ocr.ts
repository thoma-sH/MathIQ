const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? 'http://localhost:8787';

export type OcrErrorKind = 'sign_in_required' | 'upgrade_required' | 'too_large' | 'unsupported' | 'not_a_math_problem' | 'other';

export class OcrError extends Error {
  kind: OcrErrorKind;
  constructor(kind: OcrErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

/**
 * Read a file as a base64 data URL, return the base64 (without the
 * "data:image/...;base64," prefix) plus the detected media type.
 */
export async function fileToBase64(file: File): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const match = result.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (!match) {
        reject(new Error('Could not read image'));
        return;
      }
      resolve({ mediaType: match[1], base64: match[2] });
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
}

interface AuthOpts {
  getToken: () => Promise<string | null>;
}

export async function extractProblemFromImage(
  opts: AuthOpts & { file: File },
): Promise<string> {
  const { base64, mediaType } = await fileToBase64(opts.file);

  const token = await opts.getToken();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(`${WORKER_URL}/api/ocr`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ image: base64, mediaType }),
  });

  if (resp.status === 401) {
    throw new OcrError('sign_in_required', 'Sign in to use image input.');
  }
  if (resp.status === 403) {
    throw new OcrError('upgrade_required', 'Image input is a MathIQ+ feature.');
  }
  if (resp.status === 413) {
    throw new OcrError('too_large', 'Image is too large — try a smaller photo.');
  }
  if (resp.status === 400) {
    throw new OcrError('unsupported', 'Unsupported image format. Use JPG, PNG, or WebP.');
  }
  if (!resp.ok) {
    throw new OcrError('other', `Image processing failed (${resp.status}).`);
  }

  const body = (await resp.json()) as { problem: string | null; notAMathProblem?: boolean };
  if (body.notAMathProblem || !body.problem) {
    throw new OcrError('not_a_math_problem', "That doesn't look like a math problem.");
  }
  return body.problem;
}
