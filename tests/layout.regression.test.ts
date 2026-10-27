import { describe, expect, it } from 'vitest';
import {
  BANDS,
  BUTTON_SIZE,
  DESIGN_WIDTH,
  HEADER_BUTTON_SIZE,
  ISLAND_CENTRE_X,
  MIN_VIEWPORT_SCALE,
  TILE_HEIGHT,
  anchorX,
  stageMetrics,
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

  it('the art band clears the header text block above it', () => {
    // Header rows: tier label at headerCenterY-14 (30px) and "Level N of M" at
    // headerCenterY+26 (24px). The lowest glyph box is 76+26+12 = 114.
    const headerBottom = BANDS.headerCenterY + 26 + 24 / 2;
    const artTop = BANDS.artCenterY - BANDS.artSize.height / 2;
    expect(artTop).toBeGreaterThan(headerBottom);
  });

  it('the art band is square (the sticker pack is 512x512)', () => {
    // A non-square band would letterbox every sticker with transparent margins or
    // stretch it — the pack is uniformly square since the real assets landed.
    expect(BANDS.artSize.width).toBe(BANDS.artSize.height);
    expect(BANDS.artSize.width).toBe(180);
  });

  it('the halo disc encloses the sticker without crossing the mechanic line', () => {
    // Halo must be big enough to be a backdrop for the sticker...
    expect(BANDS.artHaloRadius * 2).toBeGreaterThanOrEqual(BANDS.artSize.width);
    // ...and must not overflow the band into the header text or the instruction.
    const headerBottom = BANDS.headerCenterY + 26 + 24 / 2;
    const haloTop = BANDS.artCenterY - BANDS.artHaloRadius;
    const haloBottom = BANDS.artCenterY + BANDS.artHaloRadius;
    expect(haloTop).toBeGreaterThan(headerBottom);
    expect(haloBottom).toBeLessThan(BANDS.mechanicY - 26 / 2);
  });

  it('the sticker stays centred on the content island (crisp, not cropped)', () => {
    // Centred on the island: the camera keeps the island centred, so the clue is
    // always in the middle of whatever viewport the kid is on.
    expect(ISLAND_CENTRE_X).toBe(DESIGN_WIDTH / 2);
    const artLeft = ISLAND_CENTRE_X - BANDS.artSize.width / 2;
    const artRight = ISLAND_CENTRE_X + BANDS.artSize.width / 2;
    expect(artLeft).toBeGreaterThan(0);
    expect(artRight).toBeLessThan(DESIGN_WIDTH);
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
  const VIEWPORTS = [
    [932, 430],
    [915, 412],
    [1280, 720],
    [1180, 820],
    [1024, 768],
  ] as const;

  it('header controls are anchored inside the LIVE stage, not the 1280 island', () => {
    for (const [vw, vh] of VIEWPORTS) {
      const stage = stageMetrics(vw, vh);
      const inset = 92;
      for (const kind of ['left', 'right'] as const) {
        const x = anchorX(stage, { kind, inset });
        expect(x - HEADER_BUTTON_SIZE.width / 2, `${vw}x${vh} ${kind}`).toBeGreaterThanOrEqual(
          stage.left,
        );
        expect(x + HEADER_BUTTON_SIZE.width / 2, `${vw}x${vh} ${kind}`).toBeLessThanOrEqual(
          stage.right,
        );
      }
    }
  });

  it('header buttons clear the tier/level text block on the island', () => {
    const stage = stageMetrics(1280, 720);
    const buttonRight = anchorX(stage, { kind: 'left', inset: 92 }) + HEADER_BUTTON_SIZE.width / 2;
    // Tier label is centred on the island, roughly 80px wide.
    const tierLeft = ISLAND_CENTRE_X - 40;
    expect(tierLeft).toBeGreaterThan(buttonRight);
  });

  it('the OLD fixed x=92 / x=DESIGN_WIDTH-92 anchor would drift on a phone stage', () => {
    // Canary: proves the anchoring rule is load-bearing at 932x430. In world px
    // the fixed anchors sit ~140-230px short of the visible edges.
    const stage = stageMetrics(932, 430);
    const fixedRight = DESIGN_WIDTH - 92;
    const anchoredRight = anchorX(stage, { kind: 'right', inset: 92 });
    expect(anchoredRight - fixedRight).toBeGreaterThan(100);
    expect(92 - anchorX(stage, { kind: 'left', inset: 92 })).toBeGreaterThan(100);
  });
});
