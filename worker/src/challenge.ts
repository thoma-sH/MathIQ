/**
 * Daily Challenge — one math problem per day, shared by every user.
 *
 * Generated on the first /api/challenge/today request after UTC midnight,
 * cached in KV under `challenge:YYYY-MM-DD` for 7 days. All subsequent
 * requests that day serve from cache. No cron; lazy init.
 *
 * Difficulty rotates by day of the week:
 *   Mon-Tue → easy
 *   Wed-Thu → mid
 *   Fri-Sat → hard
 *   Sun     → cumulative (harder, multi-step)
 *
 * Topic is picked uniformly at random across the 109-topic catalog at
 * generation time. Random selection happens server-side once per day, so
 * every visitor sees the same problem.
 */
import { COURSES, COURSES_BY_ID, type Course, type Topic } from './courses';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const GENERATE_MODEL = 'claude-opus-4-6';
const GRADE_MODEL = 'claude-sonnet-4-6';
const CHALLENGE_KV_TTL_SECONDS = 7 * 24 * 60 * 60;
const CHALLENGE_KEY_PREFIX = 'challenge:';

export type ChallengeDifficulty = 'easy' | 'mid' | 'hard' | 'cumulative';

export interface ChallengeRecord {
  /** Date key in YYYY-MM-DD (UTC). Doubles as the canonical "challenge number" — count days since 2026-01-01 for #N. */
  date: string;
  courseId: string;
  courseTitle: string;
  topicId: string;
  topicTitle: string;
  difficulty: ChallengeDifficulty;
  problemText: string;
  /** Short hint about the answer form (e.g., "Final answer is an integer"). Helps the grader. */
  answerForm: string;
  /** The exact correct final answer in plain text (no $...$ delimiters). Stored at
   *  generation time so the grader compares against a fixed truth instead of
   *  re-deriving on every request. Optional only for backwards-compat with
   *  pre-2026-05 records; new ones always include it. */
  canonicalAnswer?: string;
  createdAt: number;
}

function key(date: string): string {
  return `${CHALLENGE_KEY_PREFIX}${date}`;
}

export function todayUtcDateKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Challenge "number" — days since 2026-01-01 (Mathiq's reference start). */
export function challengeNumberFor(date: string): number {
  const REF = Date.UTC(2026, 0, 1);
  const [y, m, day] = date.split('-').map(Number);
  const target = Date.UTC(y, m - 1, day);
  return Math.floor((target - REF) / (24 * 60 * 60 * 1000)) + 1;
}

export function difficultyForDate(date: string): ChallengeDifficulty {
  // 0=Sun, 1=Mon, ..., 6=Sat
  const [y, m, day] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  if (dow === 0) return 'cumulative';
  if (dow === 1 || dow === 2) return 'easy';
  if (dow === 3 || dow === 4) return 'mid';
  return 'hard';
}

/**
 * Day-of-week → course assignment. Gives the daily a recognizable
 * cadence: "Monday is always Algebra day." Saturday and Sunday are
 * 50/50 toss-ups for variety on the bonus days.
 */
function courseForDate(date: string): Course {
  const [y, m, day] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  switch (dow) {
    case 1:
      return COURSES_BY_ID['algebra'];
    case 2:
      return COURSES_BY_ID['precalc'];
    case 3:
      return COURSES_BY_ID['calc-1'];
    case 4:
      return COURSES_BY_ID['calc-2'];
    case 5:
      return COURSES_BY_ID['calc-3'];
    case 6:
      return Math.random() < 0.5
        ? COURSES_BY_ID['discrete']
        : COURSES_BY_ID['combinatorics'];
    default:
      // Sunday: linear-algebra OR differential-equations
      return Math.random() < 0.5
        ? COURSES_BY_ID['linear-algebra']
        : COURSES_BY_ID['differential-equations'];
  }
}

function pickTopicFromCourse(course: Course): Topic {
  const idx = Math.floor(Math.random() * course.topics.length);
  return course.topics[idx];
}

/**
 * Per-course difficulty caps. Some courses (DE, Calc 3) produce problems
 * that are too hard for a *daily* even at the lowest difficulty — capping
 * here clamps the natural day-of-week difficulty so a Friday Calc 3 lands
 * at easy instead of hard, etc.
 */
const COURSE_MAX_DIFFICULTY: Record<string, ChallengeDifficulty> = {
  algebra: 'cumulative',
  precalc: 'cumulative',
  'calc-1': 'cumulative',
  'calc-2': 'cumulative',
  'calc-3': 'easy',
  discrete: 'cumulative',
  combinatorics: 'mid',
  'linear-algebra': 'mid',
  'differential-equations': 'easy',
};

const DIFFICULTY_RANK: Record<ChallengeDifficulty, number> = {
  easy: 0,
  mid: 1,
  hard: 2,
  cumulative: 3,
};

function effectiveDifficulty(
  natural: ChallengeDifficulty,
  courseId: string,
): ChallengeDifficulty {
  const cap = COURSE_MAX_DIFFICULTY[courseId] ?? 'mid';
  return DIFFICULTY_RANK[natural] <= DIFFICULTY_RANK[cap] ? natural : cap;
}

const DIFFICULTY_DIRECTIVE: Record<ChallengeDifficulty, string> = {
  easy: 'EASY: a routine one-step application of the topic. A prepared student should solve in under 2 minutes. Use small integers and the cleanest possible setup.',
  mid: 'MID: requires chaining two ideas from the topic, but no surprises. About 4 minutes of work for a prepared student.',
  hard: 'HARD: a careful two-step application of the topic with one tidy moving part. NO tricks, NO non-obvious substitutions, NO contest-style insight. About 5–7 minutes for a prepared student. If the topic\'s natural problems take longer than this, soften the numbers and skip the harder variants.',
  cumulative: 'CUMULATIVE: a review-style problem that touches this topic and one familiar prerequisite. The student should recognize both ideas immediately — no "aha" required. About 6–8 minutes of work. Solid Saturday-afternoon difficulty, not Sunday-night cramming.',
};

const CHALLENGE_GENERATION_PROMPT = `You are an exam-problem author writing the MathIQ Daily Challenge — one single math problem shown to every user that day. Quality matters: this is a public-facing problem people will share.

RULES:
- The problem must be SELF-CONTAINED — solvable from the statement alone, no figure references.
- No hints, no solutions, no "show your work" reminders in the problem text.
- Problem text: 1–2 sentences max. Concise.
- Use LaTeX with $...$ for inline and $$...$$ for display. Never \\( or \\[.
- Clean numbers — small integers, simple fractions, common angles. Test the technique, not arithmetic stamina.
- Clean, unambiguous final answer. Solve the problem yourself to determine the canonical answer before submitting — the grader will compare student answers against this value.
- Submit via the submit_challenge tool. The tool's input_schema is the contract.`;

async function generateChallenge(
  apiKey: string,
  course: Course,
  topic: Topic,
  difficulty: ChallengeDifficulty,
  date: string,
): Promise<ChallengeRecord | null> {
  const userMessage = `Course: ${course.title} (${course.id})
Topic: ${topic.title} (${topic.id})
Topic blurb: ${topic.blurb}
Topic strategic anchor: ${topic.strategicAnchor}

DIFFICULTY: ${DIFFICULTY_DIRECTIVE[difficulty]}

Write one problem for this topic at this difficulty. Return the JSON only.`;

  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: GENERATE_MODEL,
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: CHALLENGE_GENERATION_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
      tools: [
        {
          name: 'submit_challenge',
          description:
            'Submit the daily challenge problem and the exact correct answer that students should arrive at.',
          input_schema: {
            type: 'object',
            properties: {
              problemText: {
                type: 'string',
                description: 'The problem statement in markdown + inline/display LaTeX.',
              },
              answerForm: {
                type: 'string',
                description:
                  "One sentence: what shape the final answer takes — e.g. 'An integer.' or 'A simplified fraction p/q.' or 'A function f(x) in closed form.'",
              },
              canonicalAnswer: {
                type: 'string',
                description:
                  "The exact correct final answer in plain text (no $...$ delimiters). Compute it yourself before submitting. Examples: '-59', 'x = 4', '362880', '1/2', 'pi/3', 'f(x) = e^{2x}'.",
              },
            },
            required: ['problemText', 'answerForm', 'canonicalAnswer'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'submit_challenge' },
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    console.error('[challenge] generation http failed', resp.status, detail.slice(0, 300));
    return null;
  }

  const data = (await resp.json()) as {
    content?: Array<{
      type: string;
      input?: { problemText?: string; answerForm?: string; canonicalAnswer?: string };
    }>;
  };
  const toolUse = data.content?.find((b) => b.type === 'tool_use');
  const input = toolUse?.input;
  if (!input || typeof input.problemText !== 'string' || input.problemText.trim().length === 0) {
    console.error('[challenge] generator returned no tool_use or empty problem');
    return null;
  }

  return {
    date,
    courseId: course.id,
    courseTitle: course.title,
    topicId: topic.id,
    topicTitle: topic.title,
    difficulty,
    problemText: input.problemText.trim(),
    answerForm:
      typeof input.answerForm === 'string' && input.answerForm.trim().length > 0
        ? input.answerForm.trim()
        : 'Final answer.',
    canonicalAnswer:
      typeof input.canonicalAnswer === 'string' && input.canonicalAnswer.trim().length > 0
        ? input.canonicalAnswer.trim()
        : undefined,
    createdAt: Date.now(),
  };
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  // Common patterns Claude sometimes wraps JSON in despite the instruction.
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  if (fenceMatch) return fenceMatch[1].trim();
  return trimmed;
}

/**
 * Main entry point. Returns today's challenge — generating it if it's the
 * first request after UTC midnight, otherwise serving from KV.
 *
 * KV CAS isn't available in Workers, but the cost of a race (two near-
 * simultaneous first-of-day requests both generating) is bounded: each
 * generates one problem, the second overwrites the first. Tolerable.
 */
export async function getOrGenerateTodaysChallenge(
  env: { ANTHROPIC_API_KEY: string; USAGE: KVNamespace },
  date: string = todayUtcDateKey(),
): Promise<ChallengeRecord | null> {
  const existing = await env.USAGE.get(key(date));
  if (existing) {
    try {
      return JSON.parse(existing) as ChallengeRecord;
    } catch {
      // Corrupt cache — fall through and regenerate.
    }
  }

  const course = courseForDate(date);
  const topic = pickTopicFromCourse(course);
  const natural = difficultyForDate(date);
  const difficulty = effectiveDifficulty(natural, course.id);
  const record = await generateChallenge(
    env.ANTHROPIC_API_KEY,
    course,
    topic,
    difficulty,
    date,
  );
  if (!record) return null;

  await env.USAGE.put(key(date), JSON.stringify(record), {
    expirationTtl: CHALLENGE_KV_TTL_SECONDS,
  });
  return record;
}

// ─── Grading ──────────────────────────────────────────────────────────

export interface ChallengeGradeResult {
  correct: boolean;
  studentAnswer: string;
  feedback: string;
}

const GRADE_SYSTEM_PROMPT = `You are grading a single math problem. The student has submitted handwritten work that has been OCR'd to text. Your job: determine if their final answer is correct, identify what answer they arrived at, and give one sentence of feedback.

RULES:
- Output ONLY valid JSON conforming to the schema below. No prose before or after. No code fences.
- Be charitable about notation: \\frac{a}{b} and a/b are the same. 0.5 and 1/2 are the same. x = 4 and "the answer is 4" are the same.
- "correct" is true if the student's final answer matches the canonical answer, even if work has small errors along the way. We grade the answer, not the work.
- If the student's work is unreadable or didn't reach a final answer, mark correct=false and say so in feedback.

JSON SCHEMA:
{
  "correct": <boolean>,
  "studentAnswer": "<short string, the final value/expression the student arrived at>",
  "feedback": "<one sentence: what they got right, OR where they went wrong>"
}`;

export type ChallengeInputKind = 'photo' | 'typed';

export async function gradeChallengeSubmission(
  apiKey: string,
  record: ChallengeRecord,
  studentWorkText: string,
  inputKind: ChallengeInputKind = 'photo',
): Promise<ChallengeGradeResult | null> {
  // Canonical answer is stored at generation time. When present, the grader
  // compares against it (fixed truth). When absent (legacy records), the
  // grader has to derive — that path is more error-prone, so newer records
  // always include canonicalAnswer.
  const canonicalLine = record.canonicalAnswer
    ? `CANONICAL ANSWER (already verified — trust this): ${record.canonicalAnswer}`
    : `EXPECTED ANSWER FORM: ${record.answerForm}`;
  const gradingNote = record.canonicalAnswer
    ? `Compare the student's answer to the canonical answer above. Be charitable about notation (sign placement, fraction vs decimal, equivalent forms — e.g. -59 = "negative 59", 1/2 = 0.5, x=4 = "the answer is 4"). The canonical answer IS the truth — do not second-guess it.`
    : `Compute the correct answer yourself, then compare to the student's submission with notation tolerance.`;

  const userMessage =
    inputKind === 'typed'
      ? `PROBLEM:
${record.problemText}

${canonicalLine}

STUDENT'S TYPED FINAL ANSWER (just the answer — there is no work to inspect):
---
${studentWorkText}
---

${gradingNote}`
      : `PROBLEM:
${record.problemText}

${canonicalLine}

STUDENT'S OCR'd WORK:
---
${studentWorkText}
---

Grade this submission. ${gradingNote}`;

  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: GRADE_MODEL,
      max_tokens: 512,
      system: [
        {
          type: 'text',
          text: GRADE_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
      // Forced tool call — structured outputs without prose-escape risk.
      // Sonnet 4.6 dropped support for assistant message prefill; tool use
      // is the supported path to guaranteed JSON.
      tools: [
        {
          name: 'submit_grade',
          description:
            "Submit the grade for the student's answer. Always call this — never reply in prose.",
          input_schema: {
            type: 'object',
            properties: {
              correct: {
                type: 'boolean',
                description:
                  "Whether the student's final answer matches the canonical answer (with notation tolerance).",
              },
              studentAnswer: {
                type: 'string',
                description:
                  "Short string of the student's final answer, e.g. 'x = 4', '362880', '1/2'.",
              },
              feedback: {
                type: 'string',
                description:
                  'One sentence: what they got right OR where they went wrong.',
              },
            },
            required: ['correct', 'studentAnswer', 'feedback'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'submit_grade' },
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    console.error('[challenge-grade] http failed', resp.status, detail.slice(0, 300));
    return null;
  }

  const data = (await resp.json()) as {
    content?: Array<{
      type: string;
      input?: { correct?: boolean; studentAnswer?: string; feedback?: string };
    }>;
  };
  const toolUse = data.content?.find((b) => b.type === 'tool_use');
  if (!toolUse?.input || typeof toolUse.input.correct !== 'boolean') {
    console.error('[challenge-grade] no tool_use in response');
    return null;
  }

  return {
    correct: toolUse.input.correct,
    studentAnswer:
      typeof toolUse.input.studentAnswer === 'string' ? toolUse.input.studentAnswer : '',
    feedback: typeof toolUse.input.feedback === 'string' ? toolUse.input.feedback : '',
  };
}

// ─── Per-user attempt persistence ────────────────────────────────────

const ATTEMPT_KEY_PREFIX = 'challenge-attempt:user:';
const ATTEMPT_KV_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface ChallengeAttempt {
  userId: string;
  date: string;
  studentMmd: string;
  grade: ChallengeGradeResult;
  submittedAt: number;
}

function attemptKey(userId: string, date: string): string {
  return `${ATTEMPT_KEY_PREFIX}${userId}:${date}`;
}

export async function saveAttempt(
  kv: KVNamespace,
  attempt: ChallengeAttempt,
): Promise<void> {
  await kv.put(attemptKey(attempt.userId, attempt.date), JSON.stringify(attempt), {
    expirationTtl: ATTEMPT_KV_TTL_SECONDS,
  });
}

export async function getAttempt(
  kv: KVNamespace,
  userId: string,
  date: string,
): Promise<ChallengeAttempt | null> {
  const raw = await kv.get(attemptKey(userId, date));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ChallengeAttempt;
  } catch {
    return null;
  }
}
