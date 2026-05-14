/**
 * Imperative entry point for the Scanner — call `openScanner(opts)` and
 * await a single `ScannerOutput | null`. The modal mounts itself under
 * <body>, manages its own portal lifecycle, and unmounts cleanly when the
 * user finishes or cancels.
 *
 * Scanner.tsx is dynamically imported so the ~10MB OpenCV.js (and the
 * scanner UI alongside it) doesn't ride along with the main bundle for
 * users who never hit a scan button.
 */
import { createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Scanner as ScannerType, ScannerOptions, ScannerOutput } from './Scanner';

export type { ScannerOutput, ScannerOptions } from './Scanner';

export async function openScanner(opts: ScannerOptions): Promise<ScannerOutput | null> {
  const { Scanner } = await import('./Scanner');
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.dataset.scannerHost = '1';
    document.body.appendChild(host);
    const root: Root = createRoot(host);

    function teardown() {
      // Defer unmount to the next tick so React finishes its current
      // commit phase before we tear down — calling root.unmount() from
      // inside an effect's setState chain throws otherwise.
      window.setTimeout(() => {
        try {
          root.unmount();
        } catch {
          // ignore
        }
        if (host.parentNode) host.parentNode.removeChild(host);
      }, 0);
    }

    const props: ComponentProps<typeof ScannerType> = {
      ...opts,
      onComplete: (out) => {
        teardown();
        resolve(out);
      },
      onCancel: () => {
        teardown();
        resolve(null);
      },
    };

    root.render(createElement(Scanner, props));
  });
}
