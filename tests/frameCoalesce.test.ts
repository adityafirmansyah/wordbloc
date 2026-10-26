import { describe, expect, it, vi } from 'vitest';
import { createCoalescer } from '../src/ui/frameCoalesce';

/**
 * Resize bursts must not multiply layout work (60fps constraint in the defect
 * report: "RESIZE must not re-create textures per resize event — debounce or
 * verify atlas unaffected").
 *
 * The coalescer is the debounce half of that requirement: any number of resize
 * notifications arriving before the next animation frame collapse into exactly
 * one layout pass, and the pass always reads the LATEST state (a stale queued
 * run would leave the stage one resize behind).
 */
describe('createCoalescer', () => {
  /** Manual frame pump so the tests control "the next animation frame". */
  function makeHost(): { defer: (cb: () => void) => void; pump: () => void; queued: () => number } {
    const queue: (() => void)[] = [];
    return {
      defer: (cb) => queue.push(cb),
      pump: () => {
        const run = queue.splice(0);
        run.forEach((cb) => cb());
      },
      queued: () => queue.length,
    };
  }

  it('runs once for a burst of schedule() calls inside one frame', () => {
    const host = makeHost();
    const cb = vi.fn();
    const c = createCoalescer(cb, host);

    for (let i = 0; i < 50; i += 1) c.schedule();
    expect(cb).not.toHaveBeenCalled();
    expect(c.pending).toBe(true);
    expect(host.queued()).toBe(1);

    host.pump();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(c.runs).toBe(1);
    expect(c.pending).toBe(false);
  });

  it('runs again for a burst in the NEXT frame (a real resize still lands)', () => {
    const host = makeHost();
    const cb = vi.fn();
    const c = createCoalescer(cb, host);

    c.schedule();
    host.pump();
    c.schedule();
    host.pump();

    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('reads the latest state when it finally runs, not the state at schedule time', () => {
    const host = makeHost();
    let viewport = 932;
    const seen: number[] = [];
    const c = createCoalescer(() => seen.push(viewport), host);

    c.schedule();
    viewport = 1000; // arrives mid-burst, before the frame
    c.schedule();
    host.pump();

    expect(seen).toEqual([1000]);
  });

  it('does not queue more than one pending run even under a long burst', () => {
    const host = makeHost();
    const cb = vi.fn();
    const c = createCoalescer(cb, host);

    for (let i = 0; i < 500; i += 1) {
      c.schedule();
      expect(host.queued()).toBeLessThanOrEqual(1);
    }
    host.pump();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('falls back to a synchronous run when requestAnimationFrame is missing', () => {
    // The default host must not silently drop the work on a non-DOM runtime.
    const cb = vi.fn();
    const c = createCoalescer(cb);
    const raf = globalThis.requestAnimationFrame;
    // jsdom provides rAF; the fallback path is exercised by hiding it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).requestAnimationFrame = undefined;
    try {
      c.schedule();
      expect(cb).toHaveBeenCalledTimes(1);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).requestAnimationFrame = raf;
    }
  });
});
