/**
 * Convert a problem's display string ("47 × 8", "√144 + 18", "log₂ 32",
 * "d/dx (3x²)") into something a text-to-speech engine can pronounce
 * naturally.
 *
 * Most TTS engines will mangle math glyphs — × becomes "x" or silence,
 * √ is unspeakable, sub/superscript digits get lost. We expand them to
 * spoken English first.
 */

const SUBS = '₀₁₂₃₄₅₆₇₈₉';
const SUPS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

const subChar = (c: string) => SUBS.indexOf(c).toString();
const supChar = (c: string) => SUPS.indexOf(c).toString();

export function speakable(raw: string): string {
  let s = raw;

  // logₙ → "log base N"
  s = s.replace(/log([₀-₉]+)/g, (_, sub: string) =>
    `log base ${[...sub].map(subChar).join('')}`,
  );

  // √(group) and √n
  s = s.replace(/√\(([^()]+)\)/g, ' square root of ($1) ');
  s = s.replace(/√(\d+(?:\.\d+)?)/g, ' square root of $1 ');
  s = s.replace(/∛(\d+(?:\.\d+)?)/g, ' cube root of $1 ');
  s = s.replace(/√/g, ' square root ');

  // n² / n³
  s = s.replace(/(\d+(?:\.\d+)?|\([^()]+\)|x|y|z)²/g, '$1 squared');
  s = s.replace(/(\d+(?:\.\d+)?|\([^()]+\)|x|y|z)³/g, '$1 cubed');

  // Superscript exponents (e.g., x⁵)
  s = s.replace(/([A-Za-z\d)])([⁰-⁹]+)/g, (_, base: string, exps: string) => {
    const n = [...exps].map(supChar).join('');
    if (n === '2') return `${base} squared`;
    if (n === '3') return `${base} cubed`;
    return `${base} to the ${n}`;
  });

  // Caret-style exponents: x^5
  s = s.replace(/\^(\d+)/g, (_, n: string) => {
    if (n === '2') return ' squared';
    if (n === '3') return ' cubed';
    return ` to the ${n}`;
  });

  // Calculus & summation glyphs
  s = s.replace(/d\/dx/g, 'derivative of ');
  s = s.replace(/∫₀\^(\d+)/g, ' integral from zero to $1 of ');
  s = s.replace(/∫/g, ' integral of ');
  s = s.replace(/\bdx\b/g, ' d x');
  s = s.replace(/lim\s*x→∞/g, 'limit as x approaches infinity of ');
  s = s.replace(/lim\s*x→0/g, 'limit as x approaches zero of ');
  s = s.replace(/lim\s*x→(-?\d+)/g, 'limit as x approaches $1 of ');

  // Common operator glyphs
  s = s
    .replace(/×/g, ' times ')
    .replace(/÷/g, ' divided by ')
    .replace(/−/g, ' minus ')
    .replace(/π/g, ' pi ')
    .replace(/°/g, ' degrees')
    .replace(/∞/g, ' infinity ')
    .replace(/¹⁄₂|½/g, ' one half ')
    .replace(/=/g, ' equals ');

  // Tidy whitespace
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}
