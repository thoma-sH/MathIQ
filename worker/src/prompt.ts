/**
 * Prompts for Iris, the tutor.
 *
 * Production prompts are loaded from worker secrets. The foundation prompt
 * is split across four secrets (IRIS_FOUNDATION_PROMPT_1 through _4)
 * because Cloudflare Workers caps each secret value at 5 KB on the default
 * plan, and the real foundation is ~19 KB across four logical sections:
 *   _1: identity + ONE LINE principle + step format + voice + audience + notation
 *   _2: rigor framing + WHAT TO SKIP + commit-and-proceed discipline + closing
 *   _3: advanced heuristics by domain (integration, series, linalg, etc.)
 *   _4: algebraic hygiene + sanity checks
 * The four parts are concatenated verbatim with double-newline separators
 * at startup. Fallbacks here are intentionally generic — they keep the
 * system functional for OSS users who clone the repo without setting
 * the secrets.
 *
 * Set the real prompts via:
 *   wrangler secret put IRIS_FOUNDATION_PROMPT_1
 *   wrangler secret put IRIS_FOUNDATION_PROMPT_2
 *   wrangler secret put IRIS_FOUNDATION_PROMPT_3
 *   wrangler secret put IRIS_FOUNDATION_PROMPT_4
 *   wrangler secret put IRIS_WHY_HOW_PROMPT
 *   wrangler secret put IRIS_PRACTICE_PROMPT
 *
 * Locally, set the same keys in `worker/.dev.vars`.
 */
import type { Course, Topic } from './courses';

const FOUNDATION_FALLBACK = `You are a math tutor. Walk a college student through every math problem one step at a time.

FORMAT
Mark each step with \`**Step N.**\` followed by a one-clause reason and the math operation. Use LaTeX with \`$...$\` inline and \`$$...$$\` display delimiters only — never \`\\(...\\)\` or \`\\[...\\]\`. End with \`**Answer:**\` and a 1-3 sentence trigger-to-remember retrospective.

VOICE
Direct. Lead with the move. No cheerleading. Don't ask the student to clarify — if the input is ambiguous, pick a reading and commit.`;

const WHY_HOW_FALLBACK = `Take a step back. For the most recent \`**Step N.**\` you produced, answer in two sections:

**Why we did this.** The strategic motivation and trigger condition that makes this the right move.
**How it works.** The mechanical detail — symbols, sign rules, algebraic moves under the hood.

2–4 short paragraphs. Don't redo or preview steps. Use LaTeX with \`$...$\` delimiters.`;

const PRACTICE_FALLBACK = `Generate ONE new practice problem similar in shape and difficulty to the topic's canonical example, but with different numbers, setup, or framing. Open with exactly:

*Practice problem.* <statement, with LaTeX where needed>

Then immediately begin \`**Step 1.**\` and walk through it following the foundation rules. End with \`**Answer:**\` and the trigger-to-remember retrospective.`;

export interface PromptEnv {
  IRIS_FOUNDATION_PROMPT_1?: string;
  IRIS_FOUNDATION_PROMPT_2?: string;
  IRIS_FOUNDATION_PROMPT_3?: string;
  IRIS_FOUNDATION_PROMPT_4?: string;
  IRIS_WHY_HOW_PROMPT?: string;
  IRIS_PRACTICE_PROMPT?: string;
}

export interface IrisPrompts {
  foundation: string;
  whyHow: string;
  practice: string;
}

/** Dotenv leaves `\"` as literal backslash-quote inside quoted values.
 *  Production secrets (set via `wrangler secret put`) don't have this,
 *  so the replace is a no-op there — safe to run unconditionally. */
function unescapeDevVars(s: string): string {
  return s.replace(/\\"/g, '"');
}

function readPart(raw: string | undefined): string | undefined {
  return raw ? unescapeDevVars(raw).trim() : undefined;
}

export function getIrisPrompts(env: PromptEnv): IrisPrompts {
  const parts = [
    readPart(env.IRIS_FOUNDATION_PROMPT_1),
    readPart(env.IRIS_FOUNDATION_PROMPT_2),
    readPart(env.IRIS_FOUNDATION_PROMPT_3),
    readPart(env.IRIS_FOUNDATION_PROMPT_4),
  ].filter((p): p is string => Boolean(p));
  return {
    foundation: parts.length > 0 ? parts.join('\n\n') : FOUNDATION_FALLBACK,
    whyHow: env.IRIS_WHY_HOW_PROMPT ? unescapeDevVars(env.IRIS_WHY_HOW_PROMPT).trim() : WHY_HOW_FALLBACK,
    practice: env.IRIS_PRACTICE_PROMPT ? unescapeDevVars(env.IRIS_PRACTICE_PROMPT).trim() : PRACTICE_FALLBACK,
  };
}

function buildCourseTopicContext(course: Course, topic: Topic): string {
  return `CURRENT SESSION

You are tutoring a student in **${course.title}**.

The current topic is **${topic.title}**.

Topic blurb: ${topic.blurb}

Strategic anchor for this topic (use this as your guiding heuristic, but explain it inline as you do — don't dump it as a preamble):
${topic.strategicAnchor}

The student may ask about the canonical example problem for this topic, or paste their own problem. Either way, walk them through it one line at a time, following all the principles above.`;
}

export function buildSystemPrompt(prompts: IrisPrompts, course: Course, topic: Topic) {
  return [
    { type: 'text' as const, text: prompts.foundation, cache_control: { type: 'ephemeral' as const } },
    { type: 'text' as const, text: buildCourseTopicContext(course, topic) },
  ];
}

export function buildSystemPromptFlat(prompts: IrisPrompts, course: Course, topic: Topic): string {
  return `${prompts.foundation}\n\n---\n\n${buildCourseTopicContext(course, topic)}`;
}
