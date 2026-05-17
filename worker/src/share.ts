/**
 * Shareable Daily Challenge attempts.
 *
 * When a user grades the daily challenge — signed in OR anonymous — we
 * auto-mint an opaque shareId and return it in the grade response. The
 * user copies a share URL containing the id (e.g.
 * https://mathiq.io/share/abc123def4567890) and anyone clicking through
 * gets a public read-only page showing the challenge problem, the
 * sharer's grade, and their typeset work rendered inline.
 *
 * Privacy posture: the share record is self-contained — it holds the
 * student's submitted work + grade + date, with no userId or email.
 * That means anonymous attempts can be shared too, and the public
 * endpoint never has anything identifiable to leak.
 *
 * KV:
 *   share:SHAREID  →  ShareRecord  (7-day TTL, same as the challenge itself)
 */
import type { ChallengeGradeResult } from './challenge';

const SHARE_KEY_PREFIX = 'share:';
const SHARE_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface ShareRecord {
  shareId: string;
  date: string; // YYYY-MM-DD
  challengeNumber: number;
  studentMmd: string;
  grade: ChallengeGradeResult;
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
  args: {
    date: string;
    challengeNumber: number;
    studentMmd: string;
    grade: ChallengeGradeResult;
  },
): Promise<ShareRecord> {
  const shareId = generateShareId();
  const record: ShareRecord = {
    shareId,
    date: args.date,
    challengeNumber: args.challengeNumber,
    studentMmd: args.studentMmd,
    grade: args.grade,
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
