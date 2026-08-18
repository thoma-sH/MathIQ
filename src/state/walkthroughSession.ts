/**
 * Snapshot of an in-progress walkthrough.
 *
 * Everything that defines "where the student is" — the streamed text, the
 * revealed step count, the per-step Why & How expansions — otherwise lives
 * only in `TopicScreen`'s local state. Any remount loses it, and remounts are
 * routine: the app has no URL for the topic route, so a refresh, an OAuth
 * round-trip, or a magic link opened in another tab all drop the student back
 * on the landing page with their work gone.
 *
 * This module is the one place that shape is written down. It is device-local
 * by design — the account-level copy is the history record, written once the
 * walkthrough is complete and the user is signed in.
 */
import {
  KEY_WALKTHROUGH_SESSION,
  readString,
  removeKey,
  writeString,
} from '../lib/storage';
import type { PromptFlow } from './promptFlow';

/** Snapshots older than this are ignored and dropped on the next read. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** A walkthrough long enough to threaten the localStorage quota isn't worth
 *  evicting the user's other preferences for. Roughly 4x the largest real
 *  walkthrough we've seen. */
const MAX_BUFFER_CHARS = 200_000;

/** Bump when the shape changes — older snapshots are then simply discarded
 *  rather than half-restored into a component that no longer matches. */
const VERSION = 1;

export interface WalkthroughSession {
  v: typeof VERSION;
  courseId: string;
  topicId: string;
  /** The problem being walked through. Null for practice runs, which invent
   *  their own and carry it in `buffer`'s preamble instead. */
  problem: string | null;
  practice: boolean;
  mode: PromptFlow;
  buffer: string;
  streamDone: boolean;
  revealCount: number;
  whyHow: Record<number, string>;
  expanded: Record<number, boolean>;
  /** True once this walkthrough has been written to the user's history, so a
   *  restored session can't be saved a second time on every later visit. */
  savedToHistory: boolean;
  updatedAt: number;
}

function isRecordOfString(v: unknown): v is Record<number, string> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Returns null for anything missing, malformed, stale, or from an older
 *  shape. Never throws — a corrupt snapshot must not take down the render. */
export function readSession(): WalkthroughSession | null {
  const raw = readString(KEY_WALKTHROUGH_SESSION);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    removeKey(KEY_WALKTHROUGH_SESSION);
    return null;
  }
  const s = parsed as Partial<WalkthroughSession>;
  if (
    !s ||
    s.v !== VERSION ||
    typeof s.courseId !== 'string' ||
    typeof s.topicId !== 'string' ||
    typeof s.buffer !== 'string' ||
    typeof s.updatedAt !== 'number' ||
    !isRecordOfString(s.whyHow) ||
    !isRecordOfString(s.expanded)
  ) {
    removeKey(KEY_WALKTHROUGH_SESSION);
    return null;
  }
  if (Date.now() - s.updatedAt > MAX_AGE_MS) {
    removeKey(KEY_WALKTHROUGH_SESSION);
    return null;
  }
  return {
    v: VERSION,
    courseId: s.courseId,
    topicId: s.topicId,
    problem: typeof s.problem === 'string' ? s.problem : null,
    practice: s.practice === true,
    mode: s.mode === 'all' ? 'all' : 'step',
    buffer: s.buffer,
    streamDone: s.streamDone === true,
    revealCount: typeof s.revealCount === 'number' ? s.revealCount : 0,
    whyHow: s.whyHow,
    expanded: s.expanded,
    savedToHistory: s.savedToHistory === true,
    updatedAt: s.updatedAt,
  };
}

/** Writes the snapshot, stamping `updatedAt`.
 *
 *  A no-op when there is nothing to save. Deliberately *not* a clear: a topic
 *  the student has only just opened has an empty buffer, and treating that as
 *  "discard" would throw away the in-progress walkthrough they left on a
 *  different topic. Only `clearSession` discards. */
export function writeSession(
  session: Omit<WalkthroughSession, 'v' | 'updatedAt'>,
): void {
  if (!session.buffer.trim()) return;
  if (session.buffer.length > MAX_BUFFER_CHARS) return;
  writeString(
    KEY_WALKTHROUGH_SESSION,
    JSON.stringify({ ...session, v: VERSION, updatedAt: Date.now() }),
  );
}

export function clearSession(): void {
  removeKey(KEY_WALKTHROUGH_SESSION);
}

/** Flips `savedToHistory` in place. Read-modify-write rather than a full
 *  snapshot argument so the caller doesn't have to reassemble state it may no
 *  longer hold. */
export function markSessionSaved(): void {
  const current = readSession();
  if (!current || current.savedToHistory) return;
  writeString(
    KEY_WALKTHROUGH_SESSION,
    JSON.stringify({ ...current, savedToHistory: true }),
  );
}
