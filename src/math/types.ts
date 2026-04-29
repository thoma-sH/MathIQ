export const DOMAINS = [
  'arithmetic',
  'algebra',
  'trig',
  'calculus',
  'discrete',
] as const;

export type Domain = (typeof DOMAINS)[number] | 'mixed';

export interface Problem {
  q: string;
  a: number | string;
  kicker: string;
  topic: string;
}

export type AnswerInput = string | number | null | undefined;
