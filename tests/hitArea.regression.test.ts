import { describe, expect, it } from 'vitest';

/**
 * Regression guard for a real bug found by browser QA and fixed in this PR.
 *
 * We built container hit areas as `Rectangle(-w/2, -h/2, w, h)` — centred on the
 * container origin, which LOOKS right because children are drawn around 0,0.
 * But Phaser normalises the tested point in InputManager#pointWithinHitArea by
 * ADDING displayOriginX/Y (half the size) before calling the Contains callback.
 *
 * Working the algebra through for a container of size w x h at origin 0.5:
 *   tested value  = localX + w/2
 *   accepted when  -w/2 <= tested <= w/2
 *   => accepted local-X range is [-w, 0]      (BUGGY, centred rect)
 *   => accepted local-X range is [-w/2, w/2]  (FIXED, rect starting at 0)
 *
 * So the buggy rect claims a full half-tile-width too far LEFT and ignores the
 * right half of the object. User-visible symptom: tapping the correct tile
 * grabbed its left neighbour, so chunks landed in the wrong slot and some
 * levels appeared unsolvable.
 *
 * Phaser's module has canvas side effects, so the two pure functions we depend
 * on are replicated here rather than importing Phaser into jsdom.
 */

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Mirrors Phaser.Geom.Rectangle.Contains (inclusive on both edges). */
function contains(rect: Rect, x: number, y: number): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  return rect.x <= x && rect.x + rect.width >= x && rect.y <= y && rect.y + rect.height >= y;
}

/** True when local-X `localX` is accepted, given the object's size. */
function acceptsLocalX(rect: Rect, localX: number, size: number): boolean {
  const displayOriginX = size / 2;
  return contains(rect, localX + displayOriginX, 0);
}

/** Sampled accepted local-X range as [min, max]. */
function acceptedRange(rect: Rect, size: number): [number, number] {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let x = -size * 2; x <= size * 2; x += 0.5) {
    if (acceptsLocalX(rect, x, size)) {
      min = Math.min(min, x);
      max = Math.max(max, x);
    }
  }
  return [min, max];
}

const W = 200;
const H = 144;

const FIXED: Rect = { x: 0, y: 0, width: W, height: H };
const BUGGY: Rect = { x: -W / 2, y: -H / 2, width: W, height: H };

describe('container hit areas must start at 0,0', () => {
  it('the fixed rect accepts exactly the object bounds', () => {
    expect(acceptedRange(FIXED, W)).toEqual([-W / 2, W / 2]);
  });

  it('the buggy rect accepts a range shifted half a width left', () => {
    expect(acceptedRange(BUGGY, W)).toEqual([-W, 0]);
  });

  it('the shift is exactly half the object width', () => {
    const [fixedMin] = acceptedRange(FIXED, W);
    const [buggyMin] = acceptedRange(BUGGY, W);
    expect(buggyMin - fixedMin).toBe(-W / 2);
  });

  it('both rects agree at the object centre', () => {
    expect(acceptsLocalX(FIXED, 0, W)).toBe(true);
    expect(acceptsLocalX(BUGGY, 0, W)).toBe(true);
  });

  it('the buggy rect misses the right half of the object', () => {
    expect(acceptsLocalX(FIXED, W / 4, W)).toBe(true);
    expect(acceptsLocalX(BUGGY, W / 4, W)).toBe(false);
  });

  it('the buggy rect wrongly claims space to the left of the object', () => {
    const outsideLeft = -W * 0.75;
    expect(acceptsLocalX(FIXED, outsideLeft, W)).toBe(false);
    expect(acceptsLocalX(BUGGY, outsideLeft, W)).toBe(true);
  });
});
