import { describe, it, expect } from 'vitest';
import { hasUnsafeTex, mmdToTex, wrapTexSource } from './latex';

describe('hasUnsafeTex', () => {
  it('catches file and shell access however it is spelled', () => {
    for (const src of [
      '$\\input{/etc/passwd}$',
      '\\include{secrets}',
      '\\InputIfFileExists{x}{}{}',
      '\\openin\\f=/etc/passwd',
      '\\immediate\\write18{ls}',
      '\\write18{id}',
      '\\directlua{os.execute("id")}',
      '\\catcode`\\@=11',
      '\\csname input\\endcsname{x}',
      '\\pdffiledump offset 0 length 100 {/etc/passwd}',
    ]) {
      expect(hasUnsafeTex(src), src).toBe(true);
    }
  });

  it('leaves ordinary homework and the wrapper alone', () => {
    for (const src of [
      'Solve $\\frac{1}{2}x + 3 = 7$ for $x$.',
      '$$\\int_0^1 x^2 \\, dx = \\frac{1}{3}$$',
      '\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}',
      // Names that merely start with a guarded word are different commands.
      '\\includegraphics{fig.png} \\readline \\writeup',
    ]) {
      expect(hasUnsafeTex(src), src).toBe(false);
    }
    expect(hasUnsafeTex(wrapTexSource(mmdToTex('Hello $x^2$'), { title: 'Homework' }))).toBe(false);
  });
});
