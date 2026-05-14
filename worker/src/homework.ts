/**
 * Homework Helper persistence — Pro/Plus feature.
 *
 * A homework record stores the Mathpix transcription of the student's
 * uploaded handwritten work. From the same record:
 *   - Plus+Pro can re-render the .mmd as "Plain" PDF via browser print.
 *   - Pro only can compile the .mmd to a real LaTeX PDF via TeXLive.net
 *     (mmd → .tex transform happens at compile time in latex.ts).
 *
 * KV layout (mirrors history.ts / exam.ts patterns):
 *   homework:user:<userId>:<hwId>  →  HomeworkRecord (JSON)
 *
 * 30-day TTL — long enough for a typical assignment window without bloating
 * the namespace.
 */

const TTL_SECONDS = 60 * 60 * 24 * 30;
const KEY_PREFIX = 'homework:user:';

export interface HomeworkRecord {
  hwId: string;
  userId: string;
  /** Mathpix Markdown — text with $...$ inline and $$...$$ display math. */
  mmd: string;
  /** Original upload MIME type (image/* or application/pdf). */
  mediaType: string;
  /** Optional original filename for the printed header. */
  sourceFilename?: string;
  createdAt: number;
}

function key(userId: string, hwId: string): string {
  return `${KEY_PREFIX}${userId}:${hwId}`;
}

export function newHomeworkId(): string {
  // ISO ms-precision (lex-orderable) + 4-char random suffix.
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '');
  const rnd = Math.random().toString(36).slice(2, 6);
  return `${ts}_${rnd}`;
}

export async function saveHomework(
  kv: KVNamespace,
  record: HomeworkRecord,
): Promise<void> {
  await kv.put(key(record.userId, record.hwId), JSON.stringify(record), {
    expirationTtl: TTL_SECONDS,
  });
}

export async function getHomework(
  kv: KVNamespace,
  userId: string,
  hwId: string,
): Promise<HomeworkRecord | null> {
  const raw = await kv.get(key(userId, hwId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as HomeworkRecord;
  } catch {
    return null;
  }
}

/** Overwrite the transcription on an existing record (used when the user
 *  resolves an uncertain correction inline). Preserves TTL by re-saving. */
export async function updateHomeworkMmd(
  kv: KVNamespace,
  userId: string,
  hwId: string,
  newMmd: string,
): Promise<boolean> {
  const existing = await getHomework(kv, userId, hwId);
  if (!existing) return false;
  await saveHomework(kv, { ...existing, mmd: newMmd });
  return true;
}
