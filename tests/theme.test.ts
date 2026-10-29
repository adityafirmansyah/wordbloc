import { describe, expect, it } from 'vitest';
import {
  BANDS,
  BUTTON_SIZE,
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  HEADER_BUTTON_SIZE,
  MIN_TOUCH_CSS,
  MIN_VIEWPORT_SCALE,
  PORTRAIT_BANDS,
  PORTRAIT_DESIGN_HEIGHT,
  PORTRAIT_DESIGN_WIDTH,
  PORTRAIT_ISLAND_CENTRE_X,
  PORTRAIT_ISLAND_CENTRE_Y,
  TILE_CORNER_SLICE,
  TILE_HEIGHT,
  TILE_WIDTH_MIN,
  bucketDesignWidth,
  chunkFrameFor,
  frameBucketFor,
  legacyChunkFrameFor,
  legacySlotDoneFrameFor,
  legacySlotFrameFor,
  legacyTileFrameFor,
  slotDoneFrameFor,
  slotFrameFor,
  stageMetrics,
  tileFrameFor,
  tileWidth,
  viewportFit,
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
    expect(tileWidth('A')).toBe(TILE_WIDTH_MIN);
  });

  it('smoothly scales for multi-word phrases (Levels 31+) without capping at 6 chars', () => {
    const phrase6 = tileWidth('SWITCH');
    const phrase9 = tileWidth('SWITCH ON');
    const phrase10 = tileWidth('A SLICE OF');
    const phrase16 = tileWidth('BRUSH YOUR TEETH');
    const phrase20 = tileWidth('AN APPLE A DAY KEEPS');

    expect(phrase9).toBeGreaterThan(phrase6);
    expect(phrase10).toBeGreaterThan(phrase9);
    expect(phrase16).toBeGreaterThan(phrase10);
    expect(phrase20).toBeGreaterThan(phrase16);

    // Exact formula check: 60 + chars * 34
    expect(phrase9).toBe(60 + 9 * 34); // 366
    expect(phrase10).toBe(60 + 10 * 34); // 400
    expect(phrase16).toBe(60 + 16 * 34); // 604
    expect(phrase20).toBe(60 + 20 * 34); // 740
  });

  it('guarantees monotonic non-decreasing widths for phrase growth', () => {
    let prev = tileWidth('A');
    for (let len = 2; len <= 30; len += 1) {
      const w = tileWidth('X'.repeat(len));
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
  });

  it('NineSlice corner slices fit comfortably within minimum dimensions', () => {
    expect(TILE_CORNER_SLICE * 2).toBeLessThanOrEqual(TILE_WIDTH_MIN);
    expect(TILE_CORNER_SLICE * 2).toBeLessThanOrEqual(TILE_HEIGHT);
    expect(TILE_CORNER_SLICE).toBe(30);
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

  it('produces distinct unified frame names per family', () => {
    expect(tileFrameFor('a')).toBe('tile');
    expect(chunkFrameFor('BUT')).toBe('chunk');
    expect(slotFrameFor('BUT')).toBe('slot');
    expect(slotDoneFrameFor('BUT')).toBe('slot_done');
  });

  it('long chunks and multi-word phrases share the unified frame without 6-character caps', () => {
    expect(chunkFrameFor('FLOWER')).toBe('chunk');
    expect(chunkFrameFor('BUTTERFLY')).toBe('chunk');
    expect(chunkFrameFor('A SLICE OF')).toBe('chunk');
  });

  it('preserves legacy bucketed aliases for backwards compatibility', () => {
    expect(legacyTileFrameFor('a')).toBe('tile_w1');
    expect(legacyChunkFrameFor('BUT')).toBe('chunk_w3');
    expect(legacySlotFrameFor('BUT')).toBe('slot_w3');
    expect(legacySlotDoneFrameFor('BUT')).toBe('slot_done_w3');
    expect(legacyChunkFrameFor('FLOWER')).toBe('chunk_w6');
    expect(legacyChunkFrameFor('BUTTERFLY')).toBe('chunk_w6');
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

describe('portrait design space & stage metrics', () => {
  it('is 720x1280 centred at (360, 640)', () => {
    expect(PORTRAIT_DESIGN_WIDTH).toBe(720);
    expect(PORTRAIT_DESIGN_HEIGHT).toBe(1280);
    expect(PORTRAIT_ISLAND_CENTRE_X).toBe(360);
    expect(PORTRAIT_ISLAND_CENTRE_Y).toBe(640);
  });

  it('keeps every portrait band inside the design height', () => {
    for (const [, value] of Object.entries(PORTRAIT_BANDS)) {
      if (typeof value === 'number' && !value.toString().includes('Button')) {
        expect(value).toBeLessThanOrEqual(PORTRAIT_DESIGN_HEIGHT);
      }
    }
  });

  it('detects orientation correctly via stageMetrics', () => {
    const portrait = stageMetrics(393, 851);
    expect(portrait.isPortrait).toBe(true);
    expect(portrait.orientation).toBe('portrait');
    expect(portrait.centreX).toBe(PORTRAIT_ISLAND_CENTRE_X);
    expect(portrait.centreY).toBe(PORTRAIT_ISLAND_CENTRE_Y);

    const landscape = stageMetrics(851, 393);
    expect(landscape.isPortrait).toBe(false);
    expect(landscape.orientation).toBe('landscape');
  });

  it('accepts portrait viewports in viewportFit without rotate notice', () => {
    const fit = viewportFit(393, 851);
    expect(fit.notice).toBe('none');
    expect(fit.scale).toBeGreaterThanOrEqual(MIN_VIEWPORT_SCALE);
  });
});

describe('portrait touch targets', () => {
  it('under typical phone portrait (e.g. 393x851 CSS px), scale is ~0.546 and targets are >= 64 CSS px', () => {
    const stage = stageMetrics(393, 851);
    const scale = stage.scale;
    expect(scale).toBeCloseTo(393 / 720, 3);
    expect(scale).toBeGreaterThan(0.54);

    // Letter tile (128x144 design px): at scale ~0.546, ~69.9 x 78.6 CSS px (huge & kid-friendly)
    expect(tileWidth('X') * scale).toBeGreaterThanOrEqual(SPEC_CSS);
    expect(TILE_HEIGHT * scale).toBeGreaterThanOrEqual(SPEC_CSS);

    // Primary buttons (340x128 design px)
    expect(BUTTON_SIZE.width * scale).toBeGreaterThanOrEqual(SPEC_CSS);
    expect(BUTTON_SIZE.height * scale).toBeGreaterThanOrEqual(SPEC_CSS);

    // Header buttons (128x128 design px)
    expect(HEADER_BUTTON_SIZE.width * scale).toBeGreaterThanOrEqual(SPEC_CSS);
    expect(HEADER_BUTTON_SIZE.height * scale).toBeGreaterThanOrEqual(SPEC_CSS);
  });
});
