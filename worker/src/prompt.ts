/**
 * Mirror of src/walkthroughs/prompt.ts. Kept in sync manually for C1.
 */
import type { Course, Topic } from './courses';

export const TUTORING_FOUNDATION = `[redacted — loaded from worker secret in HEAD]`;

export const PRACTICE_INSTRUCTION = `[redacted — loaded from worker secret in HEAD]`;

export const WHY_HOW_INSTRUCTION = `[redacted — loaded from worker secret in HEAD]`;

function buildCourseTopicContext(course: Course, topic: Topic): string {
  return `CURRENT SESSION

You are tutoring a student in **${course.title}**.

The current topic is **${topic.title}**.

Topic blurb: ${topic.blurb}

Strategic anchor for this topic (use this as your guiding heuristic, but explain it inline as you do — don't dump it as a preamble):
${topic.strategicAnchor}

The student may ask about the canonical example problem for this topic, or paste their own problem. Either way, walk them through it one line at a time, following all the principles above.`;
}

export function buildSystemPrompt(course: Course, topic: Topic) {
  return [
    { type: 'text' as const, text: TUTORING_FOUNDATION, cache_control: { type: 'ephemeral' as const } },
    { type: 'text' as const, text: buildCourseTopicContext(course, topic) },
  ];
}

export function buildSystemPromptFlat(course: Course, topic: Topic): string {
  return `${TUTORING_FOUNDATION}\n\n---\n\n${buildCourseTopicContext(course, topic)}`;
}
