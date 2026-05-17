import { useState } from 'react';
import { KEY_PROMPT_FLOW, readString, writeString } from '../lib/storage';

export type PromptFlow = 'step' | 'all';

function read(): PromptFlow {
  return readString(KEY_PROMPT_FLOW) === 'all' ? 'all' : 'step';
}

export function getPromptFlow(): PromptFlow {
  return read();
}

export function usePromptFlow(): [PromptFlow, (next: PromptFlow) => void] {
  const [value, setValue] = useState<PromptFlow>(read);
  function update(next: PromptFlow) {
    writeString(KEY_PROMPT_FLOW, next);
    setValue(next);
  }
  return [value, update];
}
