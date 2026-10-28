import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';

/**
 * Atlas geometry regression suite.
 *
 * The defect (owner report: "fix issue on the button shadows. its glitches")
 * was PURE GEOMETRY, and it produced two visible symptoms:
 *
 *   1. a stray dark blob outside the Play button's top-left rounded corner —
 *      a neighbouring tile frame's drop shadow painted past its own frame and
 *      therefore into the Play button's frame rectangle in the packed atlas;
 *   2. the bottom of every button shadow cut off flat — the shadow was drawn
 *      8px taller than the frame it lives in, so the renderer clipped it.
 *
 * Both come from the same rule: NOTHING may be drawn outside the frame
 * rectangle declared to the texture atlas, and no two frame rectangles may sit
 * close enough for filtered sampling to mix them. This suite enforces that rule
 * mechanically — it replays every `FrameSpec.draw` against a recording Graphics
 * double and checks the ink bounds — plus a canary proving the pre-fix formulas
 * fail the very same assertion.
 *
 * Phaser is mocked (its module init touches a real canvas, which jsdom lacks);
 * `uiAtlas` only needs Vector2 + Display.Color at draw time, and the Graphics
 * double is passed in structurally, so no real renderer is involved.
 */
vi.mock('phaser', () => {
  class Vector2 {
    constructor(
      public x: number,
      public y: number,
    ) {}
  }
  const IntegerToColor = (value: number) => ({
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  });
  const Interpolate = {
    ColorWithColor: (
      a: { r: number; g: number; b: number },
      b: { r: number; g: number; b: number },
      _t: number,
      t: number,
    ) => ({
      r: Math.round(a.r + (b.r - a.r) * t),
      g: Math.round(a.g + (b.g - a.g) * t),
      b: Math.round(a.b + (b.b - a.b) * t),
    }),
  };
  const GetColor = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;
  return {
    default: { Math: { Vector2 }, Display: { Color: { IntegerToColor, Interpolate, GetColor } } },
  };
});

const { ATLAS_PADDING, buildFrameSpecs, packFrames } = await import('../src/game/uiAtlas');
const { BUTTON_SIZE } = await import('../src/game/theme');

type Specs = ReturnType<typeof buildFrameSpecs>;
type FrameSpec = Specs[number];

/** One recorded Graphics call, with the stroke width live at the time. */
interface DrawCall {
  op: string;
  args: number[];
  lineWidth: number;
  fillAlpha: number;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const EMPTY: Bounds = {
  minX: Number.POSITIVE_INFINITY,
  minY: Number.POSITIVE_INFINITY,
  maxX: Number.NEGATIVE_INFINITY,
  maxY: Number.NEGATIVE_INFINITY,
};

/**
 * A Graphics double that records every call and accumulates the outer bounds of
 * the ink it would put on the canvas. Strokes are widened by half the line width
 * (Canvas/WebGL strokes straddle the path), which is exactly the half-pixel
 * class of mistake this suite exists to catch.
 */
class InkRecorder {
  calls: DrawCall[] = [];
  bounds: Bounds = { ...EMPTY };
  private lineWidth = 0;
  private alpha = 1;
  private path: { x: number; y: number }[] = [];

  private track(x: number, y: number, pad = 0): void {
    this.bounds = {
      minX: Math.min(this.bounds.minX, x - pad),
      minY: Math.min(this.bounds.minY, y - pad),
      maxX: Math.max(this.bounds.maxX, x + pad),
      maxY: Math.max(this.bounds.maxY, y + pad),
    };
  }

  private rect(x: number, y: number, w: number, h: number, pad = 0): void {
    this.track(x, y, pad);
    this.track(x + w, y + h, pad);
  }

  lineStyle(width: number): void {
    this.lineWidth = width;
  }

  fillStyle(_color: number, alpha = 1): void {
    this.alpha = alpha;
  }

  fillRoundedRect(x: number, y: number, w: number, h: number, r: number): void {
    this.calls.push({
      op: 'fillRoundedRect',
      args: [x, y, w, h, r],
      lineWidth: 0,
      fillAlpha: this.alpha,
    });
    this.rect(x, y, w, h);
  }

  strokeRoundedRect(x: number, y: number, w: number, h: number, r: number): void {
    this.calls.push({
      op: 'strokeRoundedRect',
      args: [x, y, w, h, r],
      lineWidth: this.lineWidth,
      fillAlpha: 1,
    });
    this.rect(x, y, w, h, this.lineWidth / 2);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({ op: 'fillRect', args: [x, y, w, h], lineWidth: 0, fillAlpha: this.alpha });
    this.rect(x, y, w, h);
  }

  fillCircle(x: number, y: number, r: number): void {
    this.calls.push({ op: 'fillCircle', args: [x, y, r], lineWidth: 0, fillAlpha: this.alpha });
    this.track(x - r, y - r);
    this.track(x + r, y + r);
  }

  fillPoints(points: { x: number; y: number }[]): void {
    this.calls.push({
      op: 'fillPoints',
      args: points.flatMap((p) => [p.x, p.y]),
      lineWidth: 0,
      fillAlpha: this.alpha,
    });
    points.forEach((p) => this.track(p.x, p.y));
  }

  beginPath(): void {
    this.path = [];
  }

  moveTo(x: number, y: number): void {
    this.path.push({ x, y });
    this.track(x, y, this.lineWidth / 2);
  }

  lineTo(x: number, y: number): void {
    this.path.push({ x, y });
    this.track(x, y, this.lineWidth / 2);
  }

  closePath(): void {
    // Closing adds no point outside the existing path's hull.
  }

  fillPath(): void {
    this.path.forEach((p) => this.track(p.x, p.y));
  }

  strokePath(): void {
    this.path.forEach((p) => this.track(p.x, p.y, this.lineWidth / 2));
  }

  arc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): void {
    const ext = arcExtent(cx, cy, r, startAngle, endAngle);
    this.path.push({ x: ext.minX, y: ext.minY }, { x: ext.maxX, y: ext.maxY });
    this.track(ext.minX, ext.minY, this.lineWidth / 2);
    this.track(ext.maxX, ext.maxY, this.lineWidth / 2);
  }
}

/** Bounding box of an arc sweep, honouring which cardinal angles it covers. */
function arcExtent(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  let sweepEnd = endAngle;
  while (sweepEnd < startAngle) sweepEnd += Math.PI * 2;
  const points: { x: number; y: number }[] = [
    { x: cx + Math.cos(startAngle) * r, y: cy + Math.sin(startAngle) * r },
    { x: cx + Math.cos(endAngle) * r, y: cy + Math.sin(endAngle) * r },
  ];
  for (let k = 0; k < 4; k += 1) {
    const angle = (k * Math.PI) / 2;
    let a = angle;
    while (a < startAngle) a += Math.PI * 2;
    if (a <= sweepEnd) points.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
  }
  return {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

function measure(draw: (g: InkRecorder) => void): InkRecorder {
  const recorder = new InkRecorder();
  draw(recorder);
  return recorder;
}

function measureSpec(spec: FrameSpec): InkRecorder {
  return measure((g) =>
    spec.draw(g as unknown as Phaser.GameObjects.Graphics, spec.width, spec.height),
  );
}

/** The rounded-rect helper both the old and new specs go through. */
function roundRect(g: InkRecorder, x: number, y: number, w: number, h: number, r: number): void {
  g.fillRoundedRect(x, y, w, h, r);
}

const EPS = 1e-9;

describe('atlas frames draw only inside their own frame rectangle', () => {
  const specs = buildFrameSpecs();

  it('covers every frame family the game addresses by name', () => {
    const names = specs.map((s) => s.name);
    for (const expected of ['tile_w1', 'chunk_w6', 'slot_w3', 'slot_done_w3', 'btn', 'btn_down']) {
      expect(names, expected).toContain(expected);
    }
    for (const expected of ['btn_alt', 'btn_alt_down', 'btn_sq', 'btn_sq_down', 'panel', 'card']) {
      expect(names, expected).toContain(expected);
    }
  });

  it.each(buildFrameSpecs().map((spec) => [spec.name, spec] as const))(
    '%s stays within [0..width] x [0..height]',
    (_name, spec) => {
      const ink = measureSpec(spec);
      expect(ink.bounds.maxX).toBeLessThanOrEqual(spec.width + EPS);
      expect(ink.bounds.maxY).toBeLessThanOrEqual(spec.height + EPS);
      expect(ink.bounds.minX).toBeGreaterThanOrEqual(-EPS);
      expect(ink.bounds.minY).toBeGreaterThanOrEqual(-EPS);
    },
  );
});

describe('button frames (the clipped bottom shadow)', () => {
  const buttonSpecs = buildFrameSpecs().filter((spec) => spec.name.startsWith('btn'));

  it('produces one frame per button texture, pressed and idle', () => {
    const names = buttonSpecs.map((s) => s.name).sort();
    expect(names).toEqual(
      ['btn', 'btn_alt', 'btn_alt_down', 'btn_down', 'btn_sq', 'btn_sq_down'].sort(),
    );
  });

  it.each(buttonSpecs.map((spec) => [spec.name, spec] as const))(
    '%s ends its drop shadow exactly on the frame bottom edge',
    (_name, spec) => {
      const ink = measureSpec(spec);
      const shadow = ink.calls.find(
        (call) => call.op === 'fillRoundedRect' && call.fillAlpha < 0.5,
      );

      if (spec.name.endsWith('_down')) {
        // A pressed button is flush with the plate: no shadow at all.
        expect(shadow).toBeUndefined();
        return;
      }

      expect(shadow, 'idle button must draw a drop shadow').toBeDefined();
      const [x, y, w, h] = shadow?.args ?? [];
      // Shadow bottom lands ON the frame edge: clipped nowhere, rounded corner intact.
      expect((y ?? 0) + (h ?? 0)).toBeCloseTo(spec.height, 9);
      // Shadow is the same size as the face, offset down by 8px, full frame width.
      expect(x).toBe(0);
      expect(y).toBe(8);
      expect(w).toBe(spec.width);
    },
  );

  it('keeps the idle button face 8px shorter than the frame so the shadow shows', () => {
    const btn = buildFrameSpecs().find((s) => s.name === 'btn');
    expect(btn).toBeDefined();
    if (!btn) return;
    const ink = measureSpec(btn);
    const face = ink.calls.find((call) => call.op === 'fillRoundedRect' && call.fillAlpha === 1);
    expect(face?.args[3]).toBe(BUTTON_SIZE.height - 8);
  });
});

describe('tile frames (the top-left bleed)', () => {
  const tileSpecs = buildFrameSpecs().filter((spec) => spec.name.startsWith('tile_w'));

  it.each(tileSpecs.map((spec) => [spec.name, spec] as const))(
    '%s keeps body and right/down shadow inside the frame',
    (_name, spec) => {
      const ink = measureSpec(spec);
      const fills = ink.calls.filter((call) => call.op === 'fillRoundedRect');
      const shadow = fills.find((call) => call.fillAlpha < 0.5);
      const body = fills.find((call) => call.fillAlpha === 1);

      expect(shadow, 'tile must draw a drop shadow').toBeDefined();
      expect(body, 'tile must draw a body').toBeDefined();

      const [sx, sy, sw, sh] = shadow?.args ?? [];
      expect((sx ?? 0) + (sw ?? 0)).toBeCloseTo(spec.width, 9);
      expect((sy ?? 0) + (sh ?? 0)).toBeCloseTo(spec.height, 9);
      // Body is offset up-left from the shadow and never exceeds it.
      expect(body?.args[0]).toBe(0);
      expect(body?.args[1]).toBe(0);
      expect((body?.args[2] ?? 0) + (sx ?? 0)).toBeCloseTo(spec.width, 9);
    },
  );
});

describe('atlas packing gutters', () => {
  const specs = buildFrameSpecs();

  it('leaves at least the configured gutter between frames', () => {
    const packed = packFrames(specs, 2048, ATLAS_PADDING);
    const rects = [...packed.placements.entries()].map(([name, at]) => ({ name, ...at }) as const);

    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        if (!a || !b) continue;
        const separatedX =
          a.x + a.width + ATLAS_PADDING <= b.x || b.x + b.width + ATLAS_PADDING <= a.x;
        const separatedY =
          a.y + a.height + ATLAS_PADDING <= b.y || b.y + b.height + ATLAS_PADDING <= a.y;
        expect(separatedX || separatedY, `${a.name} vs ${b.name}`).toBe(true);
      }
    }
  });

  it('uses a gutter wide enough to absorb filtered sampling at any DPR', () => {
    // Half a texel each side is the worst bilinear overhang; 16px also covers the
    // worst-case devicePixelRatio rounding of a scaled frame.
    expect(ATLAS_PADDING).toBeGreaterThanOrEqual(16);
  });

  it('packs every spec exactly once', () => {
    const packed = packFrames(specs, 2048, ATLAS_PADDING);
    expect(packed.placements.size).toBe(specs.length);
    expect(packed.width).toBeLessThanOrEqual(2048);
  });
});

/**
 * CANARY — these reproduce the PRE-FIX drawing formulas verbatim and prove the
 * assertions above would have failed on them. Without this, a future edit could
 * weaken the bounds test (e.g. compare against frame + 8) and stay green.
 */
describe('canary: the pre-fix formulas violated the frame bounds', () => {
  it('the old button shadow ran 8px past the frame bottom (h = 128 -> 136)', () => {
    const w = BUTTON_SIZE.width;
    const h = BUTTON_SIZE.height;
    const ink = measure(() => {});
    const old = measure((g) => {
      g.fillStyle(0x000000, 0.16);
      roundRect(g, 0, 8, w, h, 30);
      g.fillStyle(0xffffff, 1);
      roundRect(g, 0, 0, w, h - 8, 30);
      g.lineStyle(4, 0x000000, 1);
      g.strokeRoundedRect(2, 2, w - 4, h - 8 - 4, 30);
    });

    expect(ink.bounds.maxY).toBe(Number.NEGATIVE_INFINITY); // no draw, no ink
    expect(old.bounds.maxY).toBe(h + 8);
    expect(old.bounds.maxY).toBeGreaterThan(h);
  });

  it('the old tile shadow ran 5px right and 8px down past the frame', () => {
    const w = 264;
    const h = 144;
    const old = measure((g) => {
      g.fillStyle(0x000000, 0.14);
      roundRect(g, 5, 8, w, h, 28);
      g.fillStyle(0xffd166, 1);
      roundRect(g, 0, 0, w, h, 28);
    });

    expect(old.bounds.maxX).toBe(w + 5);
    expect(old.bounds.maxY).toBe(h + 8);
    expect(old.bounds.maxX).toBeGreaterThan(w);
    expect(old.bounds.maxY).toBeGreaterThan(h);
  });

  it('the old tile shadow bled into a neighbouring frame at the old 2px gutter', () => {
    // Rebuild the atlas layout with the OLD gutter and the OLD tile draw, then
    // look for ink from one frame landing inside another frame's rectangle —
    // the mechanism behind the blob outside the Play button's rounded corner.
    const specs = buildFrameSpecs();
    const oldPacked = packFrames(specs, 2048, 2);
    const newPacked = packFrames(specs, 2048, ATLAS_PADDING);

    const bleeders = (packed: ReturnType<typeof packFrames>, oldDraw: boolean): string[] => {
      const rects = [...packed.placements.entries()];
      const hits: string[] = [];
      for (const [name, at] of rects) {
        const spec = specs.find((s) => s.name === name);
        if (!spec) continue;
        const ink = measure((g) => {
          if (!oldDraw || !spec.name.startsWith('tile_w')) {
            spec.draw(g as unknown as Phaser.GameObjects.Graphics, spec.width, spec.height);
            return;
          }
          // Pre-fix tile geometry.
          const r = Math.min(28, spec.height * 0.22);
          g.fillStyle(0x000000, 0.14);
          roundRect(g, 5, 8, spec.width, spec.height, r);
          g.fillStyle(0xffd166, 1);
          roundRect(g, 0, 0, spec.width, spec.height, r);
        });
        const inkRect = {
          x0: at.x + ink.bounds.minX,
          y0: at.y + ink.bounds.minY,
          x1: at.x + ink.bounds.maxX,
          y1: at.y + ink.bounds.maxY,
        };
        for (const [otherName, other] of rects) {
          if (otherName === name) continue;
          const overlaps =
            inkRect.x0 < other.x + other.width &&
            inkRect.x1 > other.x &&
            inkRect.y0 < other.y + other.height &&
            inkRect.y1 > other.y;
          if (overlaps) hits.push(`${name} -> ${otherName}`);
        }
      }
      return hits;
    };

    expect(bleeders(oldPacked, true).length).toBeGreaterThan(0);
    expect(bleeders(newPacked, false)).toEqual([]);
  });
});
