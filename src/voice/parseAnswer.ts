/**
 * Convert a Web Speech transcript into something `checkAnswer` can
 * compare against. Browsers vary wildly in how they render spoken math:
 *
 *   "forty-seven"           → "47"
 *   "two hundred eighty"    → "280"
 *   "square root of two"    → "√2"
 *   "two squared"           → "2²"
 *   "pi over four"          → "π/4"
 *   "x times y"             → "x×y"
 *
 * We normalise common math phrasings, then try to convert any remaining
 * spelled-out numerals to digits. The result is fed straight into
 * `checkAnswer` — keeping the original input around as well so the user
 * can still see literally what they said.
 */

const ONES: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** Try to interpret a token sequence as a single English numeral. */
export function wordsToNumber(text: string): number | null {
  const tokens = text
    .toLowerCase()
    .replace(/[-,]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return null;

  let total = 0;
  let current = 0;
  let foundAny = false;

  for (const tok of tokens) {
    if (tok in ONES) { current += ONES[tok]!; foundAny = true; }
    else if (tok in TENS) { current += TENS[tok]!; foundAny = true; }
    else if (tok === 'hundred') { current = (current || 1) * 100; foundAny = true; }
    else if (tok === 'thousand') { total += (current || 1) * 1000; current = 0; foundAny = true; }
    else if (tok === 'million') { total += (current || 1) * 1_000_000; current = 0; foundAny = true; }
    else if (tok === 'and' || tok === 'a') { /* filler */ }
    else if (tok === 'point' || tok === 'dot') {
      // Decimal: rest of tokens are digits.
      const rest = tokens.slice(tokens.indexOf(tok) + 1);
      const digits = rest.map((t) => ONES[t]).filter((d) => d != null).join('');
      if (!digits) return null;
      const whole = total + current;
      return Number(`${whole}.${digits}`);
    }
    else if (/^-?\d+(\.\d+)?$/.test(tok)) {
      // Already a digit — pass through.
      total += Number(tok);
      foundAny = true;
    }
    else {
      return null;
    }
  }
  return foundAny ? total + current : null;
}

const NUMBER_GROUP = /(?:(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|and|point)[\s-]?){2,}/gi;

/**
 * Replace any spelled-out numeral runs in a transcript with their
 * numeric equivalent. "two hundred and forty" → "240".
 */
function digitiseNumberWords(text: string): string {
  return text.replace(NUMBER_GROUP, (match) => {
    const n = wordsToNumber(match);
    return n != null ? String(n) : match;
  });
}

/**
 * Replace common spoken math phrasings with their symbolic equivalents.
 * Run *before* digit conversion so "two squared" becomes "2²" rather
 * than "two squared" → "2 squared" → still ambiguous.
 */
function normaliseMathSpeech(text: string): string {
  let s = text.toLowerCase();
  s = s.replace(/\bsquare\s+root\s+of\s+/g, '√');
  s = s.replace(/\bcube\s+root\s+of\s+/g, '∛');
  s = s.replace(/\b(\d+(?:\.\d+)?|\([^()]+\))\s+squared\b/g, '$1²');
  s = s.replace(/\b(\d+(?:\.\d+)?|\([^()]+\))\s+cubed\b/g, '$1³');
  s = s.replace(/\bto\s+the\s+power\s+(?:of\s+)?(\d+)/g, '^$1');
  s = s.replace(/\bover\b/g, '/');
  s = s.replace(/\bplus\b/g, '+');
  s = s.replace(/\bminus\b/g, '-');
  s = s.replace(/\btimes\b/g, '×');
  s = s.replace(/\bdivided\s+by\b/g, '÷');
  s = s.replace(/\bpi\b/g, 'π');
  s = s.replace(/\bpercent\b/g, '%');
  s = s.replace(/\bdegrees?\b/g, '°');
  s = s.replace(/\bequals?\b/g, '=');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

export interface ParsedAnswer {
  /** The cleaned text that should be matched against the expected answer. */
  candidate: string;
  /** A numeric form, if extractable — useful for numeric checking. */
  numeric: number | null;
  /** The raw transcript for display. */
  raw: string;
}

export function parseAnswer(raw: string): ParsedAnswer {
  const trimmed = raw.trim();
  if (!trimmed) return { candidate: '', numeric: null, raw };

  // Math phrasings first ("two squared" → "2²"), then any leftover
  // spelled-out numbers ("forty seven" → "47").
  const math = normaliseMathSpeech(trimmed);
  const candidate = digitiseNumberWords(math).replace(/\s+/g, '');

  // Try to extract a single numeric answer.
  const direct = Number(candidate);
  let numeric: number | null = Number.isFinite(direct) ? direct : null;
  if (numeric == null) {
    numeric = wordsToNumber(trimmed);
  }

  return { candidate, numeric, raw };
}
