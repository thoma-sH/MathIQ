/**
 * Anthropic streaming helper. Calls /v1/messages with streaming on,
 * returns a plain-text ReadableStream of the model's output.
 */
import type { Course, Topic } from './courses';
import { buildSystemPrompt, type IrisPrompts } from './prompt';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

/**
 * Tail-end format reinforcement. Appended after the foundation + course/topic
 * blocks — closest to the user message, where attention is highest. Smaller
 * Claude models (Haiku) drift from the foundation's ending format and emit
 * mangled markdown tables; the reinforcement reins them in without diluting
 * the main prompt.
 */
const FORMAT_REINFORCEMENT = `Format reinforcement (priority — these override any drift):

1. ENDING. After the final step, close with EXACTLY these two lines and nothing else:
   **Answer:** <final answer, in LaTeX>
   *Trigger to remember:* <1-3 sentence retrospective on the technique's trigger condition>

   Do NOT write "Summary —", "Conclusion", "Final result", "What to remember", "Recap", or any other closing heading. The two lines above are the only permitted close. The literal token \`**Answer:**\` must appear — downstream verification depends on it.

2. NO MARKDOWN TABLES. Pipe-delimited tables (\`| col | col |\`) routinely render as mangled inline text and must not appear. Choose the right alternative based on what the data is:

   - **Numerical/symbolic matrices** (eigenvectors, linear transformations, augmented systems): use a LaTeX matrix wrapped in display-math delimiters. The \`$$\` wrappers are REQUIRED — matrix commands without them render as raw text. Example:
     \`$$\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}$$\`

   - **Categorical or descriptive lists** (regions, cases, subdivisions, scenarios): use a markdown bullet list, NOT a matrix. Matrices are for math, not for "here are the four regions." Example:
     \`- Region 1: $[0,1] \\times [0,1]$\`
     \`- Region 2: $[0,1] \\times [1,2]$\``;

export type WalkthroughAction = 'walkthrough' | 'why-how' | 'practice';

export interface AnthropicCallParams {
  apiKey: string;
  model: 'claude-opus-4-6' | 'claude-sonnet-4-6' | 'claude-haiku-4-5';
  prompts: IrisPrompts;
  course: Course;
  topic: Topic;
  problem?: string;
  maxTokens?: number;
  action?: WalkthroughAction;
  /** For action='why-how': the walkthrough text shown to the student so far,
   *  ending with the step we want explained. */
  walkthroughSoFar?: string;
  /** When the client disconnects mid-stream, this signal aborts both the
   *  initial POST and the in-flight body read so Anthropic stops generating
   *  (and billing) tokens nobody will see. */
  signal?: AbortSignal;
}

export interface AnthropicCallResult {
  ok: boolean;
  status: number;
  /** Plain-text stream of the model's output. Null on error. */
  body: ReadableStream<Uint8Array> | null;
  /** Raw error detail (up to 500 chars). */
  detail?: string;
}

export async function callAnthropicStream(
  params: AnthropicCallParams,
): Promise<AnthropicCallResult> {
  const {
    apiKey,
    model,
    prompts,
    course,
    topic,
    problem,
    maxTokens = 8192,
    action = 'walkthrough',
    walkthroughSoFar,
    signal,
  } = params;

  const problemText = problem?.trim() || topic.exampleProblem;
  const initialUserText = problem
    ? `Walk me through this ${course.title.toLowerCase()} problem step by step:\n\n${problemText}`
    : `Walk me through the canonical example for ${topic.title} step by step:\n\n${problemText}`;

  const messages = buildConversation(prompts, initialUserText, action, walkthroughSoFar);

  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: [
        ...buildSystemPrompt(prompts, course, topic),
        {
          type: 'text' as const,
          text: FORMAT_REINFORCEMENT,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      messages,
      stream: true,
    }),
    signal,
  });

  if (!resp.ok || !resp.body) {
    const detail = await resp.text().catch(() => '');
    return {
      ok: false,
      status: resp.status,
      body: null,
      detail: detail.slice(0, 500),
    };
  }

  return {
    ok: true,
    status: resp.status,
    body: transformAnthropicSse(resp.body),
  };
}

function buildConversation(
  prompts: IrisPrompts,
  initialUserText: string,
  action: WalkthroughAction,
  walkthroughSoFar: string | undefined,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (action === 'why-how' && walkthroughSoFar?.trim()) {
    return [
      { role: 'user', content: initialUserText },
      { role: 'assistant', content: walkthroughSoFar.trim() },
      { role: 'user', content: prompts.whyHow },
    ];
  }
  if (action === 'practice') {
    return [{ role: 'user', content: prompts.practice }];
  }
  return [{ role: 'user', content: initialUserText }];
}

function transformAnthropicSse(
  body: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      reader = body.getReader();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const event = JSON.parse(payload);
              if (
                event.type === 'content_block_delta' &&
                event.delta?.type === 'text_delta'
              ) {
                const text = event.delta.text as string;
                if (text) controller.enqueue(encoder.encode(text));
              }
            } catch {
              // skip malformed event lines
            }
          }
        }
      } catch (err) {
        controller.error(err);
        return;
      }
      controller.close();
    },
    async cancel(reason) {
      // Client disconnected mid-stream — stop reading from Anthropic so
      // they stop generating (and billing) tokens nobody will see.
      if (reader) {
        try {
          await reader.cancel(reason);
        } catch {
          // Reader may already be closed/errored — nothing more to do.
        }
      }
    },
  });
}
