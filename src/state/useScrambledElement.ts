import { useLayoutEffect, type RefObject } from 'react';

/**
 * Decodes already-rendered content in place, by substituting the glyphs on
 * screen rather than swapping a plain-text stand-in for a typeset one. There
 * is no handoff, so the font and size never change — only the characters.
 *
 * The constraint that shapes everything below is that KaTeX emits one text
 * node per character (`4`, `x`, `3`, `y`, …), so characters must change
 * *within* those nodes to be visible, and in proportional math fonts a
 * different character means a different width, which reflows the equation on
 * every frame.
 *
 * So a slot is only ever filled with a glyph that measures the same width in
 * that slot's own font. Every candidate is measured once per font context, and
 * pools are keyed by (font, width). Each node's width therefore stays the sum
 * of the same widths it started with, and the layout cannot move.
 *
 * An earlier version permuted the problem's own characters instead. That was
 * width-safe for free, but a bucket usually held only two or three of them, so
 * the same glyphs visibly cycled back and forth rather than looking random.
 * Drawing from a measured candidate set fixes that: every unlocked slot picks
 * independently, every frame.
 *
 * Candidates that a font lacks are self-excluding — they fall back to another
 * face, measure a different width, and land in a bucket no slot in this font
 * asks for.
 *
 * Whitespace is never touched: moving a space preserves total width but
 * changes where lines wrap.
 */
const FRAME_MS = 35;
const DURATION_MS = 2500;
const FRAMES = Math.round(DURATION_MS / FRAME_MS);

/** Width match tolerance in px — tight enough that nothing visibly shifts,
 *  loose enough to absorb sub-pixel measurement noise. */
const WIDTH_EPSILON = 0.25;

const CANDIDATES =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' +
  '#@$%&*+=~^<>?/\|!:;.,-_()[]{}░▒▓';

interface Slot {
  node: Text;
  index: number;
  char: string;
  /** Candidate glyphs of this slot's exact width, in this slot's exact font. */
  pool: string[];
}

const FONT_PROPS = [
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'fontVariant',
  'letterSpacing',
] as const;

function fontKey(style: CSSStyleDeclaration): string {
  return FONT_PROPS.map((p) => style[p]).join('|');
}

/** Measures every candidate in one layout pass for a given font, returning
 *  width bucket -> glyphs. */
function measurePools(style: CSSStyleDeclaration): Map<number, string[]> {
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;top:-9999px;left:-9999px;visibility:hidden;white-space:pre;';
  for (const p of FONT_PROPS) host.style[p] = style[p];

  const spans = [...CANDIDATES].map((ch) => {
    const span = document.createElement('span');
    span.textContent = ch;
    host.appendChild(span);
    return span;
  });
  document.body.appendChild(host);

  // All writes are done; every read below hits the same single layout.
  const pools = new Map<number, string[]>();
  spans.forEach((span, i) => {
    const bucket = Math.round(span.getBoundingClientRect().width / WIDTH_EPSILON);
    const group = pools.get(bucket);
    if (group) group.push(CANDIDATES[i]);
    else pools.set(bucket, [CANDIDATES[i]]);
  });

  host.remove();
  return pools;
}

function collectSlots(root: HTMLElement): { slots: Slot[]; nodes: Map<Text, string> } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      // KaTeX emits a MathML copy alongside the visual HTML for assistive
      // tech. It is invisible, so scrambling it would achieve nothing except
      // corrupting what a screen reader announces mid-decode.
      if (n.parentElement?.closest('.katex-mathml')) return NodeFilter.FILTER_REJECT;
      return n.nodeValue?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  const slots: Slot[] = [];
  const nodes = new Map<Text, string>();
  const poolsByFont = new Map<string, Map<number, string[]>>();
  const range = document.createRange();

  let n: Node | null;
  while ((n = walker.nextNode())) {
    const node = n as Text;
    const parent = node.parentElement;
    if (!parent) continue;
    const text = node.nodeValue ?? '';
    nodes.set(node, text);

    const style = window.getComputedStyle(parent);
    const key = fontKey(style);
    let pools = poolsByFont.get(key);
    if (!pools) {
      pools = measurePools(style);
      poolsByFont.set(key, pools);
    }

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (/\s/.test(char)) continue;
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const bucket = Math.round(range.getBoundingClientRect().width / WIDTH_EPSILON);
      // The character's own glyph is always a legal fill for its own slot,
      // even when no candidate happened to measure the same.
      const pool = pools.get(bucket) ?? [];
      slots.push({ node, index: i, char, pool: pool.length ? pool : [char] });
    }
  }

  range.detach?.();
  return { slots, nodes };
}

/** Rewrites every node from its slots, leaving whitespace where it was. */
function commit(nodes: Map<Text, string>, slots: Slot[], chars: string[]): void {
  const buffers = new Map<Text, string[]>();
  for (const [node, original] of nodes) buffers.set(node, original.split(''));
  slots.forEach((slot, i) => {
    buffers.get(slot.node)![slot.index] = chars[i];
  });
  for (const [node, buf] of buffers) {
    const next = buf.join('');
    if (node.nodeValue !== next) node.nodeValue = next;
  }
}

export function useScrambledElement(
  ref: RefObject<HTMLElement | null>,
  /** Changing this starts a fresh decode. Null means never decode. */
  token: string | null,
  enabled: boolean,
): void {
  useLayoutEffect(() => {
    if (!enabled || !token || !ref.current) return;

    let cancelled = false;
    let teardown: (() => void) | null = null;

    // Widths are the whole basis of the no-reflow guarantee, and measuring
    // them before KaTeX's webfonts land would measure the fallback face — the
    // real font would then arrive mid-decode and every "same width" fill would
    // stop being one. Cheap when the fonts are already cached.
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (fonts && fonts.status !== 'loaded') void fonts.ready.then(begin);
    else begin();

    return () => {
      cancelled = true;
      teardown?.();
    };

    function begin() {
      const root = ref.current;
      if (cancelled || !root) return;

      const { slots, nodes } = collectSlots(root);
      if (slots.length === 0) return;

      const restore = () => commit(nodes, slots, slots.map((s) => s.char));

      let frame = 0;
      const id = window.setInterval(() => {
        frame += 1;
        if (frame > FRAMES) {
          window.clearInterval(id);
          restore();
          return;
        }
        const front = (frame / FRAMES) * slots.length;
        commit(
          nodes,
          slots,
          slots.map((slot, i) =>
            i < front ? slot.char : slot.pool[(Math.random() * slot.pool.length) | 0],
          ),
        );
      }, FRAME_MS);

      teardown = () => {
        window.clearInterval(id);
        restore();
      };
    }
  }, [ref, token, enabled]);
}
