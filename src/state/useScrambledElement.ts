import { useLayoutEffect, type RefObject } from 'react';

/**
 * Decodes already-rendered content in place, by permuting the glyphs that are
 * on screen rather than swapping a plain-text stand-in for a typeset one.
 *
 * The earlier approach scrambled the raw LaTeX in a monospace overlay and
 * handed off to KaTeX at the end, which meant the font and size changed the
 * instant the decode finished. Here there is no handoff: the typeset output is
 * what scrambles, so nothing about it ever changes but the characters.
 *
 * The constraint that shapes everything below is that KaTeX emits one text
 * node per character (`4`, `x`, `3`, `y`, …), so characters must move *between*
 * nodes to be visible — and in proportional math fonts a moved character
 * changes its node's width and reflows the equation on every frame.
 *
 * So a character is only ever exchanged with one that measures the same width.
 * Widths are measured once, per character, with a Range; slots are bucketed by
 * that measurement; and permutation happens strictly within a bucket. Every
 * node's width is then the sum of the same widths it started with, and the
 * layout cannot move. Digits in KaTeX's math fonts share a width, so they
 * shuffle freely among themselves; a glyph that is unique in width simply
 * stays put.
 *
 * Whitespace is excluded outright — moving a space would change where lines
 * wrap even though total width is unchanged.
 */
const FRAME_MS = 35;
const DURATION_MS = 2000;
const FRAMES = Math.round(DURATION_MS / FRAME_MS);

/** Width match tolerance, in px. Tight enough that nothing visibly shifts,
 *  loose enough to absorb sub-pixel measurement noise. */
const WIDTH_EPSILON = 0.25;

interface Slot {
  node: Text;
  index: number;
  char: string;
  bucket: number;
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
  const range = document.createRange();
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const node = n as Text;
    const text = node.nodeValue ?? '';
    nodes.set(node, text);
    for (let i = 0; i < text.length; i++) {
      if (/\s/.test(text[i])) continue;
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const width = range.getBoundingClientRect().width;
      slots.push({
        node,
        index: i,
        char: text[i],
        bucket: Math.round(width / WIDTH_EPSILON),
      });
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
    // real font would then arrive mid-decode and every "same width" swap would
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

    // Slot indices grouped by measured width — the only sets within which a
    // character may move.
    const byBucket = new Map<number, number[]>();
    slots.forEach((slot, i) => {
      const group = byBucket.get(slot.bucket);
      if (group) group.push(i);
      else byBucket.set(slot.bucket, [i]);
    });

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
      const chars = slots.map((s) => s.char);
      for (const group of byBucket.values()) {
        // Only the slots this bucket still has behind the decode front are in
        // play; everything the front has passed is already final.
        const open = group.filter((i) => i >= front);
        const pool = open.map((i) => slots[i].char);
        for (let i = pool.length - 1; i > 0; i--) {
          const j = (Math.random() * (i + 1)) | 0;
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        open.forEach((slotIndex, k) => {
          chars[slotIndex] = pool[k];
        });
      }
      commit(nodes, slots, chars);
    }, FRAME_MS);

    teardown = () => {
      window.clearInterval(id);
      restore();
    };
  }
  }, [ref, token, enabled]);
}
