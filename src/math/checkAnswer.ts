import type { AnswerInput } from './types';

const norm = (s: string) =>
  String(s).toLowerCase().replace(/\s+/g, '').replace(/×/g, '*');

export function checkAnswer(input: AnswerInput, answer: number | string): boolean {
  if (input == null) return false;
  const i = String(input).trim();
  if (i === '') return false;
  if (typeof answer === 'number') {
    const n = Number(i);
    return !Number.isNaN(n) && n === answer;
  }
  return norm(i) === norm(answer);
}
