import type { Course, Topic } from './types';

/**
 * The static tutoring foundation — ports the math-tutor skill's principles
 * into model-facing instructions. Cached via prompt-cache breakpoint;
 * after the first request in a 5-minute window, this prefix costs ~10%
 * of normal input tokens.
 */
export const TUTORING_FOUNDATION = `[redacted — loaded from worker secret in HEAD]`;

/**
 * Build the per-request system prompt as an array of cached + uncached
 * blocks. The first block (foundation) gets a cache_control marker so it
 * caches across requests. The second block (course/topic context) is
 * small and varies per topic, so it's left uncached.
 */
export function buildSystemPrompt(course: Course, topic: Topic) {
  const courseTopicContext = `CURRENT SESSION

You are tutoring a student in **${course.title}**.

The current topic is **${topic.title}**.

Topic blurb: ${topic.blurb}

Strategic anchor for this topic (use this as your guiding heuristic, but explain it inline as you do — don't dump it as a preamble):
${topic.strategicAnchor}

The student may ask about the canonical example problem for this topic, or paste their own problem. Either way, walk them through it one line at a time, following all the principles above.`;

  return [
    { type: 'text' as const, text: TUTORING_FOUNDATION, cache_control: { type: 'ephemeral' as const } },
    { type: 'text' as const, text: courseTopicContext },
  ];
}
