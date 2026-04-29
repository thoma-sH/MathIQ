/**
 * Tiny safe expression evaluator. Accepts the user's typed math
 * expression and tries to compute it.
 *
 * Recognised tokens:
 *   digits, decimal point
 *   + − * / ** ^                      (operators; − is unicode minus)
 *   ×, ÷                              (mapped to *, /)
 *   ²  ³                              (mapped to **2 / **3 on the
 *                                      preceding number or paren group)
 *   √n  √(expr)                       (square root)
 *   π                                 (Math.PI)
 *   ( )                               (grouping)
 *
 * Anything else short-circuits to null. The cleaned string is run with
 * `new Function` after a strict whitelist check, so the only "code" the
 * evaluator can see is digits, basic operators, parens, and `**`.
 */

const PI = '3.141592653589793';

function preprocess(raw: string): string {
  return raw
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/\^/g, '**')
    .replace(/π/g, PI)
    // √(group) and √number — must run before stripping parens.
    .replace(/√\(([^()]+)\)/g, '(($1)**0.5)')
    .replace(/√(\d+(?:\.\d+)?)/g, '(($1)**0.5)')
    // n² and n³ — applies to a digit run or a parenthesised group.
    .replace(/(\d+(?:\.\d+)?|\([^()]+\))²/g, '(($1)**2)')
    .replace(/(\d+(?:\.\d+)?|\([^()]+\))³/g, '(($1)**3)')
    .replace(/\s/g, '');
}

export function evalExpression(raw: string): number | null {
  const cleaned = preprocess(raw);
  if (!cleaned) return null;

  // After preprocessing, only digits, +, -, *, /, (, ), . should remain.
  if (!/^[0-9+\-*/().]+$/.test(cleaned)) return null;
  // Reject pathological operator runs.
  if (/[+\-*/]{3,}/.test(cleaned)) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const fn = new Function(`"use strict";return (${cleaned});`);
    const result = fn() as unknown;
    if (typeof result !== 'number' || !Number.isFinite(result)) return null;
    return result;
  } catch {
    return null;
  }
}

/**
 * Detect a math-like expression inside an arbitrary user message.
 * Returns the substring + computed value if found, else null.
 */
export function findExpression(message: string): { expr: string; value: number } | null {
  // Pull the longest substring that looks like math — must contain at
  // least one digit and may include our extended math glyphs.
  const matches = message.match(/[0-9π√][0-9+\-*/×÷^.()²³√π\s]*[0-9π)²³]?/g);
  if (!matches) return null;
  const sorted = [...matches].sort((a, b) => b.length - a.length);
  for (const m of sorted) {
    const v = evalExpression(m);
    if (v != null) return { expr: m.trim(), value: v };
  }
  return null;
}

/**
 * Mental-math tip for an expression. Returns a short prose nudge or
 * empty string if the expression doesn't fit a known shortcut.
 */
export function tipForExpression(expr: string): string {
  const mul = expr.match(/^\s*(\d+)\s*[*×]\s*(\d+)\s*$/);
  if (mul) {
    const a = Number(mul[1]); const b = Number(mul[2]);
    const small = Math.min(a, b);
    if (small === 8) return 'Tip: ×8 is double-double-double.';
    if (small === 9) return 'Tip: ×9 is ×10 minus one of itself.';
    if (small === 5) return 'Tip: ×5 is ×10 then halve.';
    if (small === 11 && Math.max(a, b) < 100) return 'Tip: ×11 of AB → A | (A+B) | B.';
    if (small === 25) return 'Tip: ×25 is ÷4 then ×100.';
  }
  if (/²|\*\*\s*2/.test(expr)) return 'Tip: square via (a−k)(a+k) + k². Round to a friendly anchor.';
  if (/√/.test(expr)) return 'Tip: estimate roots between perfect squares; then refine.';
  if (/π/.test(expr)) return 'Tip: π ≈ 3.14159; for quick mental estimates use 22/7.';
  if (/\^|\*\*/.test(expr)) return 'Tip: powers of small primes — memorise 2¹⁰ = 1024 and 3⁵ = 243.';
  return '';
}
