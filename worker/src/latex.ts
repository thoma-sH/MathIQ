/**
 * LaTeX compile pipeline. Pro feature — turns Mathpix Markdown (.mmd) of
 * a student's handwritten work into a Computer Modern-typeset PDF.
 *
 * Three stages:
 *   1. mmdToTex()    — convert Mathpix Markdown to a LaTeX body.
 *   2. wrapTexSource()— wrap in a standalone document with preamble.
 *   3. compileLatex() — POST to TeXLive.net's latexcgi, return PDF bytes.
 *
 * Compile service: TeXLive.net (free, run by David Carlisle, CTAN
 * maintainer). The single LATEX_COMPILE_URL constant below is what to
 * swap if/when we migrate to self-hosted ytotech/latex-on-http on Fly.io.
 */

const LATEX_COMPILE_URL = 'https://texlive.net/cgi-bin/latexcgi';

export interface LatexCompileResult {
  ok: boolean;
  status: number;
  pdfBase64?: string;
  /** Compile log or error message; truncated to keep KV-friendly. */
  detail?: string;
}

/**
 * Convert Mathpix Markdown to a LaTeX body fragment.
 *
 * .mmd is a hybrid format: plain text + inline `$...$` math + display
 * `$$...$$` math. The math is already valid LaTeX, so we pass it through.
 * The text needs LaTeX escaping plus a few markdown→TeX transforms
 * (bold/italic/headers/lists). Tables are skipped — rare in math homework.
 */
export function mmdToTex(mmd: string): string {
  const tokens = tokenizeMath(mmd);
  let out = '';
  for (const t of tokens) {
    if (t.type === 'imath') out += '$' + t.content + '$';
    else if (t.type === 'dmath') out += '\n\\[' + t.content.trim() + '\\]\n';
    else out += processTextBlock(t.content);
  }
  return out;
}

type Token = { type: 'text' | 'imath' | 'dmath'; content: string };

function tokenizeMath(mmd: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let buf = '';
  const flushText = () => {
    if (buf.length > 0) {
      tokens.push({ type: 'text', content: buf });
      buf = '';
    }
  };
  while (i < mmd.length) {
    // Display math $$...$$
    if (mmd[i] === '$' && mmd[i + 1] === '$') {
      const end = mmd.indexOf('$$', i + 2);
      if (end < 0) {
        buf += mmd.slice(i);
        i = mmd.length;
      } else {
        flushText();
        tokens.push({ type: 'dmath', content: mmd.slice(i + 2, end) });
        i = end + 2;
      }
      continue;
    }
    // Inline math $...$ — but skip escaped \$
    if (mmd[i] === '$' && mmd[i - 1] !== '\\') {
      const end = findInlineMathEnd(mmd, i + 1);
      if (end < 0) {
        buf += mmd[i];
        i++;
      } else {
        flushText();
        tokens.push({ type: 'imath', content: mmd.slice(i + 1, end) });
        i = end + 1;
      }
      continue;
    }
    buf += mmd[i];
    i++;
  }
  flushText();
  return tokens;
}

function findInlineMathEnd(s: string, start: number): number {
  let i = start;
  while (i < s.length) {
    if (s[i] === '\\' && i + 1 < s.length) {
      i += 2;
      continue;
    }
    if (s[i] === '$') return i;
    if (s[i] === '\n' && s[i + 1] === '\n') return -1; // paragraph break breaks math
    i++;
  }
  return -1;
}

/**
 * Process a text block (no math inside): handle headers, bold/italic,
 * lists, and escape LaTeX-special characters in the remaining text.
 */
function processTextBlock(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let inList: 'itemize' | 'enumerate' | null = null;

  const closeList = () => {
    if (inList) {
      out.push(`\\end{${inList}}`);
      inList = null;
    }
  };

  for (const rawLine of lines) {
    // List items
    const ulMatch = rawLine.match(/^(\s*)[-*+]\s+(.*)$/);
    const olMatch = rawLine.match(/^(\s*)\d+\.\s+(.*)$/);
    if (ulMatch) {
      if (inList !== 'itemize') { closeList(); out.push('\\begin{itemize}'); inList = 'itemize'; }
      out.push('  \\item ' + inlineFormat(ulMatch[2]));
      continue;
    }
    if (olMatch) {
      if (inList !== 'enumerate') { closeList(); out.push('\\begin{enumerate}'); inList = 'enumerate'; }
      out.push('  \\item ' + inlineFormat(olMatch[2]));
      continue;
    }

    // Blank line — Mathpix and ReactMarkdown allow blank lines between
    // adjacent list items for visual spacing. Closing the list on every
    // blank line would restart \enumerate from 1 for each item, which
    // is why a 5-item list rendered as five "1." entries instead of
    // 1-2-3-4-5. Pass the blank through and keep the list open.
    if (rawLine.trim() === '') {
      out.push('');
      continue;
    }

    // Real content line — now close any open list.
    closeList();

    // Headers
    if (rawLine.startsWith('### ')) {
      out.push(`\\subsubsection*{${inlineFormat(rawLine.slice(4))}}`);
    } else if (rawLine.startsWith('## ')) {
      out.push(`\\subsection*{${inlineFormat(rawLine.slice(3))}}`);
    } else if (rawLine.startsWith('# ')) {
      out.push(`\\section*{${inlineFormat(rawLine.slice(2))}}`);
    } else {
      out.push(inlineFormat(rawLine));
    }
  }
  closeList();
  return out.join('\n');
}

/**
 * Apply inline markdown formatting (`**bold**`, `*italic*`) and escape
 * LaTeX-special characters in the remaining text. Math has already been
 * tokenized out by tokenizeMath() so we don't have to worry about it here.
 *
 * Strategy: replace markdown markers with stash placeholders BEFORE
 * escaping LaTeX specials, then re-substitute. The placeholders use NUL
 * bytes which escapeLatex never touches, so they survive intact.
 */
function inlineFormat(text: string): string {
  const stash: string[] = [];
  const store = (latex: string) => {
    const i = stash.length;
    stash.push(latex);
    return `\x00${i}\x00`;
  };

  let s = text;
  // Bold first (longer marker wins over italic)
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, (_, body) => store(`\\textbf{${escapeLatex(body)}}`));
  s = s.replace(/__([^_\n]+?)__/g, (_, body) => store(`\\textbf{${escapeLatex(body)}}`));
  // Italic
  s = s.replace(/\*([^*\n]+?)\*/g, (_, body) => store(`\\textit{${escapeLatex(body)}}`));
  s = s.replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, (_, body) => store(`\\textit{${escapeLatex(body)}}`));

  // Escape the remaining (non-stashed) text.
  s = escapeLatex(s);

  // Restore stashed segments.
  s = s.replace(/\x00(\d+)\x00/g, (_, i) => stash[Number(i)]);

  return s;
}

function escapeLatex(text: string): string {
  return text
    // Backslash first — order matters so we don't double-escape replacements.
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[&%#_{}]/g, (c) => `\\${c}`)
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

/**
 * Wrap a LaTeX body fragment in a standalone document. Computer Modern
 * (default font) gives the classic LaTeX look the Pro user is paying for.
 */
export function wrapTexSource(body: string, options: { title?: string } = {}): string {
  const titleBlock = options.title
    ? `\\title{\\color{mathiqInk}${escapeLatex(options.title)}}\n\\date{}\n\\maketitle\n\n`
    : '';
  return `\\documentclass[11pt]{article}
\\usepackage[a4paper,margin=1in]{geometry}
\\usepackage{amsmath,amssymb,amsfonts}
\\usepackage{enumerate}
\\usepackage{graphicx}
\\usepackage[dvipsnames]{xcolor}
\\usepackage{titlesec}
\\usepackage{microtype}

% MathIQ brand colors
\\definecolor{mathiqInk}{HTML}{1A2B1A}
\\definecolor{mathiqAccent}{HTML}{1A4D6E}
\\definecolor{mathiqAccent2}{HTML}{3D6E5F}

% Color section headers with the brand accent
\\titleformat{\\section}{\\normalfont\\Large\\bfseries\\color{mathiqAccent}}{\\thesection}{1em}{}
\\titleformat{name=\\section,numberless}{\\normalfont\\Large\\bfseries\\color{mathiqAccent}}{}{0em}{}
\\titleformat{\\subsection}{\\normalfont\\large\\bfseries\\color{mathiqAccent2}}{\\thesubsection}{1em}{}
\\titleformat{name=\\subsection,numberless}{\\normalfont\\large\\bfseries\\color{mathiqAccent2}}{}{0em}{}

\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{0.5em}
\\begin{document}
${titleBlock}${body}
\\end{document}
`;
}

// ──────────────────────────────────────────────────────────────────────────
// Claude-based mmd → LaTeX conversion (the premium path)
// ──────────────────────────────────────────────────────────────────────────

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const LATEX_MODEL = 'claude-sonnet-4-6';

const LATEX_GENERATION_PROMPT = `You are converting cleaned Mathpix Markdown of a student's handwritten math notes into a publication-quality LaTeX document. The output goes to pdflatex — it must compile cleanly the first time, no manual fixups.

## What you receive

A single body of Mathpix Markdown text. It has already been cleaned:
- English typos already corrected
- Section breaks already inserted as \`##\` / \`###\` markdown headers
- Math wrapped in \`$...$\` (inline) and \`$$...$$\` (display) delimiters
- Lists marked with \`1.\` or \`-\` (markdown style)

You also receive a document title.

## What you return

A COMPLETE LaTeX document. The very first character must be \`\\\` (the backslash starting \`\\documentclass\`). The very last character must be \`}\` (the closing brace of \`\\end{document}\`). NO preamble like "Here is the LaTeX:". NO trailing prose. NO markdown code fences. Just the .tex source, raw.

## Document structure

ALWAYS emit this exact preamble — no substitutions. The colors and titlesec calls are the MathIQ brand applied to the document.

\\documentclass[11pt]{article}
\\usepackage[a4paper,margin=1in]{geometry}
\\usepackage{amsmath,amssymb,amsfonts}
\\usepackage{enumerate}
\\usepackage{graphicx}
\\usepackage[dvipsnames]{xcolor}
\\usepackage{titlesec}
\\usepackage{microtype}

% MathIQ brand colors
\\definecolor{mathiqInk}{HTML}{1A2B1A}
\\definecolor{mathiqAccent}{HTML}{1A4D6E}
\\definecolor{mathiqAccent2}{HTML}{3D6E5F}

% Apply the accent to every section/subsection header
\\titleformat{\\section}{\\normalfont\\Large\\bfseries\\color{mathiqAccent}}{\\thesection}{1em}{}
\\titleformat{name=\\section,numberless}{\\normalfont\\Large\\bfseries\\color{mathiqAccent}}{}{0em}{}
\\titleformat{\\subsection}{\\normalfont\\large\\bfseries\\color{mathiqAccent2}}{\\thesubsection}{1em}{}
\\titleformat{name=\\subsection,numberless}{\\normalfont\\large\\bfseries\\color{mathiqAccent2}}{}{0em}{}

\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{0.5em}

\\title{\\color{mathiqInk}<the provided title, escaped>}
\\date{}
\\begin{document}
\\maketitle

<converted content>

\\end{document}

## Conversion rules

- **Math content**: pass through EVERY \`$...$\` and \`$$...$$\` block unchanged. The math is the student's; the cleanup pass already validated it. Do not "improve" math, do not rewrite \`\\lim_{x \\to a}\` as \`\\lim_{x\\to a}\`, do not change which side of an equation a term is on. If the cleaned mmd has \`$\\lim_{x \\to a} f(x)$\` your output has \`$\\lim_{x \\to a} f(x)$\` byte-for-byte.
- **Markdown headers**: \`## X\` → \`\\section*{X}\`, \`### X\` → \`\\subsection*{X}\`, \`#### X\` → \`\\subsubsection*{X}\`. Always starred so they're unnumbered (the student's notes aren't a real article).
- **Ordered lists**: a run of \`1. item\` / \`2. item\` / etc. → \`\\begin{enumerate}\\item ... \\item ... \\end{enumerate}\`. Sequential items belong in ONE enumerate environment regardless of how many blank lines Mathpix put between them.
- **Unordered lists**: \`-\` / \`*\` / \`+\` markers → \`\\begin{itemize}\\item ... \\end{itemize}\`.
- **Inline emphasis**: \`**bold**\` → \`\\textbf{bold}\`, \`*italic*\` → \`\\textit{italic}\`, \`__bold__\` → \`\\textbf{bold}\`, \`_italic_\` → \`\\textit{italic}\`.
- **Display equations** between paragraphs (\`$$...$$\` on its own line): keep as \`$$...$$\` OR upgrade to \`\\[...\\]\` — both compile.
- **Multi-line aligned blocks** inside \`$$\` (using \`\\begin{aligned}\`): keep as-is. amsmath handles them.
- **Special characters in text mode**: escape \`&\`, \`%\`, \`#\`, \`_\`, \`{\`, \`}\` outside math. Unicode arrows / Greek letters that appear OUTSIDE math should also stay literal — pdflatex with inputenc handles modern UTF-8 fine.
- **Empty content**: if a section in the mmd has no body, still emit the section header — just leave the section empty.

## Quality bar

This output is the premium-tier promise. It should look like a competent grad student typeset it in Overleaf — proper environments, real LaTeX spacing, clean section structure. NOT like a mechanical Markdown → LaTeX dump.

If the cleaned mmd is empty or unreadable, emit a minimal valid document with the title and an "(empty)" body. Never throw.`;

/**
 * Convert cleaned Mathpix Markdown to a complete LaTeX document via Claude.
 * Premium-tier path — produces real typeset structure (enumerate, sections,
 * theorem-style environments where applicable) instead of the mechanical
 * 1:1 substitution our hand-rolled converter does.
 *
 * Returns `{ ok: true, tex: '...' }` on success. Callers should fall back
 * to the hand-rolled `mmdToTex() + wrapTexSource()` path on any failure.
 */
export async function generateLatexFromMmd(params: {
  apiKey: string;
  mmd: string;
  title?: string;
}): Promise<{ ok: boolean; tex?: string; detail?: string }> {
  const { apiKey, mmd, title } = params;

  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: LATEX_MODEL,
      max_tokens: 8192,
      system: LATEX_GENERATION_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Title: ${title ?? 'Homework'}\n\nCleaned Mathpix Markdown:\n\n---\n${mmd}\n---\n\nReturn the complete LaTeX document only.`,
        },
      ],
    }),
  });

  if (!resp.ok) {
    const detail = (await resp.text().catch(() => '')).slice(0, 500);
    return { ok: false, detail: `latex-gen http ${resp.status}: ${detail}` };
  }

  const data = (await resp.json()) as {
    content?: Array<{ type: string; text?: string }>;
    error?: { message?: string };
  };
  if (data.error) {
    return { ok: false, detail: data.error.message ?? 'latex-gen error' };
  }

  const text = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim();
  if (!text) return { ok: false, detail: 'latex-gen returned empty text' };

  // Strip defensive prose: find the first \documentclass and the last
  // \end{document}, trim to that. Tolerates any wrapping fences or
  // commentary Claude might add despite the prompt's instructions.
  const startIdx = text.indexOf('\\documentclass');
  const endMarker = '\\end{document}';
  const endIdx = text.lastIndexOf(endMarker);
  if (startIdx < 0 || endIdx <= startIdx) {
    return { ok: false, detail: 'latex-gen output missing \\documentclass or \\end{document}' };
  }
  const tex = text.slice(startIdx, endIdx + endMarker.length);

  return { ok: true, tex };
}

/**
 * Submit a complete .tex source to TeXLive.net and get back the compiled
 * PDF as base64. Returns a structured result so the caller can show a
 * "Download .tex source" fallback when the compile fails.
 */
export async function compileLatex(tex: string): Promise<LatexCompileResult> {
  const form = new FormData();
  form.append('filename[]', 'document.tex');
  form.append('filecontents[]', tex);
  form.append('return', 'pdf');
  form.append('engine', 'pdflatex');

  let resp: Response;
  try {
    resp = await fetch(LATEX_COMPILE_URL, { method: 'POST', body: form });
  } catch (e) {
    return { ok: false, status: 502, detail: `LaTeX compile fetch failed: ${(e as Error).message}` };
  }

  const contentType = resp.headers.get('content-type') ?? '';

  if (!resp.ok) {
    const detail = (await resp.text().catch(() => '')).slice(0, 800);
    return { ok: false, status: resp.status, detail };
  }

  // TeXLive.net returns the PDF as application/pdf on success.
  // On compile error, it returns the .log as text/plain (HTTP 200 still — annoying).
  if (!contentType.toLowerCase().includes('pdf')) {
    const log = (await resp.text().catch(() => '')).slice(0, 1200);
    return { ok: false, status: 502, detail: `LaTeX compile failed:\n${log}` };
  }

  const buf = await resp.arrayBuffer();
  return {
    ok: true,
    status: 200,
    pdfBase64: arrayBufferToBase64(buf),
  };
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  // Chunk to avoid call-stack limits on String.fromCharCode for large PDFs.
  const chunk = 0x8000;
  let s = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}
