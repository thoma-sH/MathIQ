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

/**
 * Drops the slots a student never filled in.
 *
 * The keypad's operator keys always offer both limits and a body, so one
 * integral key covers the definite and the indefinite case. The cost is that
 * an indefinite one leaves `\placeholder{}` behind, and that would otherwise
 * travel to the classifier and into the problem card as literal text. An
 * empty limit takes its `_` or `^` with it — `\int_{}^{}` is not what anyone
 * means by an indefinite integral — while an empty body just goes.
 *
 * A *filled* placeholder (`\placeholder{x}`, which MathLive writes when it
 * has a default) keeps its contents; only the empty ones are noise.
 */
function stripPlaceholders(latex: string): string {
  return latex
    .replace(/[_^]\{\\placeholder\{\}\}/g, '')
    .replace(/[_^]\\placeholder\{\}/g, '')
    .replace(/\\placeholder\{\}/g, '')
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
      // whole.
      let depth = 1;
      let j = i + '\\text{'.length;
      while (j < latex.length && depth > 0) {
        if (latex[j] === '{') depth += 1;
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
