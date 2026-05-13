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

function stripCodeFences(s: string): string {
  const trimmed = s.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}
