import { useState } from 'react';
import { KEY_PRACTICE_DIFFICULTY, readString, writeString } from '../lib/storage';

/** How hard a generated practice problem should be, relative to the topic's
 *  canonical example. 'standard' is the historical behavior. */
export type PracticeDifficulty = 'easier' | 'standard' | 'harder';

/** Slider positions, in order. Index doubles as the range input's value. */
export const DIFFICULTY_ORDER: PracticeDifficulty[] = ['easier', 'standard', 'harder'];

export const DIFFICULTY_LABEL: Record<PracticeDifficulty, string> = {
  easier: 'Easier',
  standard: 'Standard',
  harder: 'Harder',
};

export const DIFFICULTY_HINT: Record<PracticeDifficulty, string> = {
  easier: 'One clean step. Small numbers.',
  standard: 'Matches the example problem.',
  harder: 'Two ideas chained. Still no tricks.',
};

function read(): PracticeDifficulty {
  const raw = readString(KEY_PRACTICE_DIFFICULTY);
  return raw === 'easier' || raw === 'harder' ? raw : 'standard';
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
