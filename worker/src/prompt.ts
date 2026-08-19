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
 *   wrangler secret put IRIS_GRADE_PROMPT
 *   wrangler secret put IRIS_GRADE_PROMPT_2
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

const GRADE_FALLBACK = `You are a math exam grader. The user will give you the original problems plus a photo of the student's attempt.

Grade each problem 0-10. Use partial credit for correct technique with arithmetic errors. Read what the student actually wrote; never invent grades.

Output ONLY valid JSON, starting with \`{\` (no preamble, no code fences):

{
  "problems": [
    {
      "index": <number>,
      "problemEcho": "<10-20 chars from the original problem statement>",
      "score": <0-10>,
      "correct": <true if score >= 8>,
      "feedback": "<1-2 sentences referencing student's actual work>"
    }
  ],
  "studyRecommendations": ["<recommendation>", ...]
}`;

export interface PromptEnv {
  IRIS_FOUNDATION_PROMPT_1?: string;
  IRIS_FOUNDATION_PROMPT_2?: string;
  IRIS_FOUNDATION_PROMPT_3?: string;
  IRIS_FOUNDATION_PROMPT_4?: string;
  IRIS_WHY_HOW_PROMPT?: string;
  IRIS_PRACTICE_PROMPT?: string;
  IRIS_GRADE_PROMPT?: string;
  IRIS_GRADE_PROMPT_2?: string;
}

export interface IrisPrompts {
  foundation: string;
  whyHow: string;
  practice: string;
  grade: string;
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
  // Grade prompt: two parts concatenated (rules + professor-level rubric).
  const grade1 = env.IRIS_GRADE_PROMPT ? unescapeDevVars(env.IRIS_GRADE_PROMPT).trim() : undefined;
  const grade2 = env.IRIS_GRADE_PROMPT_2 ? unescapeDevVars(env.IRIS_GRADE_PROMPT_2).trim() : undefined;
  const grade = grade1
    ? `${grade1}${grade2 ? `\n\n${grade2}` : ''}`
    : GRADE_FALLBACK;

  return {
    foundation: parts.length > 0 ? parts.join('\n\n') : FOUNDATION_FALLBACK,
    whyHow: env.IRIS_WHY_HOW_PROMPT ? unescapeDevVars(env.IRIS_WHY_HOW_PROMPT).trim() : WHY_HOW_FALLBACK,
    practice: env.IRIS_PRACTICE_PROMPT ? unescapeDevVars(env.IRIS_PRACTICE_PROMPT).trim() : PRACTICE_FALLBACK,
    grade,
  };
}

/**
 * Practice-problem level, driven by the three buttons under the generator.
 * 'standard' is the historical behavior and deliberately appends nothing — a
 * request without the field produces a byte-identical prompt, so older clients
 * are unaffected and the cached prefix stays warm.
 *
 * HARD stays deliberately unsurprising. Its wording mirrors the Daily
 * Challenge directives in `challenge.ts`, tuned to keep difficulty from
 * drifting into contest-style puzzles — the failure mode students actually
 * complain about.
 *
 * CREATIVE crosses that line on purpose, and is the only level that does. The
 * guard rails move rather than disappear: the insight has to be reachable from
 * the topic, the problem has to stay fully solvable with the topic's own
 * tools, and the answer has to be recognisable when reached. Without those it
 * degenerates into exactly the unsolvable puzzle HARD exists to avoid.
 */
export type PracticeDifficulty = 'standard' | 'hard' | 'creative';

const PRACTICE_DIFFICULTY_DIRECTIVE: Record<PracticeDifficulty, string> = {
  standard: '',
  hard:
    "DIFFICULTY OVERRIDE — HARD: this problem must require at least TWO distinct ideas from the topic, composed, not one idea applied once. Chain them so the output of the first is the input of the second, and make the composition unavoidable: a student who knows only one of the two must get genuinely stuck, not merely take longer. About 5-8 minutes for a prepared student. Still NO tricks, NO non-obvious substitutions, NO contest-style insight — hard means more to carry and more to sequence, not a puzzle to crack. That is what the CREATIVE level is for.",
  creative:
    "DIFFICULTY OVERRIDE — CREATIVE: the topic's mechanical technique must not be sufficient on its own. Build a problem where the routine attack visibly stalls — it starts, and then runs into something it cannot finish — and where getting unstuck takes one genuine idea: a reframing, an exploited symmetry, a well-chosen substitution or decomposition, a quantity worth naming, a step taken in the reverse of the obvious order. Hold it to all of these: the idea must be DISCOVERABLE from the topic itself, never outside knowledge or a memorised competition trick; once seen it must feel inevitable rather than lucky; the problem must be fully solvable with only this topic's tools; and the answer must be clean enough that a student knows when they have it. State the problem plainly and do NOT hint at the idea. Depth, not length — one real insight, not a chain of routine steps. Aim for the kind of problem a good teacher would remember.",
};

/** Resolves the practice prompt for a difficulty. Returns `prompts.practice`
 *  untouched for 'standard'. */
export function practicePrompt(
  prompts: IrisPrompts,
  difficulty: PracticeDifficulty,
): string {
  const directive = PRACTICE_DIFFICULTY_DIRECTIVE[difficulty];
  if (!directive) return prompts.practice;
  return [prompts.practice, directive].join('\n\n');
}

/** Never throws. An absent, unknown, or garbage value resolves to 'standard'
 *  and is served normally — this field grants no access and a deploy that
 *  400s every open tab is a far worse failure than an ignored preference. */
export function parsePracticeDifficulty(raw: unknown): PracticeDifficulty {
  if (raw === 'hard' || raw === 'creative') return raw;
  // Clients cached before the levels were renamed still send the old slider
  // values. 'harder' has a direct successor; 'easier' has none and falls
  // through with everything else.
  if (raw === 'harder') return 'hard';
  return 'standard';
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
