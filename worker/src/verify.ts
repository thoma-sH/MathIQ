/**
 * Post-walkthrough verification. After Iris produces an answer, we re-read
 * the whole walkthrough with a separate model and ask it to confirm the
 * answer is mathematically correct. Output is a quiet positive signal when
 * verified, or a visible warning when the verifier disagrees.
 *
 * The verifier is Sonnet 4.6 (cheap, capable at math, ~$0.01 per check).
 */
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const VERIFY_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 200;

const SYSTEM_PROMPT = `You verify that the final answer in a math walkthrough is mathematically correct.

You are given the walkthrough text. Find the answer (it's marked with **Answer:**) and check whether it actually solves the problem.

Reply with EXACTLY one of:
- CORRECT
- INCORRECT: <one short clause explaining what's wrong, e.g. "off by a sign", "missing constant +C", "discriminant computed wrong">
- UNCLEAR

No other text. No preamble. Don't explain your reasoning. Don't quote the work back.`;

export type Verdict = 'correct' | 'incorrect' | 'unclear';

export interface VerifyResult {
  ok: boolean;
  status: number;
  verdict?: Verdict;
  reason?: string;
  detail?: string;
}

export async function verifyAnswer(args: {
  apiKey: string;
  walkthrough: string;
}): Promise<VerifyResult> {
  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': args.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: VERIFY_MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: args.walkthrough }],
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

  return parseVerdict(text);
}

function parseVerdict(raw: string): VerifyResult {
  const upper = raw.toUpperCase();
  if (upper.startsWith('CORRECT')) {
    return { ok: true, status: 200, verdict: 'correct' };
  }
  if (upper.startsWith('INCORRECT')) {
    const reason = raw.slice('INCORRECT:'.length).trim() || 'check the work';
    return { ok: true, status: 200, verdict: 'incorrect', reason };
  }
  if (upper.startsWith('UNCLEAR')) {
    return { ok: true, status: 200, verdict: 'unclear' };
  }
  return { ok: true, status: 200, verdict: 'unclear' };
}
