import { describe, expect, it } from 'vitest';
import {
  BANDS,
  BUTTON_SIZE,
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  HEADER_BUTTON_SIZE,
  MIN_TOUCH_CSS,
  MIN_VIEWPORT_SCALE,
  TILE_HEIGHT,
  bucketDesignWidth,
  chunkFrameFor,
  frameBucketFor,
  slotDoneFrameFor,
  slotFrameFor,
  stageMetrics,
  tileFrameFor,
  tileWidth,
} from '../src/game/theme';

/**
 * Touch targets, measured in CSS px at the two scales that matter.
 *
 * The spec asks for ">= 64x64 CSS px", which is exactly what the design sizes give
 * at scale 0.5 (a 640x360-or-better window). Real phones in landscape cannot reach
 * 0.5: Chrome/Safari spend ~94 CSS px on browser chrome, so a 393-px-tall phone
 * exposes ~299 CSS px of viewport and a 360-px phone ~265. The supported floor is
 * therefore MIN_VIEWPORT_SCALE = 0.36 (vh >= 260 CSS px), and at that floor every
 * control must still clear the 44 CSS px WCAG 2.5.5 / Material floor. Below it the
 * viewport gate blocks (see `tests/viewportGate.test.ts`), so 44 is the true worst
 * case a player can be served.
 */
const SPEC_CSS = 64;
const specCss = (designPx: number): number => designPx * 0.5;
const floorCss = (designPx: number): number => designPx * MIN_VIEWPORT_SCALE;

describe('touch targets at the spec scale (0.5): >= 64x64 CSS px', () => {
  it('tiles clear 64 CSS px in both axes', () => {
    expect(specCss(TILE_HEIGHT)).toBeGreaterThanOrEqual(SPEC_CSS);
    expect(specCss(tileWidth('X'))).toBeGreaterThanOrEqual(SPEC_CSS);
  });

  it('primary buttons clear 64 CSS px', () => {
    expect(specCss(BUTTON_SIZE.height)).toBeGreaterThanOrEqual(SPEC_CSS);
    expect(specCss(BUTTON_SIZE.width)).toBeGreaterThanOrEqual(SPEC_CSS);
  });

  it('header icon buttons clear 64 CSS px', () => {
    expect(specCss(HEADER_BUTTON_SIZE.width)).toBeGreaterThanOrEqual(SPEC_CSS);
    expect(specCss(HEADER_BUTTON_SIZE.height)).toBeGreaterThanOrEqual(SPEC_CSS);
  });

  it('every seed level unit produces a >= 64 CSS px tile', () => {
    // Letters and chunks across all 30 levels are <= 6 chars; the narrowest is 1.
    for (const unit of ['A', 'BUT', 'FLOWER', 'PHANT']) {
      expect(specCss(tileWidth(unit)), unit).toBeGreaterThanOrEqual(SPEC_CSS);
    }
  });

  it('0.5 is still what desktop / tablet / large-phone viewports get', () => {
    // 640x360 => min(640/1280, 360/720) = 0.5 under the full-bleed stage model
    // too (scale is width/width for narrow, height/height for wide).
    expect(stageMetrics(640, 360).scale).toBe(0.5);
    expect(stageMetrics(932, 360).scale).toBe(0.5);
    expect(stageMetrics(1280, 720).scale).toBe(1);
  });
});

describe('touch targets at the supported floor (MIN_VIEWPORT_SCALE = 0.36)', () => {
  it('is 0.36, i.e. a 260 CSS px height floor on a phone stage', () => {
    expect(MIN_VIEWPORT_SCALE).toBe(0.36);
    expect(MIN_TOUCH_CSS).toBe(44);
    // 0.36 * 720 = 259.2 CSS px, so every real phone (265+) clears it while the
    // old 0.5 floor (360 CSS px) excluded all of them.
    expect(MIN_VIEWPORT_SCALE * DESIGN_HEIGHT).toBeLessThanOrEqual(260);
    expect(MIN_VIEWPORT_SCALE * DESIGN_HEIGHT).toBeGreaterThan(250);
  });

  it('letter tiles clear the 44 CSS px WCAG floor', () => {
    expect(floorCss(TILE_HEIGHT)).toBeGreaterThanOrEqual(MIN_TOUCH_CSS);
    expect(floorCss(tileWidth('X'))).toBeGreaterThanOrEqual(MIN_TOUCH_CSS);
    // Measured values quoted in the defect report: 52 CSS px slot, 46.2 tile.
    expect(floorCss(TILE_HEIGHT)).toBeCloseTo(51.84, 2);
    expect(floorCss(tileWidth('X'))).toBeCloseTo(46.08, 2);
  });

  it('multi-letter tiles clear it with room to spare', () => {
    for (const unit of ['BUT', 'FLOWER', 'PHANT']) {
      expect(floorCss(tileWidth(unit)), unit).toBeGreaterThanOrEqual(MIN_TOUCH_CSS);
    }
    // 162 * 0.36 = 58.3 CSS px, the number in the defect report.
    expect(floorCss(tileWidth('BUT'))).toBeCloseTo(58.32, 2);
  });

  it('primary buttons clear it by height and width', () => {
    expect(floorCss(BUTTON_SIZE.height)).toBeGreaterThanOrEqual(MIN_TOUCH_CSS);
    expect(floorCss(BUTTON_SIZE.width)).toBeGreaterThanOrEqual(MIN_TOUCH_CSS);
    expect(floorCss(BUTTON_SIZE.height)).toBeCloseTo(46.08, 2);
    expect(floorCss(BUTTON_SIZE.width)).toBeCloseTo(122.4, 2);
  });

  it('header icon buttons clear it', () => {
    expect(floorCss(HEADER_BUTTON_SIZE.width)).toBeGreaterThanOrEqual(MIN_TOUCH_CSS);
    expect(floorCss(HEADER_BUTTON_SIZE.height)).toBeGreaterThanOrEqual(MIN_TOUCH_CSS);
  });

  it('the floor is a real floor: below it the design sizes stop clearing 44', () => {
    // Canary — lowering MIN_VIEWPORT_SCALE without growing the controls is exactly
    // how un-tappable targets ship. At 0.30 a letter tile is 38 CSS px.
    const below = 0.3;
    expect(tileWidth('X') * below).toBeLessThan(MIN_TOUCH_CSS);
    expect(TILE_HEIGHT * below).toBeLessThan(MIN_TOUCH_CSS);
  });
});

describe('tile sizing', () => {
  it('widths grow with unit length', () => {
    expect(tileWidth('BUTTER')).toBeGreaterThan(tileWidth('BUT'));
    expect(tileWidth('BUT')).toBeGreaterThan(tileWidth('A'));
  });

  it('1-char tiles keep a square-ish minimum', () => {
    expect(tileWidth('A')).toBe(tileWidth('Z'));
  });
});

describe('atlas frame bucketing', () => {
  it('caps the bucket at 6 characters', () => {
    expect(frameBucketFor('A')).toBe(1);
    expect(frameBucketFor('ABCDEF')).toBe(6);
    expect(frameBucketFor('ABCDEFGH')).toBe(6);
  });

  it('frame widths are >= the tile width they render', () => {
    for (let len = 1; len <= 6; len += 1) {
      const unit = 'X'.repeat(len);
      expect(bucketDesignWidth(frameBucketFor(unit))).toBeGreaterThanOrEqual(tileWidth(unit));
    }
  });

  it('produces distinct frame names per family', () => {
    expect(tileFrameFor('a')).toBe('tile_w1');
    expect(chunkFrameFor('BUT')).toBe('chunk_w3');
    expect(slotFrameFor('BUT')).toBe('slot_w3');
    expect(slotDoneFrameFor('BUT')).toBe('slot_done_w3');
  });

  it('long chunks share the width-6 frame', () => {
    expect(chunkFrameFor('FLOWER')).toBe('chunk_w6');
    expect(chunkFrameFor('BUTTERFLY')).toBe('chunk_w6');
  });
});

describe('design space', () => {
  it('is 1280x720 per the spec', () => {
    expect(DESIGN_WIDTH).toBe(1280);
    expect(DESIGN_HEIGHT).toBe(720);
  });

  it('keeps the slots band clear of the tray band', () => {
    const slotBottom = BANDS.slotsCenterY + TILE_HEIGHT / 2;
    const trayTop = BANDS.trayCenterY - TILE_HEIGHT / 2;
    expect(trayTop).toBeGreaterThan(slotBottom);
  });

  it('keeps every band inside the design height', () => {
    for (const [, value] of Object.entries(BANDS)) {
      if (typeof value === 'number' && !value.toString().includes('Button')) {
        expect(value).toBeLessThanOrEqual(DESIGN_HEIGHT);
      }
    }
  });
});
