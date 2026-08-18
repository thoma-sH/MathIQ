import { describe, it, expect } from 'vitest';
import { parsePracticeDifficulty, practicePrompt, type IrisPrompts } from './prompt';

const PROMPTS: IrisPrompts = {
  foundation: 'FOUNDATION',
  whyHow: 'WHYHOW',
  practice: 'PRACTICE',
  grade: 'GRADE',
};

describe('parsePracticeDifficulty', () => {
  it('defaults to standard when the field is absent', () => {
    expect(parsePracticeDifficulty(undefined)).toBe('standard');
    expect(parsePracticeDifficulty(null)).toBe('standard');
  });

  it('accepts the two non-default levels', () => {
    expect(parsePracticeDifficulty('easier')).toBe('easier');
    expect(parsePracticeDifficulty('harder')).toBe('harder');
  });

  it('degrades garbage to standard rather than throwing', () => {
    // A stale client or a hand-rolled request must never 500 the endpoint.
    expect(parsePracticeDifficulty('banana')).toBe('standard');
    expect(parsePracticeDifficulty(7)).toBe('standard');
    expect(parsePracticeDifficulty({})).toBe('standard');
    expect(parsePracticeDifficulty('STANDARD')).toBe('standard');
  });
});

describe('practicePrompt', () => {
  it('leaves the prompt byte-identical at standard', () => {
    // This is what keeps pre-slider clients and the cached prefix unchanged.
    expect(practicePrompt(PROMPTS, 'standard')).toBe(PROMPTS.practice);
  });

  it('appends a directive for easier and harder', () => {
    const easier = practicePrompt(PROMPTS, 'easier');
    const harder = practicePrompt(PROMPTS, 'harder');
    expect(easier.startsWith('PRACTICE\n\n')).toBe(true);
    expect(harder.startsWith('PRACTICE\n\n')).toBe(true);
    expect(easier).toContain('EASIER');
    expect(harder).toContain('HARDER');
    expect(easier).not.toBe(harder);
  });

  it('keeps harder from inviting contest-style problems', () => {
    // The whole point of the wording; a regression here is invisible until
    // students start reporting unsolvable practice problems.
    expect(practicePrompt(PROMPTS, 'harder')).toContain('NO tricks');
  });
});
