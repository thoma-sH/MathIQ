/**
 * Transcription cleanup pass.
 *
 * Mathpix is the best handwriting-math OCR on the market and still misses
 * two categories of error that can be fixed by ANY model that can see the
 * original page:
 *
 *   1. English-word typos that share a glyph shape with the right word —
 *      "fimit"/"limit", "Vim"/"lim", "fimction"/"function". The pixels are
 *      genuinely ambiguous; context (a calculus document) makes the right
 *      answer obvious.
 *
 *   2. Multi-column layouts flattened into single-column reading-order
 *      output. Mathpix sees "two limit properties" on the left half of the
 *      page and "summary of helpful limit techniques" on the right half
 *      and emits them as adjacent inline text — the structural separation
 *      is lost.
 *
 * Both are fixable with a vision-capable model that has the photo plus the
 * raw Mathpix output and a tight set of rules: preserve math exactly,
 * correct English typos, restore paragraph/section breaks.
 *
 * Latency: adds ~10-25s per document on top of Mathpix. Worth the wait —
 * the unfiltered output is unprofessional enough that Pro users would
 * notice immediately.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const CLEANUP_MODEL = 'claude-sonnet-4-6';

const CLEANUP_PROMPT = `You are reviewing handwriting-OCR output from a college student's math notes.

The user will hand you two things in this order:
1. A photo or PDF page of the original handwritten page.
2. The Mathpix Markdown transcription Mathpix produced from that page.

Mathpix is solid on clean handwriting but consistently fails on:
- English-word typos where the shape matches a wrong word ("limit" → "fimit", "function" → "fimction", "lim" → "Vim").
- Multi-column page layouts flattened into single-column reading-order text — section headers from the right column end up jammed against text from the left.
- Distinct logical sections collapsed with no paragraph break.

Your job: produce a CLEANED version of the transcription that fixes those failures while preserving the student's actual content.

CRITICAL RULES — read every one:

- Preserve every piece of math notation EXACTLY. \`$f(x) = x^2$\` stays \`$f(x) = x^2$\`. Never edit math content even if you think it's wrong — the student wrote what they wrote.
- Preserve all \`$...$\` and \`$$...$$\` delimiters. Preserve all \\lim_{}, \\sum_{}, \\frac{}{}, etc. exactly as Mathpix produced them. Do not "improve" math syntax.
- Fix obvious English-word typos using the math context (the document is about calculus, limits, derivatives, etc.).
- Restore section breaks where the original photo shows visually distinct sections. Use markdown headers (\`##\` for major sections, \`###\` for sub-sections).
- When the original page has columns, write each column as its own block in reading-natural order — don't try to recreate column geometry, just give each section its own paragraph or sub-section.
- Do NOT add new examples, explanations, or any content the student didn't write.
- Do NOT summarize, restructure, or paraphrase. Only typo-fix and add structural breaks.
- Do NOT add a preamble like "Here is the cleaned transcription:" — output the transcription directly.

If a page is largely unreadable, return whatever Mathpix produced unchanged rather than guessing.`;

export interface CleanupParams {
  apiKey: string;
  mediaType: string;
  /** Base64 of the original image or PDF. */
  sourceBase64: string;
  /** The raw Mathpix transcription we want cleaned. */
  rawMmd: string;
}

export interface CleanupResult {
  ok: boolean;
  cleaned?: string;
  detail?: string;
}

export async function cleanupTranscription(params: CleanupParams): Promise<CleanupResult> {
  const { apiKey, mediaType, sourceBase64, rawMmd } = params;

  // Claude accepts PDFs via `document` content blocks and images via `image`
  // blocks. Same model handles both shapes.
  const isPdf = mediaType === 'application/pdf';
  const sourceBlock = isPdf
    ? {
        type: 'document' as const,
        source: { type: 'base64' as const, media_type: 'application/pdf', data: sourceBase64 },
      }
    : {
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: mediaType, data: sourceBase64 },
      };

  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // PDF support is GA on current Anthropic API versions; the beta header
      // is harmless if already GA and required on older accounts.
      'anthropic-beta': 'pdfs-2024-09-25',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: CLEANUP_MODEL,
      max_tokens: 8192,
      system: CLEANUP_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            sourceBlock,
            {
              type: 'text',
              text: `Mathpix's raw transcription of the page above is:\n\n---\n${rawMmd}\n---\n\nReturn the cleaned transcription only.`,
            },
          ],
        },
      ],
    }),
  });

  if (!resp.ok) {
    const detail = (await resp.text().catch(() => '')).slice(0, 500);
    return { ok: false, detail: `cleanup http ${resp.status}: ${detail}` };
  }

  const data = (await resp.json()) as {
    content?: Array<{ type: string; text?: string }>;
    error?: { message?: string };
  };
  if (data.error) {
    return { ok: false, detail: data.error.message ?? 'cleanup error' };
  }

  const cleaned = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim();

  if (!cleaned) {
    return { ok: false, detail: 'cleanup returned empty text' };
  }

  return { ok: true, cleaned };
}
