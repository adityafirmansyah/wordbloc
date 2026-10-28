import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  ISLAND_CENTRE_X,
  ISLAND_CENTRE_Y,
  MIN_DESIGN_WIDTH,
  MIN_VIEWPORT_SCALE,
  anchorX,
  stageMetrics,
  viewportFit,
} from '../src/game/theme';

/**
 * Full-bleed viewport model (defect: "on mobile the layout did not use full space").
 *
 * The old model was `Phaser.Scale.FIT` over a FIXED 1280x720 space, so any aspect
 * ratio other than 16:9 left dead bars: measured on an iPhone 14 Plus (932x430)
 * 19.8% of the viewport width, and on an iPad Air landscape (1180x820) 38.8% of
 * the area. `stageMetrics()` replaces it: the visible stage is derived from the
 * viewport aspect so `stage.width * scale === viewportWidth` and
 * `stage.height * scale === viewportHeight` by construction.
 *
 * The acceptance viewports from the defect report are pinned here.
 */
const ACCEPTANCE_VIEWPORTS = [
  [932, 430], // iPhone 14 Plus landscape (2.17:1, wider than 16:9)
  [915, 412], // Pixel 8 landscape
  [1280, 720], // exact design space (16:9)
  [1180, 820], // iPad Air landscape (1.44:1, narrower than 16:9)
  [1024, 768], // 4:3 tablet landscape
] as const;

const EPS = 1e-6;

describe('stageMetrics — full-bleed stage geometry', () => {
  it('fills the viewport exactly at every acceptance aspect ratio', () => {
    for (const [vw, vh] of ACCEPTANCE_VIEWPORTS) {
      const stage = stageMetrics(vw, vh);
      expect(stage.width * stage.scale, `${vw}x${vh} width`).toBeCloseTo(vw, 6);
      expect(stage.height * stage.scale, `${vw}x${vh} height`).toBeCloseTo(vh, 6);
    }
  });

  it('never reports a stage narrower than the widest fixed-width surface', () => {
    for (const [vw, vh] of ACCEPTANCE_VIEWPORTS) {
      const stage = stageMetrics(vw, vh);
      expect(stage.width, `${vw}x${vh}`).toBeGreaterThanOrEqual(MIN_DESIGN_WIDTH);
      // Wordbook panel 980 + pager arrows at inset 76 with a 132px button needs
      // at least 2 * (76 + 66) + 980 = 1264 design px; the tray wraps at 1180.
      expect(stage.width, `${vw}x${vh}`).toBeGreaterThanOrEqual(1264);
    }
  });

  it('grows WIDTH on wide phone stages and HEIGHT on narrow tablet stages', () => {
    const phone = stageMetrics(932, 430);
    expect(phone.height).toBeCloseTo(DESIGN_HEIGHT, 6); // height pinned at 720
    expect(phone.width).toBeCloseTo(DESIGN_HEIGHT * (932 / 430), 6);
    expect(phone.width).toBeGreaterThan(DESIGN_WIDTH);

    const tablet = stageMetrics(1180, 820);
    expect(tablet.width).toBeCloseTo(MIN_DESIGN_WIDTH, 6); // width pinned at 1280
    expect(tablet.height).toBeCloseTo(MIN_DESIGN_WIDTH / (1180 / 820), 6);
    expect(tablet.height).toBeGreaterThan(DESIGN_HEIGHT);
  });

  it('keeps the content island centred at every aspect ratio', () => {
    for (const [vw, vh] of ACCEPTANCE_VIEWPORTS) {
      const stage = stageMetrics(vw, vh);
      expect(stage.centreX).toBe(ISLAND_CENTRE_X);
      expect(stage.centreY).toBe(ISLAND_CENTRE_Y);
      expect(stage.left + stage.width / 2).toBeCloseTo(ISLAND_CENTRE_X, 6);
      expect(stage.top + stage.height / 2).toBeCloseTo(ISLAND_CENTRE_Y, 6);
      // The design space itself is always fully visible.
      expect(stage.left).toBeLessThanOrEqual(0);
      expect(stage.right).toBeGreaterThanOrEqual(DESIGN_WIDTH);
      expect(stage.top).toBeLessThanOrEqual(0);
      expect(stage.bottom).toBeGreaterThanOrEqual(DESIGN_HEIGHT);
    }
  });

  it('reports the same scale the old FIT formula gave, so touch math is unchanged', () => {
    for (const [vw, vh] of ACCEPTANCE_VIEWPORTS) {
      const stage = stageMetrics(vw, vh);
      const fit = Math.min(vw / DESIGN_WIDTH, vh / DESIGN_HEIGHT);
      expect(stage.scale, `${vw}x${vh}`).toBeCloseTo(fit, 6);
    }
  });

  it('degrades safely on a zero-size viewport instead of dividing by zero', () => {
    for (const [w, h] of [
      [0, 0],
      [0, 720],
      [1280, 0],
      [-10, 400],
    ] as const) {
      const stage = stageMetrics(w, h);
      expect(Number.isFinite(stage.width)).toBe(true);
      expect(Number.isFinite(stage.height)).toBe(true);
      expect(Number.isFinite(stage.scale)).toBe(true);
      expect(stage.scale).toBe(0);
    }
  });
});

describe('canary — the old fixed 1280x720 letterbox model must stay dead', () => {
  /** Canvas CSS size the old Scale.FIT model produced for a viewport. */
  function fitCanvas(vw: number, vh: number): { width: number; height: number } {
    const s = Math.min(vw / DESIGN_WIDTH, vh / DESIGN_HEIGHT);
    return { width: DESIGN_WIDTH * s, height: DESIGN_HEIGHT * s };
  }

  it('was letterboxed on the reported phone (932x430) — proof the defect was real', () => {
    const { width } = fitCanvas(932, 430);
    expect(932 - width).toBeGreaterThan(150); // ~19.8% of the width, dead bars
  });

  it('was letterboxed on the reported tablet (1180x820)', () => {
    const { width, height } = fitCanvas(1180, 820);
    // Width-limited: the canvas filled the width but left bars top AND bottom.
    expect(width).toBeCloseTo(1180, 6);
    const deadBars = 820 - height;
    expect(deadBars).toBeGreaterThan(150);
    // ~19% of the viewport height was dead sky-blue bar (38% counting both sides
    // of the letterbox against the content's own height).
    expect(deadBars / height).toBeGreaterThan(0.2);
  });

  it('the new model leaves no bar at all on any acceptance viewport', () => {
    for (const [vw, vh] of ACCEPTANCE_VIEWPORTS) {
      const stage = stageMetrics(vw, vh);
      const canvasWidth = stage.width * stage.scale;
      const canvasHeight = stage.height * stage.scale;
      // Within 1px of the viewport rect in BOTH axes (acceptance criterion).
      expect(Math.abs(canvasWidth - vw), `${vw}x${vh} bars`).toBeLessThanOrEqual(1);
      expect(Math.abs(canvasHeight - vh), `${vw}x${vh} bars`).toBeLessThanOrEqual(1);
    }
  });

  it('a reverted DESIGN_WIDTH constant would break the width invariant', () => {
    // If a scene/stage server went back to "width is always 1280", the visible
    // width would be 1280 and the full-bleed equality would fail at 932x430.
    const stage = stageMetrics(932, 430);
    const revertedWidth = DESIGN_WIDTH;
    expect(Math.abs(revertedWidth * stage.scale - 932)).toBeGreaterThan(1);
    expect(Math.abs(stage.width * stage.scale - 932)).toBeLessThanOrEqual(EPS);
  });
});

describe('anchorX — edge anchoring follows the live stage', () => {
  it('places left/right insets inside the visible stage', () => {
    for (const [vw, vh] of ACCEPTANCE_VIEWPORTS) {
      const stage = stageMetrics(vw, vh);
      expect(anchorX(stage, { kind: 'left', inset: 92 })).toBeCloseTo(stage.left + 92, 6);
      expect(anchorX(stage, { kind: 'right', inset: 92 })).toBeCloseTo(stage.right - 92, 6);
      expect(anchorX(stage, { kind: 'centre' })).toBe(ISLAND_CENTRE_X);
      expect(anchorX(stage, { kind: 'centre', dx: -250 })).toBe(ISLAND_CENTRE_X - 250);
    }
  });

  it('keeps a 132px header button fully inside the frame on the widest phone', () => {
    const stage = stageMetrics(932, 430);
    const size = 132;
    for (const kind of ['left', 'right'] as const) {
      const x = anchorX(stage, { kind, inset: 92 });
      expect(x - size / 2, kind).toBeGreaterThanOrEqual(stage.left);
      expect(x + size / 2, kind).toBeLessThanOrEqual(stage.right);
    }
  });

  it('the old fixed x=92 / x=DESIGN_WIDTH-92 buttons would have been off-frame', () => {
    const stage = stageMetrics(932, 430);
    // Fixed anchors land >200 design px from the visible edge on a 2.17:1 stage,
    // so a header control authored at x=92 sits far inside the frame (and its
    // mirror at DESIGN_WIDTH-92 would clip a narrower stage).
    expect(92 - stage.left).toBeGreaterThan(200);
    expect(stage.right - (DESIGN_WIDTH - 92)).toBeGreaterThan(200);
  });
});

describe('viewport gate under the full-bleed model', () => {
  it('is playable on every acceptance landscape viewport', () => {
    for (const [vw, vh] of ACCEPTANCE_VIEWPORTS) {
      expect(viewportFit(vw, vh).notice, `${vw}x${vh}`).toBe('none');
    }
  });

  it('is playable on real phones in landscape once browser chrome is subtracted', () => {
    // The owner defect: 0.5 required >= 360 CSS px of height, which no phone with a
    // visible URL bar has. These are the measured innerHeight values.
    for (const [vw, vh] of [
      [851, 299],
      [800, 275],
      [932, 320],
      [780, 265],
    ] as const) {
      const fit = viewportFit(vw, vh);
      expect(fit.notice, `${vw}x${vh}`).toBe('none');
      expect(fit.scale, `${vw}x${vh}`).toBeGreaterThanOrEqual(MIN_VIEWPORT_SCALE);
    }
  });

  it('the landscape floor is a HEIGHT floor (vh >= 259.2) for wide aspects', () => {
    const floorHeight = MIN_VIEWPORT_SCALE * DESIGN_HEIGHT; // 259.2 CSS px
    expect(floorHeight).toBeCloseTo(259.2, 6);
    // At the floor (scale 0.36) -> playable.
    expect(viewportFit(932, floorHeight).scale).toBeCloseTo(MIN_VIEWPORT_SCALE, 9);
    expect(viewportFit(932, floorHeight).notice).toBe('none');
    // One CSS px shorter -> no fixed design size can reach the 44 CSS px floor.
    expect(viewportFit(932, floorHeight - 1).notice).toBe('too-small');
    expect(viewportFit(932, floorHeight - 1).scale).toBeLessThan(MIN_VIEWPORT_SCALE);
    // The documented round number: 260 CSS px is in, 258 is out.
    expect(viewportFit(932, 260).notice).toBe('none');
    expect(viewportFit(932, 258).notice).toBe('too-small');
  });

  it('the narrow floor is a WIDTH floor (vw >= 460.8) for landscape aspects', () => {
    // 700x600 is landscape but narrower than 16:9, so the stage width is pinned
    // at MIN_DESIGN_WIDTH and the scale is vw / 1280.
    expect(stageMetrics(700, 600).scale).toBeCloseTo(700 / DESIGN_WIDTH, 6);
    expect(viewportFit(461, 460).scale).toBeGreaterThanOrEqual(MIN_VIEWPORT_SCALE);
    expect(viewportFit(461, 460).notice).toBe('none');
    expect(viewportFit(455, 450).notice).toBe('too-small');
    expect(viewportFit(455, 450).scale).toBeLessThan(MIN_VIEWPORT_SCALE);
  });

  it('still asks a portrait phone to rotate', () => {
    for (const [w, h] of [
      [430, 932],
      [414, 896],
      [375, 667],
    ] as const) {
      expect(viewportFit(w, h).notice, `${w}x${h}`).toBe('rotate');
    }
  });

  it('a 1024x768 landscape tablet is playable (used to waste 38.8% of the screen)', () => {
    const fit = viewportFit(1024, 768);
    expect(fit.notice).toBe('none');
    expect(fit.scale).toBeCloseTo(0.8, 6);
  });
});

describe('config + document contract (source-level: Phaser cannot boot in jsdom)', () => {
  const root = path.resolve(__dirname, '..');
  const configSrc = fs.readFileSync(path.join(root, 'src/game/config.ts'), 'utf8');
  const htmlSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  it('uses Scale.RESIZE with autoCenter off (canvas is the viewport)', () => {
    expect(configSrc).toMatch(/mode:\s*Phaser\.Scale\.RESIZE/);
    expect(configSrc).toMatch(/autoCenter:\s*Phaser\.Scale\.NO_CENTER/);
    expect(configSrc).not.toMatch(/Phaser\.Scale\.FIT/);
    expect(configSrc).not.toMatch(/Phaser\.Scale\.CENTER_BOTH/);
  });

  it('leaves #game uncapped so the canvas can fill the screen', () => {
    expect(htmlSrc).toMatch(/#game\s*\{[^}]*width:\s*100%/);
    expect(htmlSrc).toMatch(/#game\s*\{[^}]*height:\s*100%/);
    expect(htmlSrc).not.toMatch(/#game\s*\{[^}]*max-width/);
    expect(htmlSrc).toMatch(/viewport-fit=cover/);
  });
});
