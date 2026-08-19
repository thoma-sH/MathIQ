// Single source of truth for `mathiq:`-namespaced localStorage. Keep this
// thin — typed getters/setters per known key plus a generic boolean pair.
// All access is wrapped in try/catch so private-mode failures degrade
// silently instead of crashing the render.

const PREFIX = 'mathiq:';

function safeGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    // ignore — private mode, quota, etc.
  }
}

function safeRemove(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}

export function readBool(key: string): boolean {
  return safeGet(key) === '1';
}

export function writeBool(key: string, value: boolean): void {
  safeSet(key, value ? '1' : '0');
}

export function readString(key: string): string | null {
  return safeGet(key);
}

export function writeString(key: string, value: string): void {
  safeSet(key, value);
}

export function removeKey(key: string): void {
  safeRemove(key);
}

// Returns the unprefixed `mathiq:` key so consumers can match against
// `StorageEvent.key` (which is the *full* key the browser fires).
export function fullKey(key: string): string {
  return PREFIX + key;
}

// Known keys — exported as constants to prevent string typos and to make
// "find usages" trivial when retiring a preference.
export const KEY_TRUST_IRIS = 'trustIris';
export const KEY_TRUST_IRIS_TIP = 'trustIrisTipDismissed';
export const KEY_INSTALL_DISMISSED = 'installPromptDismissed';
export const KEY_PROMPT_FLOW = 'promptFlow';
// Snapshot of an in-progress walkthrough, so a reload or a sign-in round-trip
// lands the student back where they were. See src/state/walkthroughSession.ts.
export const KEY_WALKTHROUGH_SESSION = 'walkthroughSession';
// Preferred difficulty for generated practice problems.
export const KEY_PRACTICE_DIFFICULTY = 'practiceDifficulty';
// Light / dark appearance: 'light' | 'dark', absent means follow the OS.
export const KEY_THEME = 'theme';
