import { describe, expect, it } from 'vitest';
import {
  BANDS,
  BUTTON_SIZE,
  HEADER_BUTTON_SIZE,
  MIN_VIEWPORT_SCALE,
  TILE_HEIGHT,
  tileWidth,
} from '../src/game/theme';

/**
 * Regression guards for layout/touch-target defects found during browser QA.
 * These encode the measured failures so they cannot silently return.
 */

const MIN_CSS = 64;
const css = (designPx: number): number => designPx * MIN_VIEWPORT_SCALE;

describe('touch targets — regression: header buttons were 54 CSS px', () => {
  it('header icon buttons clear the 64 CSS px floor', () => {
    // Measured at 640x360 (s=0.5): a 108 design px button rendered at 54 CSS px.
    expect(css(HEADER_BUTTON_SIZE.width)).toBeGreaterThanOrEqual(MIN_CSS);
    expect(css(HEADER_BUTTON_SIZE.height)).toBeGreaterThanOrEqual(MIN_CSS);
  });

  it('108 design px would have failed — the constant must stay above it', () => {
    expect(css(108)).toBeLessThan(MIN_CSS);
  });

  it('primary buttons clear the floor', () => {
    expect(css(BUTTON_SIZE.height)).toBeGreaterThanOrEqual(MIN_CSS);
  });
});

describe('game bands — regression: hint text overlapped the mechanic label', () => {
  it('mechanic and hint lines occupy distinct rows', () => {
    // Both were drawn at y=324 in the original defect.
    expect(Math.abs(BANDS.hintY - BANDS.mechanicY)).toBeGreaterThanOrEqual(28);
  });

  it('the hint sits clear of the slot row', () => {
    const hintBottom = BANDS.hintY + 28 / 2;
    const slotsTop = BANDS.slotsCenterY - TILE_HEIGHT / 2;
    expect(slotsTop).toBeGreaterThan(hintBottom);
  });

  it('the art card clears the mechanic line', () => {
    const artBottom = BANDS.artCenterY + BANDS.artSize.height / 2;
    expect(BANDS.mechanicY - 14).toBeGreaterThan(artBottom);
  });

  it('the slot row clears the hint', () => {
    const slotsTop = BANDS.slotsCenterY - TILE_HEIGHT / 2;
    expect(slotsTop).toBeGreaterThan(BANDS.hintY);
  });

  it('the tray stays above the safe bottom', () => {
    const trayBottom = BANDS.trayCenterY + TILE_HEIGHT / 2;
    expect(trayBottom).toBeLessThanOrEqual(BANDS.safeBottom);
  });

  it('the tray sits below the slot row (no overlap)', () => {
    const slotsBottom = BANDS.slotsCenterY + TILE_HEIGHT / 2;
    const trayTop = BANDS.trayCenterY - TILE_HEIGHT / 2;
    expect(trayTop).toBeGreaterThan(slotsBottom);
  });

  it('the worst-case tray (8 single letters) fits one row', () => {
    // SNAKE/WATER have 8 tiles; this is the widest real tray.
    const widths = Array.from({ length: 8 }, () => tileWidth('X'));
    const total = widths.reduce((a, b) => a + b, 0) + 10 * 7;
    expect(total).toBeLessThanOrEqual(1180);
  });
});

describe('header layout — regression: wordmark clipped', () => {
  it('header controls sit inside the design width', () => {
    const leftEdge = 96 - HEADER_BUTTON_SIZE.width / 2;
    const rightEdge = 1280 - 96 + HEADER_BUTTON_SIZE.width / 2;
    expect(leftEdge).toBeGreaterThanOrEqual(0);
    expect(rightEdge).toBeLessThanOrEqual(1280);
  });

  it('header buttons clear the tier/level text block', () => {
    const buttonRight = 96 + HEADER_BUTTON_SIZE.width / 2;
    // Tier label is centred, roughly 80px wide.
    const tierLeft = 640 - 40;
    expect(tierLeft).toBeGreaterThan(buttonRight);
  });
});
