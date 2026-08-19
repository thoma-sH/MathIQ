import { useState } from 'react';
import { KEY_PRACTICE_DIFFICULTY, readString, writeString } from '../lib/storage';

/** What kind of practice problem to invent. 'standard' is the historical
 *  behavior and the only level that leaves the prompt untouched. */
export type PracticeDifficulty = 'standard' | 'hard' | 'creative';

/** Display order, left to right. */
export const DIFFICULTY_ORDER: PracticeDifficulty[] = ['standard', 'hard', 'creative'];

export const DIFFICULTY_LABEL: Record<PracticeDifficulty, string> = {
  standard: 'Standard',
  hard: 'Hard',
  creative: 'Creative',
};

/** Sits on the button itself, so the three are distinguishable without
 *  selecting them one at a time. */
export const DIFFICULTY_CAPTION: Record<PracticeDifficulty, string> = {
  standard: 'Like the example',
  hard: 'Two ideas chained',
  creative: 'Needs an insight',
};

export const DIFFICULTY_HINT: Record<PracticeDifficulty, string> = {
  standard: 'Same shape and difficulty as the topic’s canonical example.',
  hard: 'Composes at least two ideas from the topic — knowing only one leaves you stuck, not just slower.',
  creative: 'The routine attack stalls on purpose. Getting through needs one real idea, discoverable from the topic itself.',
};

function read(): PracticeDifficulty {
  const raw = readString(KEY_PRACTICE_DIFFICULTY);
  if (raw === 'hard' || raw === 'creative') return raw;
  // The slider shipped as easier / standard / harder. Anyone who moved it
  // still has that value stored, and 'harder' has a direct successor worth
  // carrying over. 'easier' has none, so it falls through to standard.
  if (raw === 'harder') return 'hard';
  return 'standard';
}

export function getPracticeDifficulty(): PracticeDifficulty {
  return read();
}

export function usePracticeDifficulty(): [
  PracticeDifficulty,
  (next: PracticeDifficulty) => void,
] {
  const [value, setValue] = useState<PracticeDifficulty>(read);
  function update(next: PracticeDifficulty) {
    writeString(KEY_PRACTICE_DIFFICULTY, next);
    setValue(next);
  }
  return [value, update];
}
