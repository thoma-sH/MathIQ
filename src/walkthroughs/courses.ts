import type { Course, Topic } from './types';

export const COURSES: Course[] = [
  {
    id: 'algebra',
    title: 'College Algebra',
    blurb: 'Equations, inequalities, functions, polynomials, factoring.',
    topics: [
      {
        id: 'factoring-quadratics',
        title: 'Factoring x² + bx + c',
        blurb: 'Two numbers that add to b and multiply to c.',
        strategicAnchor:
          "List integer factor pairs of c, then pick the pair whose sum equals b. Sign rules: same-sign pair when c > 0 (both match b's sign); opposite-sign pair when c < 0, with the larger-magnitude one matching b's sign.",
        exampleProblem: 'Factor: $x^2 + 11x + 30$',
      },
      {
        id: 'completing-the-square',
        title: 'Completing the Square',
        blurb: 'Manufacture a perfect-square trinomial by adding the right constant.',
        strategicAnchor:
          'Add and subtract (b/2)² to convert ax² + bx + c into a(x + h)² + k. Useful for solving quadratics, rewriting in vertex form, and (later) Gaussian-style integrals.',
        exampleProblem: 'Solve by completing the square: $x^2 + 6x + 5 = 0$',
      },
      {
        id: 'rational-equations',
        title: 'Rational Equations',
        blurb: 'Equations with variables in denominators.',
        strategicAnchor:
          "Multiply both sides by the LCD to clear denominators. Always check for extraneous roots — any solution that makes an original denominator zero must be discarded.",
        exampleProblem: 'Solve: $\\dfrac{2}{x-1} + \\dfrac{1}{x+1} = \\dfrac{4}{x^2 - 1}$',
      },
      {
        id: 'linear-systems',
        title: 'Systems of Linear Equations',
        blurb: 'Two equations, two unknowns — substitute or eliminate.',
        strategicAnchor:
          "Pick the method by what's easy. Substitution: when one equation already isolates a variable. Elimination: when coefficients line up to cancel (or you can multiply through to make them).",
        exampleProblem:
          'Solve the system: $$\\begin{cases} 2x + 3y = 12 \\\\ x - y = 1 \\end{cases}$$',
      },
      {
        id: 'quadratic-formula',
        title: 'The Quadratic Formula',
        blurb: 'When factoring fails, plug into x = [−b ± √(b² − 4ac)] / 2a.',
        strategicAnchor:
          "Read the discriminant b² − 4ac before plugging in: positive → two real roots; zero → one repeated real root; negative → two complex roots. The discriminant tells you what kind of answer to expect.",
        exampleProblem: 'Solve: $2x^2 - 5x + 1 = 0$',
      },
      {
        id: 'quadratic-inequalities',
        title: 'Quadratic Inequalities',
        blurb: 'Find where a quadratic is positive or negative on the number line.',
        strategicAnchor:
          'Find the roots (factor or quadratic formula). Test signs in each interval between roots. Flip the inequality only when you multiply or divide by a negative.',
        exampleProblem: 'Solve: $x^2 - 3x - 4 > 0$',
      },
    ],
  },
  {
    id: 'precalc',
    title: 'Precalculus',
    blurb: 'Trig identities, exponentials and logs, conic sections, sequences.',
    topics: [
      {
        id: 'pythagorean-identities',
        title: 'Pythagorean Identities',
        blurb: 'sin²x + cos²x = 1, and its two cousins.',
        strategicAnchor:
          "Three forms: sin² + cos² = 1; tan² + 1 = sec²; 1 + cot² = csc². Pick the form whose 'shape' matches what you're trying to simplify or substitute for.",
        exampleProblem: 'Simplify: $\\dfrac{\\sin^2 x}{1 - \\cos x}$',
      },
      {
        id: 'solving-trig-equations',
        title: 'Solving Trig Equations',
        blurb: 'Find all x with sin x = a (etc.), over an interval or all reals.',
        strategicAnchor:
          'Find a reference angle, then use periodicity to list all solutions. Sin and cos give two solution families per period; tan gives one per period.',
        exampleProblem: 'Solve $2\\sin x - 1 = 0$ on $[0, 2\\pi)$.',
      },
      {
        id: 'log-rules',
        title: 'Logarithm Rules',
        blurb: 'Convert products, quotients, and powers via the log laws.',
        strategicAnchor:
          'Three core moves: log(ab) = log a + log b; log(a/b) = log a − log b; log(aⁿ) = n log a. Always check the domain after manipulation — log requires positive arguments.',
        exampleProblem: 'Solve: $\\log_2(x) + \\log_2(x - 2) = 3$',
      },
      {
        id: 'exponential-equations',
        title: 'Exponential Equations',
        blurb: 'Variable in the exponent — bring it down with a log.',
        strategicAnchor:
          'Take a log of both sides (usually ln). The variable comes down via log(aˣ) = x log a. Use change of base if both sides have different bases.',
        exampleProblem: 'Solve: $5^{x+1} = 12$',
      },
      {
        id: 'conic-sections',
        title: 'Conic Sections',
        blurb: 'Recognize circles, ellipses, parabolas, hyperbolas from the equation.',
        strategicAnchor:
          'Look at the squared terms. Same coefficient → circle. Positive different coefficients → ellipse. Only one squared term → parabola. Opposite signs → hyperbola. Complete the square in x and y to get standard form.',
        exampleProblem:
          'Identify the conic and rewrite in standard form: $x^2 + 4y^2 - 6x + 16y + 9 = 0$',
      },
      {
        id: 'arithmetic-geometric-sequences',
        title: 'Arithmetic & Geometric Sequences',
        blurb: 'Closed-form formulas and partial sums.',
        strategicAnchor:
          'Check consecutive terms: constant difference → arithmetic, aₙ = a₁ + (n−1)d. Constant ratio → geometric, aₙ = a₁ rⁿ⁻¹. Sum formulas follow from telescoping or the geometric trick.',
        exampleProblem: 'Find the sum of the first 20 terms of $3, 7, 11, 15, \\ldots$',
      },
    ],
  },
  {
    id: 'calc-1',
    title: 'Calculus I',
    blurb: 'Limits, derivatives, optimization, related rates.',
    topics: [
      {
        id: 'limits',
        title: 'Computing Limits',
        blurb: 'Direct sub first, then factor/cancel for indeterminate forms.',
        strategicAnchor:
          "Always try direct substitution first. If you get 0/0 or ∞/∞, try factoring, conjugate multiplication, or L'Hôpital. Check one-sided limits when expressions change sign or are undefined at the point.",
        exampleProblem: 'Compute: $\\displaystyle\\lim_{x \\to 2} \\frac{x^2 - 4}{x - 2}$',
      },
      {
        id: 'differentiation-rules',
        title: 'Differentiation Rules',
        blurb: 'Power, product, quotient, chain — knowing which to apply first.',
        strategicAnchor:
          'Look at the outermost structure. Sum/difference → split. Product → product rule. Quotient → quotient rule. Composition → chain rule. Often you nest several. Use the chain rule whenever you differentiate a function-of-a-function.',
        exampleProblem: 'Differentiate: $f(x) = \\dfrac{x^2 \\sin(3x)}{e^x}$',
      },
      {
        id: 'implicit-differentiation',
        title: 'Implicit Differentiation',
        blurb: 'When y is tangled with x — differentiate both sides treating y as y(x).',
        strategicAnchor:
          'Apply d/dx to every term. Each y picks up a dy/dx via the chain rule. Then solve algebraically for dy/dx.',
        exampleProblem: 'Find $\\dfrac{dy}{dx}$ for $x^2 + xy + y^2 = 7$.',
      },
      {
        id: 'related-rates',
        title: 'Related Rates',
        blurb: 'Two changing quantities tied by an equation; given one rate, find the other.',
        strategicAnchor:
          'Set up the relating equation first (geometry/physics). Differentiate both sides with respect to time t. Substitute known values at the END, never before — substituting first locks variables that should still be moving.',
        exampleProblem:
          'A 10-ft ladder slides down a wall. The bottom moves at 2 ft/s away from the wall. How fast is the top falling when the bottom is 6 ft from the wall?',
      },
      {
        id: 'optimization',
        title: 'Optimization',
        blurb: 'Maximize or minimize a quantity subject to a constraint.',
        strategicAnchor:
          'Write the objective as a function of one variable (use the constraint to eliminate the other). Set the derivative to zero for critical points. Check second derivative or endpoints to confirm max vs. min vs. saddle.',
        exampleProblem:
          'Find the dimensions of the rectangle of maximum area inscribed in a semicircle of radius 5.',
      },
      {
        id: 'lhopital',
        title: "L'Hôpital's Rule",
        blurb: 'Differentiate top and bottom to crack indeterminate limits.',
        strategicAnchor:
          'Verify the form is 0/0 or ∞/∞ FIRST. Differentiate numerator and denominator separately (not as a quotient). Sometimes you apply it more than once. For other indeterminate forms (0·∞, 1^∞, ∞ − ∞), rewrite into 0/0 or ∞/∞ first.',
        exampleProblem: 'Compute: $\\displaystyle\\lim_{x \\to 0} \\frac{\\sin x - x}{x^3}$',
      },
    ],
  },
  {
    id: 'calc-2',
    title: 'Calculus II',
    blurb: 'Integration techniques, series, parametrics and polar.',
    topics: [
      {
        id: 'u-substitution',
        title: 'u-Substitution',
        blurb: 'Reverse the chain rule by spotting an inner function and its derivative.',
        strategicAnchor:
          "Look for f(g(x))·g'(x) inside the integral. Set u = g(x); du = g'(x) dx. The integral becomes ∫f(u) du, ideally a basic form. Don't forget to back-substitute (or change bounds for definite integrals).",
        exampleProblem: 'Compute: $\\displaystyle\\int x \\cos(x^2) \\, dx$',
      },
      {
        id: 'integration-by-parts',
        title: 'Integration by Parts',
        blurb: 'Reverse the product rule. Pick u via LIATE.',
        strategicAnchor:
          '∫u dv = uv − ∫v du. Pick u to be whichever appears first in LIATE: Logarithmic, Inverse trig, Algebraic, Trigonometric, Exponential. The u you picked simplifies on differentiation; what is left becomes dv.',
        exampleProblem: 'Compute: $\\displaystyle\\int x^2 \\ln x \\, dx$',
      },
      {
        id: 'trig-substitution',
        title: 'Trigonometric Substitution',
        blurb: 'When you see √(a² ± x²) or √(x² − a²), trade x for a sin/tan/sec.',
        strategicAnchor:
          'Three patterns: √(a² − x²) → x = a sin θ; √(a² + x²) → x = a tan θ; √(x² − a²) → x = a sec θ. Each one Pythagoreans the radical away. Always sketch a reference triangle to back-substitute.',
        exampleProblem: 'Compute: $\\displaystyle\\int \\frac{1}{\\sqrt{9 - x^2}} \\, dx$',
      },
      {
        id: 'partial-fractions',
        title: 'Partial Fraction Decomposition',
        blurb: 'Split a rational function into pieces you can integrate separately.',
        strategicAnchor:
          'Factor the denominator first. Each linear (x − r) gets A/(x − r); each repeated (x − r)² adds B/(x − r)²; each irreducible quadratic gets (Cx + D)/(quadratic). Solve for the constants by matching coefficients or plugging in roots.',
        exampleProblem: 'Compute: $\\displaystyle\\int \\frac{3x + 5}{(x - 1)(x + 2)} \\, dx$',
      },
      {
        id: 'series-convergence',
        title: 'Series Convergence Tests',
        blurb: 'Choose the right test based on the summand’s shape.',
        strategicAnchor:
          'Decision tree: alternating sign? alternating series test. p-form 1/nᵖ? p-test. Factorial or rⁿ? ratio test. Looks like a known series? comparison or limit comparison. Has a clean continuous antiderivative? integral test.',
        exampleProblem:
          'Does $\\displaystyle\\sum_{n=2}^{\\infty} \\frac{1}{n \\ln n}$ converge?',
      },
      {
        id: 'taylor-maclaurin',
        title: 'Taylor & Maclaurin Series',
        blurb: 'Approximate a function as a polynomial near a point.',
        strategicAnchor:
          "Maclaurin = Taylor at x = 0: f(x) = Σ f⁽ⁿ⁾(0)/n! · xⁿ. Memorize the big four (eˣ, sin x, cos x, 1/(1−x)) and derive others by substitution, differentiation, or integration of those.",
        exampleProblem:
          'Find the Maclaurin series for $f(x) = x \\sin(x^2)$ up to $x^7$.',
      },
    ],
  },
  {
    id: 'calc-3',
    title: 'Calculus III',
    blurb: 'Multivariable derivatives, gradients, multiple integrals, vector fields.',
    topics: [
      {
        id: 'partial-derivatives',
        title: 'Partial Derivatives',
        blurb: 'Differentiate w.r.t. one variable, treating the others as constants.',
        strategicAnchor:
          'Hold all variables but one constant; differentiate normally w.r.t. the active variable. Notation: ∂f/∂x or fₓ. The others literally do not move.',
        exampleProblem:
          'Find $\\dfrac{\\partial f}{\\partial x}$ and $\\dfrac{\\partial f}{\\partial y}$ for $f(x, y) = x^3 y^2 + e^{xy}$.',
      },
      {
        id: 'gradient-directional',
        title: 'Gradient & Directional Derivatives',
        blurb: '∇f points in the direction of steepest ascent.',
        strategicAnchor:
          '∇f = ⟨∂f/∂x, ∂f/∂y, ∂f/∂z⟩. Directional derivative in direction u (a unit vector) is ∇f · u. Maximum rate of change is |∇f|.',
        exampleProblem:
          'Find the directional derivative of $f(x, y) = x^2 y + y^3$ at $(1, 2)$ in the direction of $\\langle 3, 4 \\rangle$.',
      },
      {
        id: 'double-integrals',
        title: 'Double Integrals',
        blurb: 'Integrate over a 2D region by iterated single integrals.',
        strategicAnchor:
          'Sketch the region first. Type I (vertically simple): ∫_a^b ∫_{g₁(x)}^{g₂(x)} f dy dx. Type II (horizontally simple): swap. Pick the order that gives easier inner integration.',
        exampleProblem:
          'Compute $\\displaystyle\\iint_R xy \\, dA$ where $R$ is bounded by $y = x$ and $y = x^2$.',
      },
      {
        id: 'coordinate-changes',
        title: 'Polar / Cylindrical / Spherical',
        blurb: 'Pick coordinates that match the geometry to simplify integration.',
        strategicAnchor:
          'Polar (2D): use when you see x² + y² or circular regions; dA = r dr dθ. Cylindrical (3D): polar in xy plus z; dV = r dr dθ dz. Spherical: when you see x² + y² + z² or sphere/cone regions; dV = ρ² sin φ dρ dφ dθ.',
        exampleProblem:
          'Compute $\\displaystyle\\iint_D \\sqrt{x^2 + y^2} \\, dA$ where $D$ is the disk of radius 2 centered at the origin.',
      },
      {
        id: 'line-integrals',
        title: 'Line Integrals',
        blurb: 'Integrate along a curve.',
        strategicAnchor:
          'Parametrize the curve r(t), express f and ds (or F·dr) in terms of t, integrate over the t-range. For conservative vector fields (one with a potential function), use the fundamental theorem instead — much faster.',
        exampleProblem:
          'Compute $\\displaystyle\\int_C (x + y^2) \\, ds$ where $C$ is $r(t) = \\langle t, t^2 \\rangle$, $0 \\le t \\le 1$.',
      },
      {
        id: 'green-stokes-divergence',
        title: 'Green / Stokes / Divergence',
        blurb: 'Convert between line, surface, and volume integrals.',
        strategicAnchor:
          "Green's: line integral around a closed plane curve = double integral over the enclosed region (uses curl). Stokes: 3D analog with a surface bounded by the curve. Divergence: closed surface integral = volume integral over enclosed solid (uses divergence). Use whichever side of the boundary is easier to compute.",
        exampleProblem:
          "Use Green's theorem to compute $\\displaystyle\\oint_C (y^2 \\, dx + x^2 \\, dy)$ around the triangle with vertices $(0,0)$, $(1,0)$, $(0,1)$.",
      },
    ],
  },
  {
    id: 'discrete',
    title: 'Discrete Math',
    blurb: 'Logic, proofs, sets, relations, recursion, graph basics.',
    topics: [
      {
        id: 'propositional-logic',
        title: 'Propositional Logic & Equivalences',
        blurb: 'Use logic laws (De Morgan, distribution) to simplify or prove statements.',
        strategicAnchor:
          'Memorize the major laws: De Morgan ¬(P∧Q) ≡ ¬P∨¬Q; implication P→Q ≡ ¬P∨Q; contrapositive P→Q ≡ ¬Q→¬P. Truth tables work but get unwieldy past 3 variables; equivalences are how you scale.',
        exampleProblem: 'Show that $(P \\to Q) \\to P \\equiv P$.',
      },
      {
        id: 'induction',
        title: 'Mathematical Induction',
        blurb: 'Prove a claim about all natural numbers by base case + inductive step.',
        strategicAnchor:
          'Three pieces, each its own line: (1) base case — show P(1). (2) inductive hypothesis — assume P(k). (3) inductive step — show P(k+1) follows from P(k). Use the IH explicitly inside the step.',
        exampleProblem:
          'Prove $1 + 2 + \\cdots + n = \\dfrac{n(n+1)}{2}$ for all $n \\ge 1$.',
      },
      {
        id: 'set-operations',
        title: 'Sets & Set Identities',
        blurb: 'Unions, intersections, complements, and proving set equalities.',
        strategicAnchor:
          'To prove A = B, show element-wise: every x ∈ A is in B and vice versa. To prove A ⊆ B: assume x ∈ A, conclude x ∈ B. Use distributive laws and (the set-theory analog of) De Morgan.',
        exampleProblem: 'Prove $A \\cap (B \\cup C) = (A \\cap B) \\cup (A \\cap C)$.',
      },
      {
        id: 'function-properties',
        title: 'Injective / Surjective / Bijective',
        blurb: 'Prove function properties straight from the definitions.',
        strategicAnchor:
          'Injective: assume f(a) = f(b), show a = b. Surjective: pick arbitrary y in codomain, find an x in the domain with f(x) = y. Bijective: prove both.',
        exampleProblem:
          'Show that $f: \\mathbb{R} \\to \\mathbb{R},\\ f(x) = 2x + 3$ is bijective.',
      },
      {
        id: 'recurrence-relations',
        title: 'Recurrence Relations',
        blurb: 'Closed-form for sequences defined recursively.',
        strategicAnchor:
          'For linear homogeneous recurrences (e.g. aₙ = c₁aₙ₋₁ + c₂aₙ₋₂): solve the characteristic equation r² = c₁r + c₂. The roots determine the closed form: distinct → a r₁ⁿ + b r₂ⁿ; repeated → (a + bn) rⁿ.',
        exampleProblem:
          'Solve: $a_n = 5 a_{n-1} - 6 a_{n-2}$, $a_0 = 1$, $a_1 = 4$.',
      },
      {
        id: 'graph-basics',
        title: 'Graph Theory Basics',
        blurb: 'Vertices, edges, paths, cycles, trees.',
        strategicAnchor:
          'Recognize the type of graph problem: connectivity (paths/cycles), traversal (Euler/Hamilton), coloring (chromatic number). Trees are connected acyclic graphs with V − 1 edges.',
        exampleProblem: 'Show that a tree on $n$ vertices has exactly $n - 1$ edges.',
      },
    ],
  },
  {
    id: 'combinatorics',
    title: 'Combinatorics',
    blurb: 'Counting, permutations, generating functions, inclusion–exclusion.',
    topics: [
      {
        id: 'permutations-combinations',
        title: 'Permutations & Combinations',
        blurb: 'Order matters → P(n,k); order does not → C(n,k).',
        strategicAnchor:
          'Ask first: does order matter? If yes → P(n,k) = n!/(n−k)!. If no → C(n,k) = n!/(k!(n−k)!). Watch separately for repetition allowed (multiset) vs forbidden (subset).',
        exampleProblem:
          'From 8 candidates, how many ways are there to (a) arrange 3 in a line, and (b) choose 3 for a committee?',
      },
      {
        id: 'stars-and-bars',
        title: 'Stars and Bars',
        blurb: 'Count solutions to x₁ + ⋯ + xₖ = n with non-negative integers.',
        strategicAnchor:
          'Place n stars in a row; place k − 1 bars to split them into k groups. Total arrangements: C(n + k − 1, k − 1). Adjust if x’s must be positive (gift each a 1 first) or have upper bounds (use inclusion-exclusion).',
        exampleProblem:
          'How many non-negative integer solutions does $x_1 + x_2 + x_3 + x_4 = 10$ have?',
      },
      {
        id: 'inclusion-exclusion',
        title: 'Inclusion–Exclusion',
        blurb: '|A∪B∪C| = singles − doubles + triples − …',
        strategicAnchor:
          'Used when objects can satisfy multiple properties. Add the singles, subtract the doubles, add the triples, and so on. Sign alternates by intersection size. Used for counting derangements, surjections, and other "at least one of" problems.',
        exampleProblem:
          'Of 100 people, 60 like coffee, 50 like tea, 30 like both. How many like neither?',
      },
      {
        id: 'pigeonhole',
        title: 'Pigeonhole Principle',
        blurb: 'If n+1 objects go in n boxes, some box has ≥ 2.',
        strategicAnchor:
          'Identify the pigeons (objects), the pigeonholes (categories), and what conclusion follows. Generalized: if n objects go in k boxes, some box has at least ⌈n/k⌉ objects. Often used when construction is hard but existence is easy.',
        exampleProblem:
          'Show that among any 5 points in a $2 \\times 2$ square, two are at distance $\\le \\sqrt{2}$.',
      },
      {
        id: 'generating-functions',
        title: 'Generating Functions',
        blurb: 'Encode a sequence as the coefficients of a power series.',
        strategicAnchor:
          'f(x) = Σ aₙxⁿ. Standard moves: 1/(1−x) = 1 + x + x² + ⋯; 1/(1−x)ᵏ generates C(n+k−1, k−1). Multiplying two GFs convolves the sequences. Useful for solving recurrences, counting partitions, and combinatorial identities.',
        exampleProblem:
          'Find the coefficient of $x^{10}$ in $(1 + x + x^2 + \\cdots)^4$.',
      },
      {
        id: 'binomial-theorem',
        title: 'Binomial Theorem',
        blurb: '(x + y)ⁿ = Σ C(n,k) xᵏ yⁿ⁻ᵏ — and a family of identities.',
        strategicAnchor:
          "Coefficients are the binomial coefficients C(n,k). Identities to know: Pascal's rule C(n,k) = C(n−1,k−1) + C(n−1,k); hockey-stick; row sum 2ⁿ. Combinatorial proofs match an identity to a counting problem.",
        exampleProblem: 'Find the coefficient of $x^4$ in $(2x - 3)^7$.',
      },
    ],
  },
  {
    id: 'linear-algebra',
    title: 'Linear Algebra',
    blurb: 'Vectors, matrices, eigenvalues, span, rank, decompositions.',
    topics: [
      {
        id: 'row-reduction',
        title: 'Row Reduction (RREF)',
        blurb: 'Reduce a matrix to RREF via elementary row operations — one op at a time.',
        strategicAnchor:
          'Three elementary operations: swap two rows, multiply a row by a nonzero scalar, add a multiple of one row to another. Pick a pivot, zero out below, move to the next pivot. Each operation is its own line — never compound two row ops.',
        exampleProblem:
          'Reduce to RREF: $$\\begin{bmatrix} 1 & 2 & 1 \\\\ 2 & 3 & 3 \\\\ 1 & 1 & 2 \\end{bmatrix}$$',
      },
      {
        id: 'determinants',
        title: 'Determinants',
        blurb: 'A scalar that captures invertibility, area/volume scaling, orientation.',
        strategicAnchor:
          '2×2: ad − bc. 3×3: cofactor expansion along any row or column (pick the one with the most zeros). Larger: row-reduce and track each elementary operation’s effect on the determinant.',
        exampleProblem:
          'Compute: $$\\det \\begin{bmatrix} 2 & 0 & 1 \\\\ 1 & 3 & 2 \\\\ 0 & 1 & 1 \\end{bmatrix}$$',
      },
      {
        id: 'eigenvalues',
        title: 'Eigenvalues & Eigenvectors',
        blurb: 'Find scalars λ and vectors v with Av = λv.',
        strategicAnchor:
          'Solve det(A − λI) = 0 for the characteristic polynomial’s roots — those are the eigenvalues. For each λ, find the null space of (A − λI) — those are the eigenvectors. Triangular matrices: eigenvalues are the diagonal entries; no work needed.',
        exampleProblem:
          'Find the eigenvalues and eigenvectors of $A = \\begin{bmatrix} 4 & -2 \\\\ 1 & 1 \\end{bmatrix}$.',
      },
      {
        id: 'span-basis-dimension',
        title: 'Span, Basis, Dimension',
        blurb: 'Span: all linear combinations. Basis: minimal spanning set. Dimension: size of any basis.',
        strategicAnchor:
          'Linear independence test: form a matrix with vectors as columns, row-reduce, look for a pivot in every column. To find a basis for a subspace: take a spanning set and drop the dependent vectors. Dimension is the count of basis vectors — same for any basis.',
        exampleProblem:
          'Are $\\langle 1, 2, 3 \\rangle$, $\\langle 2, 4, 6 \\rangle$, $\\langle 1, 0, 1 \\rangle$ linearly independent?',
      },
      {
        id: 'inner-products-orthogonality',
        title: 'Inner Products & Orthogonality',
        blurb: 'Dot products, vector lengths, perpendicular vectors, Gram-Schmidt.',
        strategicAnchor:
          'u · v = u₁v₁ + ⋯ + uₙvₙ. Norm: |v| = √(v · v). Orthogonal iff u · v = 0. Use Gram-Schmidt to convert any basis into an orthogonal basis.',
        exampleProblem:
          'Use Gram-Schmidt on $\\langle 1, 1, 0 \\rangle$ and $\\langle 1, 0, 1 \\rangle$.',
      },
      {
        id: 'matrix-decompositions',
        title: 'Matrix Decompositions',
        blurb: 'Factor a matrix into pieces that reveal structure (LU, QR, SVD).',
        strategicAnchor:
          'LU: row reduction without row swaps; A = LU. QR: orthogonalize columns via Gram-Schmidt; A = QR with Q orthogonal. SVD: A = UΣVᵀ; works for any matrix; Σ holds the singular values. Pick by what you need: LU for solving systems; QR for least squares; SVD for the deepest structural read.',
        exampleProblem:
          'Find the LU decomposition of $A = \\begin{bmatrix} 2 & 1 & 1 \\\\ 4 & 3 & 3 \\\\ 8 & 7 & 9 \\end{bmatrix}$.',
      },
    ],
  },
];

export const COURSES_BY_ID: Record<string, Course> = Object.fromEntries(
  COURSES.map((c) => [c.id, c]),
);

export function topicById(courseId: string, topicId: string): Topic | undefined {
  return COURSES_BY_ID[courseId]?.topics.find((t) => t.id === topicId);
}
