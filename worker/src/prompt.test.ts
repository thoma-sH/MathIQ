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
    expect(parsePracticeDifficulty('hard')).toBe('hard');
    expect(parsePracticeDifficulty('creative')).toBe('creative');
  });

  it('carries the retired slider value over', () => {
    // Clients cached before the rename still send the old slider values.
    // 'harder' has a direct successor; 'easier' has none, so it degrades
    // with everything else.
    expect(parsePracticeDifficulty('harder')).toBe('hard');
    expect(parsePracticeDifficulty('easier')).toBe('standard');
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
    // This is what keeps pre-picker clients and the cached prefix unchanged.
    expect(practicePrompt(PROMPTS, 'standard')).toBe(PROMPTS.practice);
  });

  it('appends a directive for hard and creative', () => {
    const hard = practicePrompt(PROMPTS, 'hard');
    const creative = practicePrompt(PROMPTS, 'creative');
    expect(hard.startsWith('PRACTICE\n\n')).toBe(true);
    expect(creative.startsWith('PRACTICE\n\n')).toBe(true);
    expect(hard).toContain('HARD');
    expect(creative).toContain('CREATIVE');
    expect(hard).not.toBe(creative);
  });

  it('keeps hard from inviting contest-style problems', () => {
    // The whole point of the wording; a regression here is invisible until
    // students start reporting unsolvable practice problems.
    expect(practicePrompt(PROMPTS, 'hard')).toContain('NO tricks');
  });

  it('makes hard demand two composed ideas, not one applied twice', () => {
    const hard = practicePrompt(PROMPTS, 'hard');
    expect(hard).toContain('TWO distinct ideas');
    expect(hard).toContain('genuinely stuck');
  });

  it('keeps creative solvable from the topic alone', () => {
    // Creative is the only level allowed to demand insight, so these guard
    // rails are all that stand between it and an unsolvable puzzle.
    const creative = practicePrompt(PROMPTS, 'creative');
    expect(creative).toContain('DISCOVERABLE');
    expect(creative).toContain("this topic's tools");
    expect(creative).toContain('memorised competition trick');
  });
});
