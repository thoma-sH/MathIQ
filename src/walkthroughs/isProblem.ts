/**
 * Heuristic: does this input look like an actual math problem to solve, or
 * is it just a topic-search query (e.g. "related rates", "eigenvalues")?
 *
 * If problem-like, the Landing/Topic flow passes it to the walkthrough so
 * Iris auto-fires. If topic-search-like, we route to the matched topic
 * page WITHOUT a problem so the user sees the example and chooses when to
 * click "Walk me through it."
 *
 * Signals that suggest a real problem:
 *   - Any digit (almost every math problem has at least one number)
 *   - Equation / operator characters: = + − ÷ × * / ^ ( )
 *   - LaTeX commands (\frac, \int, etc.) or math markers ($ ^ _)
 *   - An imperative verb commonly paired with a problem
 *
 * If none of those fire, treat as topic search.
 */
const IMPERATIVE_VERBS = /\b(find|solve|compute|evaluate|factor|integrate|differentiate|prove|show|simplify|expand|derive|graph|sketch)\b/i;

export function looksLikeProblem(input: string): boolean {
  const t = input.trim();
  if (!t) return false;
  if (/\d/.test(t)) return true;
  if (/[=+\-*/^()×÷·]/.test(t)) return true;
  if (/\\[a-zA-Z]+/.test(t)) return true;
  if (/[$^_]/.test(t)) return true;
  if (IMPERATIVE_VERBS.test(t)) return true;
  return false;
}
