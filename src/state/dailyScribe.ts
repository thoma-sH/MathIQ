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
  'Pick a course. Type a problem. Walk through it; the world is our oyster.',
  "Yesterday's confusion is today's intuition. Embrace the growth.",
  'Halfway through the week. Halfway through the proof. Both end the same way- lunch.',
  'Every breakthrough was once a guess. What will yours be?',
  'Math is the gift that keeps on giving... and taking and splitting and multiplying.',
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
  scribeFillSrc: string;
}

export function getDailyContent(index: number = getTodayIndex()): DailyContent {
  const safe = ((index % 7) + 7) % 7;
  const scribeSrc = DAY_SCRIBES[safe];
  return {
    dayLabel: DAY_LABELS[safe],
    tagline: DAY_TAGLINES[safe],
    scribeSrc,
    scribeFillSrc: scribeSrc.replace('.png', '-fill.png'),
  };
}
