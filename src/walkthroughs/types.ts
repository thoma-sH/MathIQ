export interface Topic {
  id: string;
  title: string;
  blurb: string;
  /**
   * The teaching tip — the trigger condition or strategic anchor for this
   * topic. Shown to the student before any AI call so they can read it
   * deliberately. Should fit in 1–3 short sentences.
   */
  strategicAnchor: string;
  /**
   * Canonical example problem in LaTeX (no surrounding $...$ delimiters —
   * the renderer will wrap it).
   */
  exampleProblem: string;
}

export interface Course {
  id: string;
  title: string;
  blurb: string;
  topics: Topic[];
}
