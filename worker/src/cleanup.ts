/**
 * Transcription cleanup pass.
 *
 * Runs after Mathpix. Sends Claude the original page + raw Mathpix output
 * and gets back:
 *
 *   - `cleaned`: full transcription with every OCR fix applied
 *   - `uncertain`: only the fixes Claude wasn't fully confident about —
 *     these are surfaced to the user as inline "Did you mean X?" prompts
 *     before they go to print.
 *
 * Confident fixes (obvious typos like "fimit" → "limit", section-break
 * restoration, paragraph re-flow) get applied silently. The user only
 * sees the prompts that genuinely need a human judgment call.
 *
 * Latency: adds 10-25s per document. Cost: ~$0.03-0.10. Falls back to
 * the raw Mathpix output on any failure so a transient Anthropic blip
 * doesn't kill the whole transcription.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const CLEANUP_MODEL = 'claude-sonnet-4-6';

const CLEANUP_PROMPT = `You are reviewing handwriting-OCR output from a college student's math notes.

You will receive:
1. A photo or PDF page of the original handwritten page.
2. The Mathpix Markdown transcription Mathpix produced from that page.

Mathpix is solid on clean handwriting but consistently fails on:
- English-word typos where the misread shape matches a real word ("limit" → "fimit", "function" → "fimction", "lim" → "Vim").
- Multi-column page layouts flattened into single-column reading-order text — section headers from the right column end up jammed against text from the left.
- Distinct logical sections collapsed with no paragraph break.

Your job: produce a CLEANED version of the transcription, AND flag any specific word-level fixes you were not fully confident about so the student can verify them.

## Output format

Output ONLY a single valid JSON object, no preamble, no markdown fences:

{
  "cleaned": "<the full cleaned Mathpix Markdown, with every fix (confident + uncertain) applied>",
  "uncertain": [
    {
      "id": "u1",
      "original": "<exact text Mathpix produced for this fragment>",
      "applied": "<what you wrote in 'cleaned' for this fragment>",
      "alternatives": ["<a couple other plausible reads if any>"],
      "context": "<a short snippet of the surrounding text so the student can locate it>",
      "reason": "<one-sentence explanation of why you weren't fully confident>"
    }
  ]
}

## Rules

- Preserve every piece of math notation EXACTLY — with ONE narrow exception described below. \`$f(x) = x^2$\` stays \`$f(x) = x^2$\`. Never edit math content because you think the student got the answer wrong — they wrote what they wrote.
- Preserve all \`$...$\` and \`$$...$$\` delimiters and all \\lim_{}, \\sum_{}, \\frac{}{}, etc. exactly as Mathpix produced them.
- Restore section/paragraph breaks where the photo shows visually distinct sections. Use markdown headers (\`##\` for major sections, \`###\` for sub-sections). These are SILENT fixes — do not list them in \`uncertain\`.
- Confident English-word typo fixes (obvious one-answer cases like "fimit" → "limit") are SILENT fixes — do not list them in \`uncertain\` either.

### EXCEPTION — math operator OCR misreads

Mathpix routinely confuses handwritten operators that share simple shapes when the handwriting is fast:

- \`=\` (two short horizontal lines) misread as \`−\` (one horizontal line)
- \`−\` misread as \`=\`
- \`+\` misread as \`×\` or \`t\`
- \`≠\` misread as \`=\`
- decimal \`.\` misread as \`,\` and vice versa

You MAY correct these ONLY when the surrounding math context unambiguously identifies the right operator. The clearest signal: do the arithmetic mentally. If \`3(-2)^4 + 2(-2)^2 - -2 + 1\` evaluates to \`59\` and Mathpix wrote \`... + 1 - 59\`, that final \`-\` was almost certainly a misread \`=\`.

**Always list operator fixes in \`uncertain\`** — never apply silently. Use \`reason: "Mathpix likely misread = as −; left-hand side evaluates to 59"\` so the student can verify in one glance. If the math doesn't compute either way, leave Mathpix's output alone — the student may have written something genuinely wrong, and we don't second-guess their work.

### When to flag uncertain entries

- Multiple plausible reads of a word or operator.
- Unclear handwriting where you had to guess from context.
- Math operator fixes (always — see exception above).

### Things never to do

- Do NOT add new examples, explanations, or content the student didn't write.
- Do NOT summarize, restructure, or paraphrase. Only typo-fix and add structural breaks.
- Do NOT "fix" student math errors. If the equation as written is mathematically wrong but matches the photo, leave it alone.
- If a page is largely unreadable, return Mathpix's output unchanged in \`cleaned\` and an empty \`uncertain\` array.

The "cleaned" field MUST be a complete transcription — the student should be able to print directly from it even without resolving any "uncertain" entries.`;

export interface CleanupParams {
  apiKey: string;
  mediaType: string;
  /** Base64 of the original image or PDF. */
  sourceBase64: string;
  /** The raw Mathpix transcription we want cleaned. */
  rawMmd: string;
}

/**
 * One word-level fix Claude wasn't fully confident about. Surfaced to the
 * user as an inline "Did you mean…?" prompt in the review state.
 */
export interface UncertainFix {
  id: string;
  /** The exact substring of `cleaned` that was changed from `original`. */
  original: string;
  applied: string;
  alternatives: string[];
  context: string;
  reason: string;
}

export interface CleanupResult {
  ok: boolean;
  cleaned?: string;
  uncertain?: UncertainFix[];
  detail?: string;
}

export async function cleanupTranscription(params: CleanupParams): Promise<CleanupResult> {
  const { apiKey, mediaType, sourceBase64, rawMmd } = params;

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
              text: `Mathpix's raw transcription of the page above is:\n\n---\n${rawMmd}\n---\n\nReturn the JSON only.`,
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

  const text = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim();
  if (!text) return { ok: false, detail: 'cleanup returned empty text' };

  // Tolerate stray prose before/after the JSON object. Find the outermost
  // { ... } and parse that.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return { ok: false, detail: 'cleanup did not return JSON' };
  }

  let parsed: { cleaned?: unknown; uncertain?: unknown };
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as { cleaned?: unknown; uncertain?: unknown };
  } catch (e) {
    return { ok: false, detail: `cleanup JSON parse failed: ${(e as Error).message}` };
  }

  const cleaned = typeof parsed.cleaned === 'string' ? parsed.cleaned.trim() : '';
  if (!cleaned) {
    return { ok: false, detail: 'cleanup JSON missing cleaned field' };
  }

  // Normalize the uncertain array — accept missing/malformed entries
  // rather than failing the whole pass.
  const uncertain: UncertainFix[] = [];
  const raw = Array.isArray(parsed.uncertain) ? parsed.uncertain : [];
  for (let i = 0; i < raw.length && i < 25; i++) {
    const r = raw[i] as Record<string, unknown>;
    if (!r || typeof r !== 'object') continue;
    const original = typeof r.original === 'string' ? r.original : '';
    const applied = typeof r.applied === 'string' ? r.applied : '';
    if (!original || !applied) continue;
    uncertain.push({
      id: typeof r.id === 'string' && r.id ? r.id : `u${i + 1}`,
      original,
      applied,
      alternatives: Array.isArray(r.alternatives)
        ? r.alternatives.filter((a): a is string => typeof a === 'string').slice(0, 5)
        : [],
      context: typeof r.context === 'string' ? r.context.slice(0, 240) : '',
      reason: typeof r.reason === 'string' ? r.reason.slice(0, 240) : '',
    });
  }

  return { ok: true, cleaned, uncertain };
}
