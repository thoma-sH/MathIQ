/**
 * Walkthrough history, KV-backed.
 *
 * Keys:
 *   history:user:<userId>:<id>  →  full walkthrough record (JSON)
 *
 * `id` is a sortable identifier — ISO-ish ms-precision timestamp + a short
 * random suffix to avoid collisions. Lexicographic order matches creation
 * order, so KV's prefix `list({prefix})` returns items chronologically.
 *
 * Retention: 90 days for everyone. Cheap enough at 50KB per walkthrough.
 */

const TTL_SECONDS = 60 * 60 * 24 * 90;
const KEY_PREFIX = 'history:user:';
const LIST_CAP = 200;

export interface HistoryRecord {
  id: string;
  userId: string;
  courseId: string;
  topicId: string;
  topicTitle: string;
  problem: string | null;
  walkthrough: string;
  modelUsed: string | null;
  createdAt: number;
}

export interface HistoryListItem {
  id: string;
  courseId: string;
  topicId: string;
  topicTitle: string;
  problemSnippet: string | null;
  createdAt: number;
}

function key(userId: string, id: string): string {
  return `${KEY_PREFIX}${userId}:${id}`;
}

export function newHistoryId(): string {
  // ISO ms-precision (so lex order = chronological) + 4-char random suffix.
  const now = new Date().toISOString().replace(/[-:.TZ]/g, '');
  const rnd = Math.random().toString(36).slice(2, 6);
  return `${now}_${rnd}`;
}

export async function saveHistory(
  kv: KVNamespace,
  record: HistoryRecord,
): Promise<void> {
  await kv.put(key(record.userId, record.id), JSON.stringify(record), {
    expirationTtl: TTL_SECONDS,
  });
}

export async function getHistory(
  kv: KVNamespace,
  userId: string,
  id: string,
): Promise<HistoryRecord | null> {
  const raw = await kv.get(key(userId, id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as HistoryRecord;
  } catch {
    return null;
  }
}

export async function listHistory(
  kv: KVNamespace,
  userId: string,
  cursor?: string,
): Promise<{ items: HistoryListItem[]; cursor: string | null }> {
  const prefix = `${KEY_PREFIX}${userId}:`;
  const result = await kv.list({ prefix, cursor, limit: Math.min(LIST_CAP, 50) });

  const items: HistoryListItem[] = [];
  for (const k of result.keys) {
    const raw = await kv.get(k.name);
    if (!raw) continue;
    try {
      const rec = JSON.parse(raw) as HistoryRecord;
      items.push({
        id: rec.id,
        courseId: rec.courseId,
        topicId: rec.topicId,
        topicTitle: rec.topicTitle,
        problemSnippet: rec.problem ? rec.problem.slice(0, 140) : null,
        createdAt: rec.createdAt,
      });
    } catch {
      // skip
    }
  }
  // Reverse so newest is first (lex order is ascending by timestamp).
  items.sort((a, b) => b.createdAt - a.createdAt);

  return {
    items,
    cursor: result.list_complete ? null : result.cursor,
  };
}

export async function deleteHistory(
  kv: KVNamespace,
  userId: string,
  id: string,
): Promise<void> {
  await kv.delete(key(userId, id));
}
