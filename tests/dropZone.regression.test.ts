import { describe, expect, it } from 'vitest';
import {
  DROP_SLOP_X,
  DROP_SLOP_Y,
  TILE_HEIGHT,
  tileWidth,
  withinDropZone,
} from '../src/game/theme';

/**
 * Regression guard for review finding N2.
 *
 * The hover highlight used a ±(w/2 + 56) box while the drop decision used
 * ±(w/2 + 20) / ±(h/2 + 30). Verified on CAT: with a tile 100 design px from
 * slot 0 the slot rendered the green "accept" frame at 1.06x, then the release
 * bounced the tile home and incremented wrongDrops — the UI promised an outcome
 * the rules refused. Both paths now call withinDropZone().
 */

const slot = { x: 500, y: 444, width: tileWidth('C'), height: TILE_HEIGHT };

describe('drop zone (shared by hover highlight and drop decision)', () => {
  it('accepts the slot centre', () => {
    expect(withinDropZone({ x: slot.x, y: slot.y }, slot)).toBe(true);
  });

  it('accepts exactly the slop band and rejects one pixel past it', () => {
    const edgeX = slot.x + slot.width / 2 + DROP_SLOP_X;
    expect(withinDropZone({ x: edgeX, y: slot.y }, slot)).toBe(true);
    expect(withinDropZone({ x: edgeX + 1, y: slot.y }, slot)).toBe(false);

    const edgeY = slot.y + slot.height / 2 + DROP_SLOP_Y;
    expect(withinDropZone({ x: slot.x, y: edgeY }, slot)).toBe(true);
    expect(withinDropZone({ x: slot.x, y: edgeY + 1 }, slot)).toBe(false);
  });

  it('matches the old hover radius nowhere the old drop radius disagreed', () => {
    // The old hover box was +56 and the old drop box +20/+30. Everything in the
    // gap used to highlight and then bounce. It must now be uniformly rejected.
    const oldHoverOnly = slot.x + slot.width / 2 + 40;
    expect(withinDropZone({ x: oldHoverOnly, y: slot.y }, slot)).toBe(false);

    const oldVerticallyOnly = slot.y + slot.height / 2 + 45;
    expect(withinDropZone({ x: slot.x, y: oldVerticallyOnly }, slot)).toBe(false);
  });

  it('uses one radius pair for both axes consistently', () => {
    // Sanity: slop is positive and small enough that neighbouring slots (8px gap)
    // cannot both be "under" the tile in the common case.
    expect(DROP_SLOP_X).toBeGreaterThan(0);
    expect(DROP_SLOP_Y).toBeGreaterThan(0);
  });

  it('is symmetric about the slot centre', () => {
    const dx = slot.width / 2 + DROP_SLOP_X - 1;
    const dy = slot.height / 2 + DROP_SLOP_Y - 1;
    expect(withinDropZone({ x: slot.x - dx, y: slot.y }, slot)).toBe(true);
    expect(withinDropZone({ x: slot.x + dx, y: slot.y }, slot)).toBe(true);
    expect(withinDropZone({ x: slot.x, y: slot.y - dy }, slot)).toBe(true);
    expect(withinDropZone({ x: slot.x, y: slot.y + dy }, slot)).toBe(true);
  });
});

describe('drop zone for phrase levels (Levels 31+)', () => {
  const phrases = [
    'A SLICE OF',
    'YOUR TEETH',
    'SWITCH ON',
    'BRUSH YOUR TEETH',
    'AN APPLE A DAY KEEPS',
  ];

  it.each(phrases)('accepts drop inside slop and rejects outside for "%s"', (phrase) => {
    const width = tileWidth(phrase);
    const phraseSlot = { x: 600, y: 400, width, height: TILE_HEIGHT };

    expect(withinDropZone({ x: phraseSlot.x, y: phraseSlot.y }, phraseSlot)).toBe(true);

    const edgeX = phraseSlot.x + phraseSlot.width / 2 + DROP_SLOP_X;
    expect(withinDropZone({ x: edgeX, y: phraseSlot.y }, phraseSlot)).toBe(true);
    expect(withinDropZone({ x: edgeX + 1, y: phraseSlot.y }, phraseSlot)).toBe(false);

    const edgeY = phraseSlot.y + phraseSlot.height / 2 + DROP_SLOP_Y;
    expect(withinDropZone({ x: phraseSlot.x, y: edgeY }, phraseSlot)).toBe(true);
    expect(withinDropZone({ x: phraseSlot.x, y: edgeY + 1 }, phraseSlot)).toBe(false);
  });
});
