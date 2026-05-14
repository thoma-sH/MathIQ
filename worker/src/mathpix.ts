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
    text: normalizeMathpixOutput(text),
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
      // Mathpix generates .mmd (Mathpix Markdown) for every PDF by default —
      // no conversion_formats needed. The field is only for additional
      // outputs like docx/html/md, which we don't use.
      math_inline_delimiters: ['$', '$'],
      math_display_delimiters: ['$$', '$$'],
      rm_spaces: false,
      // Recover better aligned/multi-line equation structure from the OCR.
      // Without this, equation columns in handwritten notes get flattened
      // into individual lines that miss alignment cues.
      idiomatic_eqn_arrays: true,
      // Don't second-guess our handwriting transcription with autocorrect.
      enable_spell_check: false,
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

  return { ok: true, status: 200, text: normalizeMathpixOutput(text) };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ──────────────────────────────────────────────────────────────────────────
// Post-processing for handwriting OCR quirks
// ──────────────────────────────────────────────────────────────────────────

/**
 * Recover handwriting structure Mathpix's OCR flattens away.
 *
 * Mathpix transcribes WHAT IT SEES line by line — when handwritten math has
 * a stacked subscript like
 *
 *     lim f(x)
 *     x → a
 *
 * the .mmd output has those as two separate text lines, with no
 * `\lim_{x \to a}` grouping. The same notation also sometimes comes back
 * text-concatenated as `limx→a` (Mathpix collapsed the columns into one
 * token but never wrapped it in subscript syntax). Both forms render
 * wrong — the subscript drifts beside the operator instead of below it,
 * or vanishes into the variable name.
 *
 * This function rewrites both patterns into proper LaTeX subscripts so
 * downstream rendering (KaTeX in Plain mode, pdflatex in LaTeX Mode)
 * stacks the subscript like a textbook.
 *
 * Applied to all the stacked-subscript operators that show up in college
 * math notes: lim, sum, prod, int, max, min, sup, inf, argmax, argmin.
 *
 * Also fixes a Mathpix misread we see often: handwritten `lim` (with the
 * dot over `i` reading as a serif crossbar) becomes `Vim`, `Iim`, or
 * `1im` in the OCR.
 */
export function normalizeMathpixOutput(mmd: string): string {
  let s = mmd;

  // Operator name OCR misreads. Stay conservative — only replace when the
  // misread is on its own word boundary.
  s = s.replace(/\bVim\b/g, 'lim');
  s = s.replace(/\bIim\b/g, 'lim');
  s = s.replace(/\b1im\b/g, 'lim');
  s = s.replace(/\blIm\b/g, 'lim');

  const OPS = ['lim', 'sum', 'prod', 'int', 'max', 'min', 'sup', 'inf', 'argmax', 'argmin'];

  // Pattern 1 — stacked subscript on the next line:
  //
  //     lim f(x)
  //     x → a
  //
  // becomes
  //
  //     \lim_{x \to a} f(x)
  //
  // We walk line by line and look for "next-line is JUST a subscript
  // expression" (variable, an arrow, a target). The conservative match
  // avoids gluing two unrelated equations together.
  const lines = s.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1] ?? '';
    const subMatch = next.match(/^\s*([a-zA-Z])\s*(?:→|\\to|->)\s*([^\s][^\n]*?)\s*$/);
    if (subMatch) {
      // Inject the subscript onto the first operator in the line that
      // doesn't already have one.
      const op = pickPendingOp(line, OPS);
      if (op) {
        const variable = subMatch[1];
        const target = subMatch[2].trim();
        const opRe = new RegExp(`\\\\?${op}(?![_a-zA-Z])`);
        out.push(line.replace(opRe, `\\${op}_{${variable} \\to ${target}}`));
        i++; // consume the subscript line
        continue;
      }
    }
    out.push(line);
  }
  s = out.join('\n');

  // Pattern 2 — text-concatenated subscript:
  //
  //     limx→a f(x)        becomes  \lim_{x \to a} f(x)
  //
  // Match the operator immediately followed by a single variable, an
  // arrow (Unicode or LaTeX), and a target (letters, digits, \infty, etc).
  for (const op of OPS) {
    const re = new RegExp(
      `\\\\?\\b${op}([a-zA-Z])\\s*(?:→|\\\\to|->)\\s*((?:\\\\infty|-?\\d+|[a-zA-Z]))`,
      'g',
    );
    s = s.replace(re, (_full, v, target) => `\\${op}_{${v} \\to ${target}}`);
  }

  return s;
}

/** Find the first operator in a line that doesn't already carry a subscript. */
function pickPendingOp(line: string, ops: string[]): string | null {
  for (const op of ops) {
    const re = new RegExp(`\\\\?\\b${op}(?![_a-zA-Z])`);
    if (re.test(line)) return op;
  }
  return null;
}
