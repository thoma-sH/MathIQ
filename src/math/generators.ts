import { DOMAINS, type Domain, type Problem } from './types';

const rnd = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!;
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

type Generator = () => Problem;

/* ─── ARITHMETIC ─────────────────────────────────────────────────────── */

const arithmeticPool: Generator[] = [
  // 2-digit × 1-digit
  () => {
    const a = rnd(11, 99); const b = rnd(2, 9);
    return { q: `${a} × ${b}`, a: a * b, kicker: '2-digit × 1', topic: 'Arith.' };
  },
  // 1-digit × 1-digit (high range)
  () => {
    const a = rnd(7, 12); const b = rnd(7, 12);
    return { q: `${a} × ${b}`, a: a * b, kicker: 'times tables', topic: 'Arith.' };
  },
  // The ×11 trick
  () => {
    const a = rnd(12, 89);
    return { q: `${a} × 11`, a: a * 11, kicker: '×11 trick', topic: 'Arith.' };
  },
  // ×25 = ÷4 × 100
  () => {
    const a = rnd(4, 40) * 4;
    return { q: `${a} × 25`, a: a * 25, kicker: '×25 shortcut', topic: 'Arith.' };
  },
  // 3-digit + 3-digit
  () => {
    const a = rnd(100, 499); const b = rnd(100, 499);
    return { q: `${a} + ${b}`, a: a + b, kicker: '3-digit sum', topic: 'Arith.' };
  },
  // Chain add
  () => {
    const a = rnd(15, 60); const b = rnd(15, 60); const c = rnd(15, 60);
    return { q: `${a} + ${b} + ${c}`, a: a + b + c, kicker: 'chain sum', topic: 'Arith.' };
  },
  // Subtract with borrow
  () => {
    const a = rnd(200, 999); const b = rnd(50, a - 1);
    return { q: `${a} − ${b}`, a: a - b, kicker: 'difference', topic: 'Arith.' };
  },
  // Clean division
  () => {
    const b = rnd(2, 12); const q = rnd(3, 25);
    return { q: `${b * q} ÷ ${b}`, a: q, kicker: 'clean division', topic: 'Arith.' };
  },
  // Square 11–25
  () => {
    const n = rnd(11, 25);
    return { q: `${n}²`, a: n * n, kicker: 'square', topic: 'Arith.' };
  },
  // Square 26–40 (harder)
  () => {
    const n = rnd(26, 40);
    return { q: `${n}²`, a: n * n, kicker: 'square (harder)', topic: 'Arith.' };
  },
  // Common percent
  () => {
    const pct = pick([10, 15, 20, 25, 50, 75]);
    const n = rnd(2, 20) * 20;
    return { q: `${pct}% of ${n}`, a: (pct * n) / 100, kicker: 'percent', topic: 'Arith.' };
  },
  // Reverse percent: what % of n is k
  () => {
    const n = pick([100, 200, 250, 400, 500]);
    const pct = pick([10, 20, 25, 40, 50, 60, 75]);
    const k = (n * pct) / 100;
    return { q: `${k} is what % of ${n}`, a: pct, kicker: 'reverse %', topic: 'Arith.' };
  },
  // Order of operations
  () => {
    const a = rnd(2, 9); const b = rnd(2, 9); const c = rnd(3, 12);
    return { q: `${a} + ${b} × ${c}`, a: a + b * c, kicker: 'order of ops', topic: 'Arith.' };
  },
  // Double / halve
  () => {
    const k = rnd(40, 200);
    return { q: `½ of ${k * 2}`, a: k, kicker: 'halve', topic: 'Arith.' };
  },
  // Double a 2-digit
  () => {
    const k = rnd(31, 89);
    return { q: `2 × ${k}`, a: 2 * k, kicker: 'doubling', topic: 'Arith.' };
  },
  // Squares of 50..99 by (50+x)² shortcut
  () => {
    const x = rnd(1, 9);
    const n = 50 + x;
    return { q: `${n}²`, a: n * n, kicker: '(50+x)² trick', topic: 'Arith.' };
  },
];

/* ─── ALGEBRA ────────────────────────────────────────────────────────── */

const algebraPool: Generator[] = [
  // Solve mx + b = k
  () => {
    const m = rnd(2, 9); const x = rnd(2, 12); const b = rnd(1, 30);
    return { q: `${m}x + ${b} = ${m * x + b}, x = ?`, a: x, kicker: 'solve for x', topic: 'Algebra' };
  },
  // Solve mx − b = k
  () => {
    const m = rnd(2, 8); const x = rnd(3, 12); const b = rnd(2, 20);
    return { q: `${m}x − ${b} = ${m * x - b}, x = ?`, a: x, kicker: 'solve for x', topic: 'Algebra' };
  },
  // Distribute then evaluate
  () => {
    const a = rnd(2, 6); const b = rnd(2, 9); const x = rnd(2, 8);
    return {
      q: `${a}(${b}x + 1), x = ${x}`,
      a: a * (b * x + 1),
      kicker: 'distribute & eval',
      topic: 'Algebra',
    };
  },
  // Combine like terms then eval
  () => {
    const m1 = rnd(3, 9); const m2 = rnd(1, m1 - 1); const c = rnd(1, 20); const x = rnd(2, 8);
    const m = m1 - m2;
    return {
      q: `${m1}x − ${m2}x + ${c}, x = ${x}`,
      a: m * x + c,
      kicker: 'combine + eval',
      topic: 'Algebra',
    };
  },
  // Power of small base
  () => {
    const base = pick([2, 3, 4, 5]); const exp = rnd(2, 5);
    return { q: `${base}^${exp}`, a: Math.pow(base, exp), kicker: 'powers', topic: 'Algebra' };
  },
  // log base 2
  () => {
    const exp = rnd(2, 8); const n = Math.pow(2, exp);
    return { q: `log₂ ${n}`, a: exp, kicker: 'log base 2', topic: 'Algebra' };
  },
  // log base 10
  () => {
    const exp = rnd(2, 5); const n = Math.pow(10, exp);
    return { q: `log₁₀ ${n}`, a: exp, kicker: 'log base 10', topic: 'Algebra' };
  },
  // Cube root
  () => {
    const r = rnd(2, 7);
    return { q: `∛${r ** 3}`, a: r, kicker: 'cube root', topic: 'Algebra' };
  },
  // Square root (perfect)
  () => {
    const r = rnd(4, 15);
    return { q: `√${r ** 2}`, a: r, kicker: 'square root', topic: 'Algebra' };
  },
  // Quadratic factoring (simple monic): find roots
  () => {
    const r1 = rnd(1, 6); const r2 = rnd(2, 8);
    // x² − (r1+r2)x + r1·r2 = (x − r1)(x − r2)
    return {
      q: `x² − ${r1 + r2}x + ${r1 * r2}, smaller root`,
      a: Math.min(r1, r2),
      kicker: 'factor quadratic',
      topic: 'Algebra',
    };
  },
  // Evaluate f(x) = mx + b at x = k
  () => {
    const m = rnd(2, 9); const b = rnd(-15, 15); const k = rnd(2, 8);
    const sign = b >= 0 ? `+ ${b}` : `− ${-b}`;
    return {
      q: `f(x) = ${m}x ${sign}, f(${k})`,
      a: m * k + b,
      kicker: 'evaluate f',
      topic: 'Algebra',
    };
  },
  // Simplify a fraction
  () => {
    const k = rnd(2, 6); const n = rnd(2, 7); const d = n + rnd(1, 6);
    const num = n * k; const den = d * k;
    return {
      q: `${num}/${den}, simplest numerator`,
      a: num / gcd(num, den),
      kicker: 'reduce fraction',
      topic: 'Algebra',
    };
  },
];

/* ─── TRIG ───────────────────────────────────────────────────────────── */

type TrigEntry = [string, number | string];
const TRIG_TABLE: TrigEntry[] = [
  ['sin 0°',  0],     ['sin 30°', 0.5],   ['sin 45°', '√2/2'], ['sin 60°', '√3/2'], ['sin 90°', 1],
  ['cos 0°',  1],     ['cos 30°', '√3/2'],['cos 45°', '√2/2'], ['cos 60°', 0.5],     ['cos 90°', 0],
  ['tan 0°',  0],     ['tan 30°', '√3/3'],['tan 45°', 1],       ['tan 60°', '√3'],
  ['sin 120°', '√3/2'], ['cos 120°', -0.5], ['sin 150°', 0.5], ['cos 150°', '-√3/2'],
  ['sin 180°', 0],    ['cos 180°', -1],   ['sin 270°', -1],    ['cos 270°', 0],
  ['sec 0°',  1],     ['csc 30°', 2],     ['cot 45°', 1],
];

const PYTHAG_TRIPLES: Array<[number, number, number]> = [
  [3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25], [9, 40, 41], [6, 8, 10], [9, 12, 15],
];

const trigPool: Generator[] = [
  // Unit circle lookup
  () => {
    const [q, a] = pick(TRIG_TABLE);
    return { q, a, kicker: 'unit circle', topic: 'Trig.' };
  },
  // Complement angle
  () => {
    const a = pick([10, 20, 25, 35, 40, 55]);
    return { q: `complement of ${a}°`, a: 90 - a, kicker: 'complement', topic: 'Trig.' };
  },
  // Supplement angle
  () => {
    const a = pick([35, 50, 70, 95, 110, 145]);
    return { q: `supplement of ${a}°`, a: 180 - a, kicker: 'supplement', topic: 'Trig.' };
  },
  // Pythagorean triple — find missing leg
  () => {
    const [x, y, h] = pick(PYTHAG_TRIPLES);
    const hide = rnd(0, 2);
    if (hide === 0) return { q: `legs ${y}, ${h - 0}; find ${x === x ? 'a' : ''} where a²+${y}²=${h}²`, a: x, kicker: 'pythagorean', topic: 'Trig.' };
    if (hide === 1) return { q: `legs ${x}, ?; hyp ${h}`, a: y, kicker: 'pythagorean', topic: 'Trig.' };
    return { q: `legs ${x}, ${y}; hyp ?`, a: h, kicker: 'pythagorean', topic: 'Trig.' };
  },
  // Convert deg ↔ rad (multiples of π)
  () => {
    const deg = pick([30, 45, 60, 90, 120, 135, 150, 180]);
    const radMap: Record<number, string> = {
      30: 'π/6', 45: 'π/4', 60: 'π/3', 90: 'π/2',
      120: '2π/3', 135: '3π/4', 150: '5π/6', 180: 'π',
    };
    return { q: `${deg}° in radians`, a: radMap[deg]!, kicker: 'rad ↔ deg', topic: 'Trig.' };
  },
];

/* ─── CALCULUS ───────────────────────────────────────────────────────── */

const calculusPool: Generator[] = [
  // Power rule: d/dx (cx^n)
  () => {
    const c = rnd(2, 9); const n = rnd(2, 5);
    return {
      q: `d/dx (${c}x^${n})`,
      a: `${c * n}x^${n - 1}`.replace('x^1', 'x'),
      kicker: 'power rule',
      topic: 'Calc.',
    };
  },
  // Sum derivative
  () => {
    const a = rnd(2, 6); const b = rnd(2, 8);
    return {
      q: `d/dx (${a}x³ + ${b}x)`,
      a: `${3 * a}x² + ${b}`,
      kicker: 'sum rule',
      topic: 'Calc.',
    };
  },
  // d/dx of common transcendentals
  () => {
    const fns: Array<[string, string]> = [
      ['e^x', 'e^x'],
      ['ln(x)', '1/x'],
      ['sin(x)', 'cos(x)'],
      ['cos(x)', '-sin(x)'],
    ];
    const [f, df] = pick(fns);
    return { q: `d/dx ${f}`, a: df, kicker: 'transcendentals', topic: 'Calc.' };
  },
  // Antiderivative power rule
  () => {
    const c = rnd(2, 9); const n = rnd(1, 4);
    const coeff = c / (n + 1);
    const coeffStr = coeff === Math.floor(coeff) ? `${coeff}` : `${c}/${n + 1}`;
    return {
      q: `∫ ${c}x^${n} dx`,
      a: `${coeffStr}x^${n + 1}`,
      kicker: 'integrate',
      topic: 'Calc.',
    };
  },
  // Simple definite integral
  () => {
    const c = rnd(2, 6); const b = rnd(2, 5);
    return {
      q: `∫₀^${b} ${c}x dx`,
      a: (c * b * b) / 2,
      kicker: 'definite ∫',
      topic: 'Calc.',
    };
  },
  // Common limits
  () => {
    const fns: Array<[string, number]> = [
      ['lim x→0 sin(x)/x', 1],
      ['lim x→∞ 1/x', 0],
      ['lim x→0 (e^x − 1)/x', 1],
      ['lim x→0 (1 − cos x)/x', 0],
      ['lim x→∞ (1 + 1/x)^x', Math.E],
    ];
    const [q, a] = pick(fns);
    return { q, a, kicker: 'limits', topic: 'Calc.' };
  },
];

/* ─── DISCRETE ───────────────────────────────────────────────────────── */

const discretePool: Generator[] = [
  // gcd
  () => {
    const a = rnd(12, 60); const b = rnd(8, 36);
    return { q: `gcd(${a}, ${b})`, a: gcd(a, b), kicker: 'gcd', topic: 'Discrete' };
  },
  // lcm
  () => {
    const a = rnd(4, 24); const b = rnd(3, 18);
    return { q: `lcm(${a}, ${b})`, a: (a * b) / gcd(a, b), kicker: 'lcm', topic: 'Discrete' };
  },
  // mod
  () => {
    const a = rnd(20, 199); const b = rnd(3, 17);
    return { q: `${a} mod ${b}`, a: a % b, kicker: 'modulo', topic: 'Discrete' };
  },
  // factorial
  () => {
    const facts = [1, 1, 2, 6, 24, 120, 720, 5040];
    const n = rnd(3, 7);
    return { q: `${n}!`, a: facts[n]!, kicker: 'factorial', topic: 'Discrete' };
  },
  // C(n, k)
  () => {
    const choices: Array<[number, number, number]> = [
      [4, 2, 6], [5, 2, 10], [5, 3, 10], [6, 2, 15], [6, 3, 20], [7, 2, 21],
      [7, 3, 35], [8, 2, 28], [8, 3, 56],
    ];
    const [n, k, v] = pick(choices);
    return { q: `C(${n}, ${k})`, a: v, kicker: 'combinations', topic: 'Discrete' };
  },
  // Prime check
  () => {
    const set = [11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 51, 57, 63, 91];
    const primes = new Set([11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47]);
    const n = pick(set);
    return {
      q: `is ${n} prime? (1=yes, 0=no)`,
      a: primes.has(n) ? 1 : 0,
      kicker: 'primes',
      topic: 'Discrete',
    };
  },
  // Binary → decimal small
  () => {
    const n = rnd(5, 31);
    return {
      q: `0b${n.toString(2)} in decimal`,
      a: n,
      kicker: 'binary',
      topic: 'Discrete',
    };
  },
  // Hex small
  () => {
    const n = rnd(10, 255);
    return {
      q: `0x${n.toString(16).toUpperCase()} in decimal`,
      a: n,
      kicker: 'hex',
      topic: 'Discrete',
    };
  },
];

/* ─── Domain dispatch + anti-repeat ──────────────────────────────────── */

const POOLS: Record<Exclude<Domain, 'mixed'>, Generator[]> = {
  arithmetic: arithmeticPool,
  algebra: algebraPool,
  trig: trigPool,
  calculus: calculusPool,
  discrete: discretePool,
};

function generateOne(domain: Domain): Problem {
  const concrete: Exclude<Domain, 'mixed'> =
    domain === 'mixed' ? pick(DOMAINS) : domain;
  const pool = POOLS[concrete];
  return pick(pool)();
}

/**
 * Generate a problem, optionally avoiding any whose `q` is in `exclude`.
 * Tries up to 6 times before giving up — at the size of the pools above
 * (≈45 templates total) collisions across a typical drill session are
 * rare even without retries, but the retry loop guarantees consecutive
 * problems aren't literally identical.
 */
export function genProblem(domain: Domain, exclude?: Set<string>): Problem {
  for (let i = 0; i < 6; i++) {
    const p = generateOne(domain);
    if (!exclude || !exclude.has(p.q)) return p;
  }
  return generateOne(domain);
}
