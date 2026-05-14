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
 * 90-day TTL — matches walkthrough history so a student can pull up
 * anything they've transcribed across a full quarter / semester.
 */

const TTL_SECONDS = 60 * 60 * 24 * 90;
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

/** Compact row used by the Past homework list — no full mmd payload. */
export interface HomeworkListEntry {
  hwId: string;
  title: string;
  mediaType: string;
  createdAt: number;
  mmdLength: number;
}

export async function listHomeworkForUser(
  kv: KVNamespace,
  userId: string,
): Promise<HomeworkListEntry[]> {
  const prefix = `${KEY_PREFIX}${userId}:`;
  const result = await kv.list({ prefix, limit: 100 });
  const entries: HomeworkListEntry[] = [];
  for (const k of result.keys) {
    const raw = await kv.get(k.name);
    if (!raw) continue;
    try {
      const rec = JSON.parse(raw) as HomeworkRecord;
      entries.push({
        hwId: rec.hwId,
        title: titleFromRecord(rec),
        mediaType: rec.mediaType,
        createdAt: rec.createdAt,
        mmdLength: rec.mmd.length,
      });
    } catch {
      // Skip malformed.
    }
  }
  entries.sort((a, b) => b.createdAt - a.createdAt);
  return entries;
}

function titleFromRecord(rec: HomeworkRecord): string {
  if (rec.sourceFilename) {
    return rec.sourceFilename
      .replace(/\.(pdf|png|jpe?g|webp|heic)$/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .trim() || 'Homework';
  }
  return 'Homework';
}
