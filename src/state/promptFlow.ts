import { useState } from 'react';

export type PromptFlow = 'step' | 'all';

const KEY = 'mathiq:promptFlow';

function read(): PromptFlow {
  try {
    return localStorage.getItem(KEY) === 'all' ? 'all' : 'step';
  } catch {
    return 'step';
  }
}

export function getPromptFlow(): PromptFlow {
  return read();
}

export function usePromptFlow(): [PromptFlow, (next: PromptFlow) => void] {
  const [value, setValue] = useState<PromptFlow>(read);
  function update(next: PromptFlow) {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // ignore
    }
    setValue(next);
  }
  return [value, update];
}
