/**
 * OpenRouter streaming helper. Uses OpenAI-compatible chat-completions API.
 * Same plain-text output shape as the Anthropic helper.
 */
import type { Course, Topic } from './courses';
import { buildSystemPromptFlat, PRACTICE_INSTRUCTION, WHY_HOW_INSTRUCTION } from './prompt';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export type WalkthroughAction = 'walkthrough' | 'why-how' | 'practice';

export interface OpenRouterCallParams {
  apiKey: string;
  /** OpenRouter model id, e.g. "deepseek/deepseek-chat". */
  model: string;
  course: Course;
  topic: Topic;
  problem?: string;
  maxTokens?: number;
  /** Optional — for OpenRouter analytics. */
  appUrl?: string;
  appName?: string;
  action?: WalkthroughAction;
  walkthroughSoFar?: string;
}

export interface OpenRouterCallResult {
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | null;
  detail?: string;
}

export async function callOpenRouterStream(
  params: OpenRouterCallParams,
): Promise<OpenRouterCallResult> {
  const {
    apiKey,
    model,
    course,
    topic,
    problem,
    maxTokens = 8192,
    appUrl,
    appName = 'MathIQ',
    action = 'walkthrough',
    walkthroughSoFar,
  } = params;

  const systemPrompt = buildSystemPromptFlat(course, topic);

  const problemText = problem?.trim() || topic.exampleProblem;
  const initialUserText = problem
    ? `Walk me through this ${course.title.toLowerCase()} problem step by step:\n\n${problemText}`
    : `Walk me through the canonical example for ${topic.title} step by step:\n\n${problemText}`;

  const conversation = buildConversation(initialUserText, action, walkthroughSoFar);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  };
  if (appUrl) headers['HTTP-Referer'] = appUrl;
  if (appName) headers['X-Title'] = appName;

  const resp = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversation,
      ],
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
    body: transformOpenAiSse(resp.body),
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

/**
 * OpenAI-compatible SSE: each event is `data: {choices:[{delta:{content:"..."}}]}`.
 */
function transformOpenAiSse(
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
              const text: string | undefined = event.choices?.[0]?.delta?.content;
              if (text) controller.enqueue(encoder.encode(text));
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
