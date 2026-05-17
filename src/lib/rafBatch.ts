// Coalesces high-frequency updates to one call per animation frame.
// Used by the streaming hot path so a 50-chunk burst from the network
// produces ~3 React commits instead of 50.

export interface RafBatcher<T> {
  push(value: T): void;
  flush(): void;
  cancel(): void;
}

export function createRafBatcher<T>(apply: (value: T) => void): RafBatcher<T> {
  let pending: { value: T } | null = null;
  let frame = 0;

  function tick() {
    frame = 0;
    if (pending) {
      const v = pending.value;
      pending = null;
      apply(v);
    }
  }

  return {
    push(value: T) {
      pending = { value };
      if (frame) return;
      frame = requestAnimationFrame(tick);
    },
    flush() {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      if (pending) {
        const v = pending.value;
        pending = null;
        apply(v);
      }
    },
    cancel() {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      pending = null;
    },
  };
}
