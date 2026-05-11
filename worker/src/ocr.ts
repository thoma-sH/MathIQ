/**
 * Image → math problem text extraction via Anthropic vision.
 *
 * The model reads the photo (typed or handwritten math) and returns ONLY
 * the problem text, with LaTeX for any math expressions. The extracted
 * text is then fed into the regular classify + walkthrough flow.
 *
 * Restricted to Plus/Pro tiers: vision tokens are expensive enough that
 * uncapped free-tier usage would dwarf the rest of the cost story.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OCR_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 400;

const SYSTEM_PROMPT = `You read an image of a math problem and extract it as text the student can paste into a tutor.

OUTPUT FORMAT
Output ONLY the problem statement. No preamble, no answer, no commentary, no source citation.

Use LaTeX with $...$ for inline math and $$...$$ for display math. Convert handwritten or typeset notation to standard LaTeX:
- fractions → $\\frac{a}{b}$
- integrals → $\\int_a^b f(x)\\,dx$
- exponents → $x^{n+1}$
- subscripts → $x_n$
- Greek letters → $\\theta$, $\\pi$, $\\alpha$
- summation → $\\sum_{n=1}^\\infty$
- absolute value, modulus, etc.

If the image is rotated or noisy, do your best. If you can't read the math at all, output exactly: NOT_A_MATH_PROBLEM

If the image clearly isn't math (a meme, a photo of food, etc.), output exactly: NOT_A_MATH_PROBLEM`;

export interface OcrCallParams {
  apiKey: string;
  imageBase64: string;
  mediaType: string;
}

export interface OcrResult {
  ok: boolean;
  status: number;
  problem?: string;
  notAMathProblem?: boolean;
  detail?: string;
}

export async function extractProblemFromImage(params: OcrCallParams): Promise<OcrResult> {
  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': params.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: OCR_MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: params.mediaType,
                data: params.imageBase64,
              },
            },
            { type: 'text', text: 'Extract the math problem from this image.' },
          ],
        },
      ],
    }),
  });

  if (!resp.ok) {
    const detail = (await resp.text().catch(() => '')).slice(0, 500);
    return { ok: false, status: resp.status, detail };
  }

  const data = (await resp.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text =
    (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
      .trim();

  if (!text || text === 'NOT_A_MATH_PROBLEM') {
    return { ok: true, status: 200, notAMathProblem: true };
  }
  return { ok: true, status: 200, problem: text };
}
