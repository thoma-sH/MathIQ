export const DAY_LABELS = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
] as const;

export const DAY_TAGLINES = [
  'Every walkthrough now comes with a complimentary introspection.',
  'Pick a course. Type a problem. Walk through it — the world is our oyster.',
  "Yesterday's confusion is today's intuition. Type the one that wobbled.",
  'Halfway through the week. Halfway through the proof. Both end the same way — lunch.',
  'Every theorem was once a guess. Type one.',
  'Math is the gift that keeps on giving… and taking and splitting and multiplying.',
  'No days off.',
];

export const DAY_SCRIBES = [
  '/scribe-sunday.png',
  '/scribe-monday.png',
  '/scribe-tuesday.png',
  '/scribe-wednesday.png',
  '/scribe-thursday.png',
  '/scribe-friday.png',
  '/scribe-saturday.png',
];

export function getTodayIndex(): number {
  return new Date().getDay();
}

export interface DailyContent {
  dayLabel: string;
  tagline: string;
  scribeSrc: string;
}

export function getDailyContent(index: number = getTodayIndex()): DailyContent {
  const safe = ((index % 7) + 7) % 7;
  return {
    dayLabel: DAY_LABELS[safe],
    tagline: DAY_TAGLINES[safe],
    scribeSrc: DAY_SCRIBES[safe],
  };
}
