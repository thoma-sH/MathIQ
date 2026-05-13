/**
 * Exam generation. Pro-only feature.
 *
 * Generate: Opus 4.6 produces 10 problems for a given exam range (topics
 * 1-4, 5-8, 9-12, or all 12 for Final). Result is stored in KV under
 * `exam:<examId>` with a 30-day TTL so we can look it up later.
 */
import type { Course, Topic } from './courses';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const GENERATE_MODEL = 'claude-opus-4-6';
const EXAM_KV_TTL_SECONDS = 30 * 24 * 60 * 60;

export type ExamId = 'exam1' | 'exam2' | 'exam3' | 'final';

export interface ExamProblem {
  index: number;
  topicId: string;
  topicTitle: string;
  problemText: string;
}

export interface ExamRecord {
  examId: string;
  courseId: string;
  exam: ExamId;
  examTitle: string;
  courseTitle: string;
  problems: ExamProblem[];
  createdAt: number;
  userId: string;
}

export function topicRangeForExam(course: Course, exam: ExamId): Topic[] {
  if (exam === 'exam1') return course.topics.slice(0, 4);
  if (exam === 'exam2') return course.topics.slice(4, 8);
  if (exam === 'exam3') return course.topics.slice(8, 12);
  return course.topics;
}

export function examTitle(exam: ExamId): string {
  if (exam === 'exam1') return 'Exam 1';
  if (exam === 'exam2') return 'Exam 2';
  if (exam === 'exam3') return 'Exam 3';
  return 'Final Exam';
}

/** Number of problems per exam. Final is bigger because it's cumulative. */
export function problemCountForExam(exam: ExamId): number {
  return exam === 'final' ? 15 : 10;
}

function generateExamId(): string {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '');
  const entropy = Math.random().toString(36).slice(2, 6);
  return `${ts}_${entropy}`;
}

const EXAM_SYSTEM_PROMPT = `You are an exam-problem author for a college math course. The user will tell you the course, the topic range, and the exact number of problems to produce. Your job: produce a clean, professional, accessible exam problem set.

RULES:
- Output ONLY valid JSON conforming to the schema below. No prose before or after. No markdown code fences. Start with { and end with }.
- Every problem must be self-contained — the student should be able to attempt it from the problem statement alone, no figure references or external context.
- No hints, no solutions, no "show your work" reminders. This is an exam, not a tutorial.
- Distribute problems across the listed topics — roughly equal coverage, no two problems on the same micro-concept.

DIFFICULTY — keep it accessible:
- The vast majority (about 70%) should be ROUTINE: direct application of one technique a prepared student has practiced. Standard textbook-style problems, not curveballs.
- About 25% should be MID: require chaining two ideas at most. Still familiar shape, no surprises.
- At most one (only on the cumulative Final) should be slightly harder: requires multi-step reasoning but not trick-style or obscure.
- Students have a scientific calculator (no graphing). Clean exact answers are still preferred where the technique is the lesson; numerical evaluations (e.g. $\\sin(37°)$, $\\ln 8.4$) are fine when they exercise the concept.
- Numbers should be clean — small integers, simple fractions, common angles. The problem should test the technique, not arithmetic stamina.
- Problem text: 1–2 sentences. Concise.

Use LaTeX with $...$ inline and $$...$$ display delimiters. Never \\( or \\[.

JSON SCHEMA:
{
  "problems": [
    {
      "topicId": "<one of the topicIds I provide>",
      "topicTitle": "<exact topic title>",
      "problemText": "<the problem in markdown+LaTeX, 1-2 sentences>"
    },
    ... (exactly the number of entries the user requests)
  ]
}`;

interface GenerateExamParams {
  apiKey: string;
  course: Course;
  exam: ExamId;
  userId: string;
}

export interface GenerateExamResult {
  ok: boolean;
  record?: ExamRecord;
  status: number;
  detail?: string;
}

export async function generateExam(
  params: GenerateExamParams,
  kv: KVNamespace,
): Promise<GenerateExamResult> {
  const { apiKey, course, exam, userId } = params;
  const topics = topicRangeForExam(course, exam);
  const count = problemCountForExam(exam);

  const userMessage = buildUserMessage(course, exam, topics, count);

  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: GENERATE_MODEL,
      // 15-problem final needs more tokens than the 10-problem regular exams
      max_tokens: exam === 'final' ? 6144 : 4096,
      system: EXAM_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    return { ok: false, status: resp.status, detail: detail.slice(0, 500) };
  }

  const data = (await resp.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = data.content?.find((b) => b.type === 'text')?.text ?? '';
  let parsed: { problems?: Array<{ topicId?: string; topicTitle?: string; problemText?: string }> };
  try {
    parsed = JSON.parse(stripCodeFences(text));
  } catch {
    return { ok: false, status: 502, detail: 'Model returned malformed JSON' };
  }
  if (!Array.isArray(parsed.problems) || parsed.problems.length === 0) {
    return { ok: false, status: 502, detail: 'Model returned no problems' };
  }

  const problems: ExamProblem[] = parsed.problems.slice(0, count).map((p, i) => ({
    index: i + 1,
    topicId: typeof p.topicId === 'string' ? p.topicId : topics[i % topics.length].id,
    topicTitle: typeof p.topicTitle === 'string' ? p.topicTitle : topics[i % topics.length].title,
    problemText: typeof p.problemText === 'string' ? p.problemText.trim() : '',
  })).filter((p) => p.problemText.length > 0);

  if (problems.length === 0) {
    return { ok: false, status: 502, detail: 'No usable problems in model output' };
  }

  const record: ExamRecord = {
    examId: generateExamId(),
    courseId: course.id,
    exam,
    examTitle: examTitle(exam),
    courseTitle: course.title,
    problems,
    createdAt: Date.now(),
    userId,
  };

  await kv.put(`exam:${record.examId}`, JSON.stringify(record), {
    expirationTtl: EXAM_KV_TTL_SECONDS,
  });

  return { ok: true, status: 200, record };
}

export async function getExam(kv: KVNamespace, examId: string): Promise<ExamRecord | null> {
  const raw = await kv.get(`exam:${examId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ExamRecord;
  } catch {
    return null;
  }
}

function buildUserMessage(course: Course, exam: ExamId, topics: Topic[], count: number): string {
  const range =
    exam === 'final'
      ? `all ${topics.length} topics in the course (cumulative)`
      : `the following ${topics.length} topics`;

  const topicList = topics
    .map((t, i) => `${i + 1}. ${t.title} (topicId: "${t.id}") — ${t.blurb}\n   Strategic anchor: ${t.strategicAnchor}`)
    .join('\n');

  return `Produce a professional ${examTitle(exam)} for **${course.title}** covering ${range}:

${topicList}

Produce exactly ${count} problems, well-distributed across the listed topics. Keep difficulty accessible: most problems should be routine textbook-style applications, mid-difficulty problems chain at most two ideas, and (only on the cumulative Final) include at most one slightly harder problem. No trick-style or obscure problems.

Remember: JSON only, no prose, no code fences. Exactly ${count} entries in the "problems" array.`;
}

/** Extract JSON from a model response. Handles code fences and prose
 *  before/after the JSON block by finding the outer `{ ... }`. */
function extractJson(s: string): string {
  const trimmed = s.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  const fenced = fenceMatch ? fenceMatch[1].trim() : trimmed;
  const firstBrace = fenced.indexOf('{');
  const lastBrace = fenced.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return fenced.slice(firstBrace, lastBrace + 1);
  }
  return fenced;
}

function stripCodeFences(s: string): string {
  const trimmed = s.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

// ──────────────────────────────────────────────────────────────────────────
// Grading
// ──────────────────────────────────────────────────────────────────────────

const GRADE_MODEL = 'claude-opus-4-6';

export interface ExamProblemGrade {
  index: number;
  topicId: string;
  topicTitle: string;
  score: number;
  max: number;
  correct: boolean;
  feedback: string;
}

export interface ExamTopicBreakdown {
  topicId: string;
  topicTitle: string;
  score: number;
  max: number;
}

export interface ExamGradeResult {
  examId: string;
  courseId: string;
  problems: ExamProblemGrade[];
  totalScore: number;
  totalMax: number;
  topicBreakdown: ExamTopicBreakdown[];
  studyRecommendations: string[];
  gradedAt: number;
}

const GRADE_SYSTEM_PROMPT = `You are Iris, the math grader. The user will give you:
1. The EXACT list of problems on the student's exam (text, listed by index)
2. ONE photo of the student's handwritten attempt

ANTI-HALLUCINATION — read twice before scoring:

- Grade ONLY the problems in the list I provide. Never invent generic problems or grade "what a typical exam looks like."
- For each problem, echo a 10–20 character fragment from the ORIGINAL problem statement into the "problemEcho" field. This is your grounding check.
- If the photo is blank or doesn't show the listed problems, score 0 for every problem with feedback "photo unreadable" — don't fabricate. A wrong honest 0 beats a fake 100.
- If you can read SOME problems, score those; give 0 + "not attempted" to the rest. Never invent answers the student didn't write.

SCORING per problem (out of 10):
- 4 points: Correct final answer (or correct exact answer when arithmetic is reasonable)
- 3 points: Correct technique chosen and applied
- 3 points: Work shown — substitutions, intermediate steps visible

Use partial credit liberally — correct technique with arithmetic errors is worth most of the credit.

Output ONLY valid JSON. The VERY FIRST character of your response must be \`{\`. No preamble, no code fences.

JSON SCHEMA:
{
  "problems": [
    {
      "index": <number matching the original problem number>,
      "problemEcho": "<10-20 chars copied from the original problem statement>",
      "score": <0-10>,
      "correct": <true if score >= 8, else false>,
      "feedback": "<1-2 short sentences; quote student's actual writing>"
    },
    ...
  ],
  "studyRecommendations": ["<recommendation>", ...]
}`;

interface GradeExamParams {
  apiKey: string;
  record: ExamRecord;
  imageBase64: string;
  mediaType: string;
}

export interface GradeExamCallResult {
  ok: boolean;
  status: number;
  result?: ExamGradeResult;
  detail?: string;
}

export async function gradeExam(params: GradeExamParams): Promise<GradeExamCallResult> {
  const { apiKey, record, imageBase64, mediaType } = params;

  const problemsList = record.problems
    .map((p) => `Problem ${p.index} (topic: ${p.topicTitle}): ${p.problemText}`)
    .join('\n\n');

  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: GRADE_MODEL,
      max_tokens: 4096,
      system: GRADE_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Here are the ${record.problems.length} original problems for ${record.courseTitle} ${record.examTitle}:\n\n${problemsList}\n\nAnd here is the photo of my attempt. Grade each problem.`,
            },
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: imageBase64 },
            },
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
  const text = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim();

  let parsed: {
    problems?: Array<{
      index?: number;
      problemEcho?: string;
      score?: number;
      correct?: boolean;
      feedback?: string;
    }>;
    studyRecommendations?: string[];
  };
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    console.error('[exam-grade] malformed JSON. First 600 chars:', text.slice(0, 600));
    return { ok: false, status: 502, detail: 'Grader returned malformed JSON' };
  }

  if (!Array.isArray(parsed.problems)) {
    return { ok: false, status: 502, detail: 'Grader returned no problems' };
  }

  // Validate each grade's problemEcho against the canonical problem text.
  // Normalization strips all non-alphanumeric so `n!/5^n` matches `\frac{n!}{5^n}`.
  // Match succeeds if any 5+ char window from the echo appears in the original.
  const normMatch = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const echoMatches = (echo: string, original: string): boolean => {
    const e = normMatch(echo);
    const o = normMatch(original);
    if (e.length < 5) return false;
    if (o.includes(e)) return true;
    for (let i = 0; i + 5 <= e.length; i++) {
      if (o.includes(e.slice(i, i + 5))) return true;
    }
    return false;
  };

  let hallucinationCount = 0;
  const problemsByIndex = new Map(record.problems.map((p) => [p.index, p]));
  for (const g of parsed.problems) {
    if (typeof g?.index !== 'number') continue;
    const orig = problemsByIndex.get(g.index);
    if (!orig) continue;
    const echo = typeof g.problemEcho === 'string' ? g.problemEcho.trim() : '';
    if (echo.length === 0) {
      hallucinationCount++;
      continue;
    }
    if (!echoMatches(echo, orig.problemText)) {
      hallucinationCount++;
    }
  }
  if (hallucinationCount > record.problems.length / 3) {
    console.error(
      '[exam-grade] hallucination detected:',
      hallucinationCount,
      'of',
      record.problems.length,
      'echoes failed. Raw response (first 800 chars):',
      text.slice(0, 800),
    );
    return {
      ok: false,
      status: 502,
      detail:
        'Grader hallucinated — could not verify the photo matches the exam problems. Try a clearer or better-lit photo.',
    };
  }

  const grades: ExamProblemGrade[] = record.problems.map((orig) => {
    const g = parsed.problems!.find((q) => q.index === orig.index);
    const score = clamp(typeof g?.score === 'number' ? g.score : 0, 0, 10);
    return {
      index: orig.index,
      topicId: orig.topicId,
      topicTitle: orig.topicTitle,
      score,
      max: 10,
      correct: typeof g?.correct === 'boolean' ? g.correct : score >= 8,
      feedback: typeof g?.feedback === 'string' && g.feedback.trim()
        ? g.feedback.trim()
        : 'Not attempted.',
    };
  });

  const totalScore = grades.reduce((s, g) => s + g.score, 0);
  const totalMax = grades.length * 10;

  const topicScores = new Map<string, { topicTitle: string; score: number; max: number }>();
  for (const g of grades) {
    const existing = topicScores.get(g.topicId);
    if (existing) {
      existing.score += g.score;
      existing.max += g.max;
    } else {
      topicScores.set(g.topicId, { topicTitle: g.topicTitle, score: g.score, max: g.max });
    }
  }
  const topicBreakdown: ExamTopicBreakdown[] = Array.from(topicScores.entries()).map(
    ([topicId, v]) => ({ topicId, topicTitle: v.topicTitle, score: v.score, max: v.max }),
  );

  const studyRecommendations = Array.isArray(parsed.studyRecommendations)
    ? parsed.studyRecommendations.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 6)
    : [];

  return {
    ok: true,
    status: 200,
    result: {
      examId: record.examId,
      courseId: record.courseId,
      problems: grades,
      totalScore,
      totalMax,
      topicBreakdown,
      studyRecommendations,
      gradedAt: Date.now(),
    },
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
