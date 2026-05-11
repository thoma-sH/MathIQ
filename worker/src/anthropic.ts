/**
 * Anthropic streaming helper. Calls /v1/messages with streaming on,
 * returns a plain-text ReadableStream of the model's output.
 */
import type { Course, Topic } from './courses';
import { buildSystemPrompt, PRACTICE_INSTRUCTION, WHY_HOW_INSTRUCTION } from './prompt';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export type WalkthroughAction = 'walkthrough' | 'why-how' | 'practice';

export interface AnthropicCallParams {
  apiKey: string;
  model: 'claude-opus-4-6' | 'claude-sonnet-4-6';
  course: Course;
  topic: Topic;
  problem?: string;
  maxTokens?: number;
  action?: WalkthroughAction;
  /** For action='why-how': the walkthrough text shown to the student so far,
   *  ending with the step we want explained. */
  walkthroughSoFar?: string;
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
    course,
    topic,
    problem,
    maxTokens = 8192,
    action = 'walkthrough',
    walkthroughSoFar,
  } = params;

  const problemText = problem?.trim() || topic.exampleProblem;
  const initialUserText = problem
    ? `Walk me through this ${course.title.toLowerCase()} problem step by step:\n\n${problemText}`
    : `Walk me through the canonical example for ${topic.title} step by step:\n\n${problemText}`;

  const messages = buildConversation(initialUserText, action, walkthroughSoFar);

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
      system: buildSystemPrompt(course, topic),
      messages,
      stream: true,
    }),
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
  initialUserText: string,
  action: WalkthroughAction,
  walkthroughSoFar: string | undefined,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (action === 'why-how' && walkthroughSoFar?.trim()) {
    return [
      { role: 'user', content: initialUserText },
      { role: 'assistant', content: walkthroughSoFar.trim() },
      { role: 'user', content: WHY_HOW_INSTRUCTION },
    ];
  }
  if (action === 'practice') {
    return [{ role: 'user', content: PRACTICE_INSTRUCTION }];
  }
  return [{ role: 'user', content: initialUserText }];
}

function transformAnthropicSse(
  body: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = body.getReader();
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
  });
}
