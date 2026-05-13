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

function generateExamId(): string {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '');
  const entropy = Math.random().toString(36).slice(2, 6);
  return `${ts}_${entropy}`;
}

const EXAM_SYSTEM_PROMPT = `You are an exam-problem author for a college math course. The user will tell you the course, the topic range, and how many problems to produce. Your job: produce a clean, professional, exam-style problem set.

RULES:
- Output ONLY valid JSON conforming to the schema below. No prose before or after. No markdown code fences. Start with { and end with }.
- Every problem must be self-contained — the student should be able to attempt it from the problem statement alone, no figure references or external context.
- No hints, no solutions, no "show your work" reminders. This is an exam, not a tutorial.
- Distribute the 10 problems across the listed topics — roughly equal coverage, no two problems on the same micro-concept.
- Mix difficulty: ~3 routine (warm-ups), ~5 mid-difficulty, ~2 hard. Hard does not mean obscure — it means requires multi-step reasoning.
- Use LaTeX with $...$ inline and $$...$$ display delimiters. Never \\( or \\[.
- Problem text should be 1–3 sentences. Concise. Numbers and expressions should be clean (small integers when possible).

JSON SCHEMA:
{
  "problems": [
    {
      "topicId": "<one of the topicIds I provide>",
      "topicTitle": "<exact topic title>",
      "problemText": "<the problem in markdown+LaTeX, 1-3 sentences>"
    },
    ... (exactly 10 entries)
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

  const userMessage = buildUserMessage(course, exam, topics);

  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: GENERATE_MODEL,
      max_tokens: 4096,
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

  const problems: ExamProblem[] = parsed.problems.slice(0, 10).map((p, i) => ({
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

function buildUserMessage(course: Course, exam: ExamId, topics: Topic[]): string {
  const range =
    exam === 'final'
      ? `all ${topics.length} topics in the course (cumulative)`
      : `the following ${topics.length} topics`;

  const topicList = topics
    .map((t, i) => `${i + 1}. ${t.title} (topicId: "${t.id}") — ${t.blurb}\n   Strategic anchor: ${t.strategicAnchor}`)
    .join('\n');

  return `Produce a professional ${examTitle(exam)} for **${course.title}** covering ${range}:

${topicList}

Produce exactly 10 problems, well-distributed across the listed topics, mixed difficulty. Remember: JSON only, no prose, no code fences.`;
}

function stripCodeFences(s: string): string {
  const trimmed = s.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}
