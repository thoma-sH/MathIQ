/**
 * Shareable Daily Challenge attempts.
 *
 * When a user grades the daily challenge, we auto-mint an opaque shareId
 * and return it in the grade response. The user copies a share URL
 * containing the id (e.g. https://mathiq.io/share/abc123def4567890) and
 * anyone clicking through gets a public read-only page showing the
 * challenge problem, the sharer's grade, and (if they rendered it) their
 * typeset LaTeX PDF.
 *
 * Privacy posture: the share record holds only `{userId, date}` — no
 * email, name, or anything else identifiable. The public endpoint
 * resolves the userId to the attempt + PDF stored under that user, but
 * never reveals userId to the consumer.
 *
 * KV:
 *   share:SHAREID  →  ShareRecord  (7-day TTL, same as the challenge itself)
 */

const SHARE_KEY_PREFIX = 'share:';
const SHARE_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface ShareRecord {
  shareId: string;
  userId: string;
  date: string; // YYYY-MM-DD
  createdAt: number;
}

function key(shareId: string): string {
  return `${SHARE_KEY_PREFIX}${shareId}`;
}

/**
 * Mint an opaque shareId. 16 random hex chars — 64 bits of entropy, more
 * than enough for the time window we keep these (7 days) and prevents
 * any meaningful enumeration.
 */
function generateShareId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function createShare(
  kv: KVNamespace,
  userId: string,
  date: string,
): Promise<ShareRecord> {
  const shareId = generateShareId();
  const record: ShareRecord = {
    shareId,
    userId,
    date,
    createdAt: Date.now(),
  };
  await kv.put(key(shareId), JSON.stringify(record), {
    expirationTtl: SHARE_TTL_SECONDS,
  });
  return record;
}

export async function getShare(
  kv: KVNamespace,
  shareId: string,
): Promise<ShareRecord | null> {
  // Defensive: don't fetch absurdly long ids — could indicate path injection.
  if (!shareId || shareId.length > 64 || !/^[a-f0-9]+$/i.test(shareId)) {
    return null;
  }
  const raw = await kv.get(key(shareId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ShareRecord;
  } catch {
    return null;
  }
}
