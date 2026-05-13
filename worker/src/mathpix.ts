/**
 * Mathpix OCR helper. Used to transcribe a student's handwritten exam
 * attempt into clean text (with math expressions in $...$ delimiters)
 * before Claude grades it. Separating OCR from grading eliminates the
 * "Claude auto-corrects what it sees" failure mode — Mathpix has no
 * math priors and transcribes exactly what's on the page.
 *
 * Auth: Mathpix uses app_id + app_key headers, not bearer tokens.
 * Sign up at mathpix.com → Dashboard → API Keys. Free tier covers
 * 1,000 pages/month.
 */

const MATHPIX_URL = 'https://api.mathpix.com/v3/text';

export interface MathpixCallParams {
  appId: string;
  appKey: string;
  imageBase64: string;
  mediaType: string;
}

export interface MathpixResult {
  ok: boolean;
  status: number;
  /** Transcribed text with math in $...$ inline and $$...$$ display delimiters. */
  text?: string;
  /** Confidence the model has in the transcription (0..1). */
  confidence?: number;
  detail?: string;
}

export async function extractStudentWork(params: MathpixCallParams): Promise<MathpixResult> {
  const { appId, appKey, imageBase64, mediaType } = params;

  const resp = await fetch(MATHPIX_URL, {
    method: 'POST',
    headers: {
      'app_id': appId,
      'app_key': appKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      src: `data:${mediaType};base64,${imageBase64}`,
      // Hybrid text/math output. Mathpix preserves layout (line breaks,
      // problem-number markers) and renders math in delimited LaTeX.
      formats: ['text'],
      ocr: ['math', 'text'],
      math_inline_delimiters: ['$', '$'],
      math_display_delimiters: ['$$', '$$'],
      // Tell Mathpix to be loose with handwriting variations.
      enable_blue_hsv_filter: false,
    }),
  });

  if (!resp.ok) {
    const detail = (await resp.text().catch(() => '')).slice(0, 500);
    return { ok: false, status: resp.status, detail };
  }

  const data = (await resp.json()) as {
    text?: string;
    confidence?: number;
    error?: string;
    error_info?: { message?: string };
  };

  if (data.error) {
    return {
      ok: false,
      status: 502,
      detail: data.error_info?.message ?? data.error,
    };
  }

  const text = (data.text ?? '').trim();
  if (!text) {
    return {
      ok: false,
      status: 502,
      detail: 'Mathpix returned an empty transcription',
    };
  }

  return {
    ok: true,
    status: 200,
    text,
    confidence: data.confidence,
  };
}
