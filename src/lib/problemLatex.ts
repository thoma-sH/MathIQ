/**
 * The mathfield speaks LaTeX; everything past it speaks prose with `$…$` math.
 *
 * With smartMode on, a student typing "integrate x^2" gets `\text{integrate }x^2`
 * out of the field. Handed on as-is, that string looks like a LaTeX command to
 * the problem heuristic (so a bare topic name auto-fires a walkthrough and
 * spends a slot), and renders as the literal characters `\text{…}` in the
 * problem card. Going the other way, OCR returns "Find $\frac{dy}{dx}$" and
 * setting that on the field parses the prose as math variables and the `$`
 * as an error.
 *
 * These two functions are the boundary. They are not exact inverses — MathLive
 * normalises what it is given — which is why the field's own `value` stays raw
 * LaTeX and the conversion happens only when text leaves it or arrives at it.
 */

/** Prose the field will parse as LaTeX text: braces, backslashes and the
 *  other specials would otherwise be read as markup. */
function escapeText(s: string): string {
  return s.replace(/[\\{}$%#&_^~]/g, (c) => {
    if (c === '\\') return '\\textbackslash{}';
    if (c === '^') return '\\^{}';
    if (c === '~') return '\\~{}';
    return `\\${c}`;
  });
}

function unescapeText(s: string): string {
  return s
    .replace(/\\textbackslash\{\}/g, '\\')
    .replace(/\\\^\{\}/g, '^')
    .replace(/\\~\{\}/g, '~')
    .replace(/\\([{}$%#&_])/g, '$1');
}

/** Joins prose and `$math$` runs, adding a space at a seam only when neither
 *  side brought one and the next run isn't punctuation. */
function joinRuns(runs: string[]): string {
  let out = '';
  for (const run of runs) {
    if (!run) continue;
    if (out && !/\s$/.test(out) && !/^[\s.,;:?!)]/.test(run)) out += ' ';
    out += run;
  }
  return out.replace(/\s+/g, ' ').trim();
}

const EMPTY_PLACEHOLDER = '\\placeholder{}';

/** Index just past the brace group opening at `i`, or -1 if it never closes. */
function groupEnd(latex: string, i: number): number {
  let depth = 0;
  for (let j = i; j < latex.length; j += 1) {
    if (latex[j] === '{') depth += 1;
    else if (latex[j] === '}') {
      depth -= 1;
      if (depth === 0) return j + 1;
    }
  }
  return -1;
}

/**
 * Drops sub/superscripts holding an unfilled slot, *whole* and *in pairs*:
 * half a limit is not a limit, so `\int_{a}^{}` becomes `\int` and the
 * student's `a` survives in the field for them to finish. The space matters —
 * deleting outright welds the operator to what follows, turning `\int_{}^{}x`
 * into the undefined command `\intx`.
 */
function dropUnfilledScripts(latex: string): string {
  let out = '';
  let i = 0;
  while (i < latex.length) {
    const script = latex[i] === '_' || latex[i] === '^';
    if (script && latex[i + 1] === '{') {
      let end = i;
      let unfilled = false;
      while ((latex[end] === '_' || latex[end] === '^') && latex[end + 1] === '{') {
        const close = groupEnd(latex, end + 1);
        if (close < 0) break;
        if (latex.slice(end + 2, close - 1).includes(EMPTY_PLACEHOLDER)) unfilled = true;
        end = close;
      }
      if (end > i) {
        out += unfilled ? ' ' : latex.slice(i, end);
        i = end;
        continue;
      }
    }
    out += latex[i];
    i += 1;
  }
  return out;
}

/** Blank limits are a legitimate indefinite integral; a blank body is just an
 *  unfinished problem, and submitting one spends a walkthrough on nothing. */
export function hasUnfilledBody(latex: string): boolean {
  return dropUnfilledScripts(latex).includes(EMPTY_PLACEHOLDER);
}

function stripPlaceholders(latex: string): string {
  return dropUnfilledScripts(latex)
    .split(EMPTY_PLACEHOLDER)
    .join(' ')
    // A command left holding nothing but empty groups — an untouched
    // `\frac{}{}` — is a bare fraction bar in the problem card.
    .replace(/\\[a-zA-Z]+(?:\{\s*\})+(?!\s*\{)/g, ' ')
    .replace(/\s+/g, ' ');
}

/** Mathfield LaTeX → the prose-with-`$…$` string the classifier, the
 *  heuristic and the problem card all expect. */
export function latexToProblem(rawLatex: string): string {
  const latex = stripPlaceholders(rawLatex);
  const runs: string[] = [];
  let math = '';
  const flushMath = () => {
    const m = math.trim();
    if (m) runs.push(`$${m}$`);
    math = '';
  };

  let i = 0;
  while (i < latex.length) {
    if (latex.startsWith('\\text{', i)) {
      // Walk to the matching brace so a nested group inside the text stays
      // whole. Escapes step over their own next character: the `\{` and `\}`
      // `escapeText` writes for a brace in the prose are not depth.
      let depth = 1;
      let j = i + '\\text{'.length;
      while (j < latex.length && depth > 0) {
        if (latex[j] === '\\') j += 1;
        else if (latex[j] === '{') depth += 1;
        else if (latex[j] === '}') depth -= 1;
        j += 1;
      }
      flushMath();
      runs.push(unescapeText(latex.slice(i + '\\text{'.length, j - 1)));
      i = j;
    } else {
      math += latex[i];
      i += 1;
    }
  }
  flushMath();
  return joinRuns(runs);
}

/** Prose-with-`$…$` (OCR output, a pasted problem) → LaTeX the mathfield
 *  renders the way smartMode would have produced it. Display math is folded
 *  into the line; the field is single-line. */
export function problemToLatex(problem: string): string {
  const src = problem.trim();
  const out: string[] = [];
  const math = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const pushProse = (prose: string) => {
    // Whitespace-only prose between two math runs still matters: dropping
    // it would fuse them into one expression.
    if (prose.length > 0) out.push(`\\text{${escapeText(prose.replace(/\s+/g, ' '))}}`);
  };
  while ((m = math.exec(src)) !== null) {
    pushProse(src.slice(last, m.index));
    const body = (m[1] ?? m[2] ?? '').trim();
    if (body) out.push(body);
    last = math.lastIndex;
  }
  pushProse(src.slice(last));
  return out.join('');
}
