/**
 * Frame coalescing for resize bursts (Phaser-free so it is unit-testable).
 *
 * A browser emits `resize` on every animation frame while a window is dragged,
 * and a device orientation change can emit a handful in quick succession. Every
 * notification would otherwise re-run the stage layout — camera zoom/centre,
 * backdrop resize, re-anchoring — dozens of times for a single visual change.
 *
 * `createCoalescer` collapses a burst into ONE run scheduled for the next
 * animation frame. It only ever defers a callback; it never queues arguments, so
 * memory stays flat and (critically) no game object or texture is created by a
 * resize — the layout only repositions objects that already exist.
 */

export interface Coalescer {
  /** Request a run on the next tick. Repeated calls in the same tick collapse. */
  schedule(): void;
  /** True while a run is queued but not yet executed. */
  readonly pending: boolean;
  /** How many times the callback has actually run (test/QA introspection). */
  readonly runs: number;
}

export interface CoalescerHost {
  /** Schedules `cb` for the next frame. Defaults to requestAnimationFrame. */
  defer?: (cb: () => void) => void;
}

/**
 * Wraps `cb` so any number of `schedule()` calls within one frame produce a
 * single `cb()` invocation, with the state as of the moment it runs.
 */
export function createCoalescer(cb: () => void, host: CoalescerHost = {}): Coalescer {
  const defer =
    host.defer ??
    ((fn: () => void): void => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
      else fn();
    });

  let pending = false;
  let runs = 0;

  return {
    schedule(): void {
      if (pending) return;
      pending = true;
      defer(() => {
        pending = false;
        runs += 1;
        cb();
      });
    },
    get pending(): boolean {
      return pending;
    },
    get runs(): number {
      return runs;
    },
  };
}
