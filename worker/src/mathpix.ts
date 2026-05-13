/**
 * Mathpix OCR helper. Used to transcribe a student's handwritten exam
 * attempt into clean text (with math expressions in $...$ delimiters)
 * before Claude grades it. Separating OCR from grading eliminates the
 * "Claude auto-corrects what it sees" failure mode — Mathpix has no
 * math priors and transcribes exactly what's on the page.
 *
 * Auth: Mathpix uses app_id + app_key headers, not bearer tokens.
 * Sign up at mathpix.com → Dashboard → API Keys.
 *
 * Two endpoints used:
 *   /v3/text — single image, synchronous, returns transcription in one shot.
 *              Caps at ~5000px on the long edge — taller images fail.
 *   /v3/pdf  — multi-page PDF, async. POST returns a pdf_id; poll the status
 *              endpoint until "completed", then GET the .mmd transcription.
 *              No dimension limit; charged per page.
 */

const MATHPIX_TEXT_URL = 'https://api.mathpix.com/v3/text';
const MATHPIX_PDF_URL = 'https://api.mathpix.com/v3/pdf';

export interface MathpixImageParams {
  appId: string;
  appKey: string;
  imageBase64: string;
  mediaType: string;
}

export interface MathpixPdfParams {
  appId: string;
  appKey: string;
  pdfBase64: string;
}

export interface MathpixResult {
  ok: boolean;
  status: number;
  /** Transcribed text with math in $...$ inline and $$...$$ display delimiters. */
  text?: string;
  /** Confidence the model has in the transcription (0..1). Absent for PDFs. */
  confidence?: number;
  detail?: string;
}

export async function extractStudentWork(params: MathpixImageParams): Promise<MathpixResult> {
  const { appId, appKey, imageBase64, mediaType } = params;

  const resp = await fetch(MATHPIX_TEXT_URL, {
    method: 'POST',
    headers: {
      'app_id': appId,
      'app_key': appKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      src: `data:${mediaType};base64,${imageBase64}`,
      formats: ['text'],
      ocr: ['math', 'text'],
      math_inline_delimiters: ['$', '$'],
      math_display_delimiters: ['$$', '$$'],
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

// ──────────────────────────────────────────────────────────────────────────
// PDF flow — async: POST → poll status → fetch .mmd
// ──────────────────────────────────────────────────────────────────────────

/** Hard ceiling on poll loop. Cloudflare Workers have a 30s wall-time budget
 *  on most plans; we leave ~3s headroom for the rest of the grading flow. */
const PDF_POLL_INTERVAL_MS = 1500;
const PDF_POLL_TIMEOUT_MS = 27_000;

interface PdfStatusResponse {
  status?: 'received' | 'loaded' | 'split' | 'processing' | 'completed' | 'error';
  percent_done?: number;
  num_pages?: number;
  error?: string;
  error_info?: { message?: string };
}

export async function extractStudentWorkFromPdf(params: MathpixPdfParams): Promise<MathpixResult> {
  const { appId, appKey, pdfBase64 } = params;

  // 1) Submit the PDF via multipart/form-data. Mathpix's PDF endpoint
  //    doesn't accept data URIs the way /v3/text does — it wants a file part.
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
  } catch {
    return { ok: false, status: 400, detail: 'PDF base64 decode failed' };
  }

  const form = new FormData();
  form.append(
    'file',
    new Blob([pdfBytes], { type: 'application/pdf' }),
    'attempt.pdf',
  );
  form.append(
    'options_json',
    JSON.stringify({
      conversion_formats: { 'mmd': true },
      math_inline_delimiters: ['$', '$'],
      math_display_delimiters: ['$$', '$$'],
      rm_spaces: false,
    }),
  );

  const submitResp = await fetch(MATHPIX_PDF_URL, {
    method: 'POST',
    headers: { app_id: appId, app_key: appKey },
    body: form,
  });

  if (!submitResp.ok) {
    const detail = (await submitResp.text().catch(() => '')).slice(0, 500);
    return { ok: false, status: submitResp.status, detail };
  }

  const submitData = (await submitResp.json()) as {
    pdf_id?: string;
    error?: string;
    error_info?: { message?: string };
  };
  if (submitData.error || !submitData.pdf_id) {
    return {
      ok: false,
      status: 502,
      detail: submitData.error_info?.message ?? submitData.error ?? 'No pdf_id returned',
    };
  }

  const pdfId = submitData.pdf_id;

  // 2) Poll until status is 'completed' or we hit the timeout.
  const deadline = Date.now() + PDF_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(PDF_POLL_INTERVAL_MS);

    const statusResp = await fetch(`${MATHPIX_PDF_URL}/${pdfId}`, {
      headers: { app_id: appId, app_key: appKey },
    });
    if (!statusResp.ok) {
      const detail = (await statusResp.text().catch(() => '')).slice(0, 500);
      return { ok: false, status: statusResp.status, detail };
    }
    const status = (await statusResp.json()) as PdfStatusResponse;

    if (status.status === 'completed') break;
    if (status.status === 'error') {
      return {
        ok: false,
        status: 502,
        detail: status.error_info?.message ?? status.error ?? 'PDF processing failed',
      };
    }
    // Otherwise: 'received' | 'loaded' | 'split' | 'processing' — keep polling.
  }

  if (Date.now() >= deadline) {
    return {
      ok: false,
      status: 504,
      detail: 'PDF transcription took too long — try a shorter attempt or split it across two uploads',
    };
  }

  // 3) Fetch the Mathpix Markdown transcription.
  const mmdResp = await fetch(`${MATHPIX_PDF_URL}/${pdfId}.mmd`, {
    headers: { app_id: appId, app_key: appKey },
  });
  if (!mmdResp.ok) {
    const detail = (await mmdResp.text().catch(() => '')).slice(0, 500);
    return { ok: false, status: mmdResp.status, detail };
  }
  const text = (await mmdResp.text()).trim();
  if (!text) {
    return {
      ok: false,
      status: 502,
      detail: 'Mathpix returned an empty transcription',
    };
  }

  return { ok: true, status: 200, text };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
