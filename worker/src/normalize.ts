/**
 * Server-side LaTeX delimiter normalization.
 *
 * Some models (notably smaller ones) emit math wrapped in `\(...\)` or
 * `\[...\]` regardless of the system-prompt directive. Our markdown
 * renderer (remark-math + rehype-katex) only understands `$...$` and
 * `$$...$$`. We transform on the way out so the client always sees
 * KaTeX-compatible delimiters.
 *
 * Tricky bit: the input is a streaming text response, so a backslash may
 * arrive at the end of one chunk and its mate (`(`/`)`/`[`/`]`) in the
 * next. We hold a trailing backslash back until we know the next char.
 */
export function normalizeLatexDelimiters(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pendingBackslash = false;

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      let text = decoder.decode(chunk, { stream: true });

      if (pendingBackslash) {
        text = '\\' + text;
        pendingBackslash = false;
      }
      if (text.endsWith('\\')) {
        pendingBackslash = true;
        text = text.slice(0, -1);
      }

      // Order matters: replace `\[`/`\]` first so they don't get confused
      // with `\(`/`\)` (they share the leading backslash).
      text = text
        .replaceAll('\\[', '$$')
        .replaceAll('\\]', '$$')
        .replaceAll('\\(', '$')
        .replaceAll('\\)', '$');

      if (text) controller.enqueue(encoder.encode(text));
    },
    flush(controller) {
      if (pendingBackslash) {
        controller.enqueue(encoder.encode('\\'));
      }
    },
  });
}
