import { describe, expect, it } from 'vitest';
import {
  BANDS,
  BUTTON_SIZE,
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  HEADER_BUTTON_SIZE,
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

/** Spec: "Touch targets >= 64x64 CSS px". */
const MIN_CSS = 64;
const designPxToCss = (designPx: number): number => designPx * MIN_VIEWPORT_SCALE;

describe('touch targets (spec: >= 64x64 CSS px)', () => {
  it('tiles clear 64 CSS px in both axes at the worst supported scale', () => {
    expect(designPxToCss(TILE_HEIGHT)).toBeGreaterThanOrEqual(MIN_CSS);
    expect(designPxToCss(tileWidth('X'))).toBeGreaterThanOrEqual(MIN_CSS);
  });

  it('primary buttons clear 64 CSS px', () => {
    expect(designPxToCss(BUTTON_SIZE.height)).toBeGreaterThanOrEqual(MIN_CSS);
    expect(designPxToCss(BUTTON_SIZE.width)).toBeGreaterThanOrEqual(MIN_CSS);
  });

  it('header icon buttons clear 64 CSS px', () => {
    expect(designPxToCss(HEADER_BUTTON_SIZE.width)).toBeGreaterThanOrEqual(MIN_CSS);
    expect(designPxToCss(HEADER_BUTTON_SIZE.height)).toBeGreaterThanOrEqual(MIN_CSS);
  });

  it('every seed level unit produces a >= 64 CSS px tile', () => {
    // Letters and chunks across all 30 levels are <= 6 chars; the narrowest is 1.
    for (const unit of ['A', 'BUT', 'FLOWER', 'PHANT']) {
      expect(designPxToCss(tileWidth(unit)), unit).toBeGreaterThanOrEqual(MIN_CSS);
    }
  });

  it('documents the 0.5 worst-case scale used for the math', () => {
    // 640x360 CSS viewport => min(640/1280, 360/720) = 0.5 under the full-bleed
    // stage model too (scale is width/width for narrow, height/height for wide).
    expect(stageMetrics(640, 360).scale).toBe(MIN_VIEWPORT_SCALE);
    expect(stageMetrics(932, 360).scale).toBe(MIN_VIEWPORT_SCALE);
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
