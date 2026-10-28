import Phaser from 'phaser';
import {
  ATLAS_KEY,
  BANDS,
  BUTTON_SIZE,
  CARD_SIZE,
  COLORS,
  DESIGN_HEIGHT,
  FRAME_BUCKETS,
  PANEL_SIZE,
  bucketDesignWidth,
  type TileColors,
} from './theme';

/**
 * A frame in the runtime-generated UI atlas.
 * `draw` receives a Graphics already positioned at the frame's top-left corner.
 */
export interface FrameSpec {
  name: string;
  width: number;
  height: number;
  draw: (g: Phaser.GameObjects.Graphics, width: number, height: number) => void;
}

const TILE_H = BANDS.slotHeight;

const FACE = 0xffffff;

/**
 * Drop-shadow offset for a tile frame, in design px (down-right).
 *
 * The tile body is inset by exactly this much so that BOTH the body and the
 * shadow fit inside the frame rectangle declared to the texture atlas:
 *
 *     body   (0, 0, w - dx, h - dy)      -> right/bottom edge at w-dx / h-dy
 *     shadow (dx, dy, w - dx, h - dy)    -> right/bottom edge at w    / h
 *
 * Drawing past `w`/`h` is what produced the visible glitches, because the atlas
 * packs frames edge to edge and the renderer clips at the frame bounds:
 *   - a shadow that overflowed the frame bled into whatever frame sat below it
 *     (the top-left "protrusion" on Menu's Play button was the previous frame's
 *     shadow showing through its rounded corner), and
 *   - a shadow taller than the frame was sliced flat at the bottom instead of
 *     ending in the rounded corner it was drawn with.
 * `tests/uiAtlas.regression.test.ts` pins "nothing is drawn outside its frame"
 * for every spec, so this cannot regress silently again.
 */
const TILE_SHADOW_DX = 4;
const TILE_SHADOW_DY = 6;

/**
 * Gutter around every packed frame. Also absorbs GPU bilinear filtering
 * (half a texel each side) and any devicePixelRatio rounding, so a frame can
 * never sample its neighbour even when it is drawn scaled.
 */
export const ATLAS_PADDING = 16;

function roundRect(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  g.fillRoundedRect(x, y, w, h, radius);
}

/** Yellow letter tile / green chunk tile. */
export function makeTileFrameSpec(
  name: string,
  width: number,
  height: number,
  c: TileColors,
  bucket: number,
): FrameSpec {
  return {
    name: `${name}_w${bucket}`,
    width,
    height,
    draw: (g, w, h) => {
      const r = Math.min(28, h * 0.22);
      // Body + shadow are BOTH inset by the shadow offset so nothing is drawn
      // past (w, h): the shadow's bottom-right edge lands exactly on the frame
      // edge and is never clipped into a flat cut, and it cannot bleed into the
      // next packed frame.
      const bodyW = w - TILE_SHADOW_DX;
      const bodyH = h - TILE_SHADOW_DY;
      // drop shadow (down-right)
      g.fillStyle(0x000000, 0.14);
      roundRect(g, TILE_SHADOW_DX, TILE_SHADOW_DY, bodyW, bodyH, r);
      // body
      g.fillStyle(c.face, 1);
      roundRect(g, 0, 0, bodyW, bodyH, r);
      // top highlight band
      g.fillStyle(c.shine, 1);
      roundRect(g, 10, 10, bodyW - 20, bodyH * 0.34, r * 0.7);
      // inner border, inset 2px from the body edge (the 4px stroke straddles the
      // path by 2px, so the path stops 2px short of `bodyW`/`bodyH`)
      g.lineStyle(4, c.edge, 1);
      g.strokeRoundedRect(2, 2, bodyW - 4, bodyH - 4, r);
    },
  };
}

/** Empty slot (dashed) and filled-slot (solid green) frames. */
export function makeSlotFrameSpec(
  name: string,
  width: number,
  height: number,
  done: boolean,
  bucket: number,
): FrameSpec {
  return {
    name: `${name}_w${bucket}`,
    width,
    height,
    draw: (g, w, h) => {
      const r = Math.min(28, h * 0.22);
      g.fillStyle(done ? COLORS.slotDoneFill : COLORS.slotFill, 1);
      roundRect(g, 0, 0, w, h, r);
      g.lineStyle(done ? 6 : 4, done ? COLORS.slotDoneEdge : COLORS.slotEdge, 1);
      g.strokeRoundedRect(3, 3, w - 6, h - 6, r);
    },
  };
}

export function makeButtonFrameSpec(
  name: string,
  width: number,
  height: number,
  face: number,
  edge: number,
  pressed: boolean,
): FrameSpec {
  return {
    name,
    width,
    height,
    draw: (g, w, h) => {
      const r = 30;
      // The face is `faceH` tall starting at y = 0; the shadow is the SAME height
      // starting at y = 8, so it ends exactly at y = h.
      //
      // It used to be drawn `h` tall from y = 8 (ending at h + 8), i.e. 8px past
      // the frame. The atlas clips at the frame boundary, so the bottom of every
      // button shadow was sliced flat instead of keeping its rounded corners.
      const faceH = pressed ? h - 6 : h - 8;
      if (!pressed) {
        g.fillStyle(0x000000, 0.16);
        roundRect(g, 0, 8, w, faceH, r);
      }
      g.fillStyle(face, 1);
      roundRect(g, 0, 0, w, faceH, r);
      g.lineStyle(4, edge, 1);
      g.strokeRoundedRect(2, 2, w - 4, faceH - 4, r);
    },
  };
}

function makePanelSpec(name: string, width: number, height: number, alpha: number): FrameSpec {
  return {
    name,
    width,
    height,
    draw: (g, w, h) => {
      g.fillStyle(COLORS.panel, alpha);
      roundRect(g, 0, 0, w, h, 26);
      g.lineStyle(4, COLORS.panelEdge, 1);
      g.strokeRoundedRect(2, 2, w - 4, h - 4, 26);
    },
  };
}

function makeStarSpec(size: number): FrameSpec {
  return {
    name: 'star',
    width: size,
    height: size,
    draw: (g, w) => {
      const cx = w / 2;
      const cy = w / 2;
      const outer = w / 2 - 2;
      const inner = outer * 0.44;
      const pts: Phaser.Math.Vector2[] = [];
      for (let i = 0; i < 10; i += 1) {
        const r = i % 2 === 0 ? outer : inner;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        pts.push(new Phaser.Math.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
      }
      g.fillStyle(COLORS.starEdge, 1);
      g.fillPoints(pts, true);
      const pts2 = pts.map(
        (p) => new Phaser.Math.Vector2(cx + (p.x - cx) * 0.86, cy + (p.y - cy) * 0.86),
      );
      g.fillStyle(COLORS.star, 1);
      g.fillPoints(pts2, true);
    },
  };
}

function makeSpeakerSpec(size: number): FrameSpec {
  return {
    name: 'speaker',
    width: size,
    height: size,
    draw: (g, w) => {
      const s = w / 100;
      g.fillStyle(COLORS.iconDark, 1);
      // cone
      g.beginPath();
      g.moveTo(14 * s, 38 * s);
      g.lineTo(34 * s, 38 * s);
      g.lineTo(56 * s, 18 * s);
      g.lineTo(56 * s, 82 * s);
      g.lineTo(34 * s, 62 * s);
      g.lineTo(14 * s, 62 * s);
      g.closePath();
      g.fillPath();
      // waves
      g.lineStyle(6 * s, COLORS.iconDark, 1);
      g.beginPath();
      g.arc(58 * s, 50 * s, 16 * s, -0.9, 0.9);
      g.strokePath();
      g.beginPath();
      g.arc(58 * s, 50 * s, 30 * s, -0.9, 0.9);
      g.strokePath();
    },
  };
}

function makeHomeSpec(size: number): FrameSpec {
  return {
    name: 'home',
    width: size,
    height: size,
    draw: (g, w) => {
      const s = w / 100;
      g.fillStyle(COLORS.iconDark, 1);
      g.fillPoints(
        [
          new Phaser.Math.Vector2(50 * s, 12 * s),
          new Phaser.Math.Vector2(92 * s, 50 * s),
          new Phaser.Math.Vector2(8 * s, 50 * s),
        ],
        true,
      );
      g.fillRoundedRect(22 * s, 48 * s, 56 * s, 40 * s, 6 * s);
      g.fillStyle(FACE, 1);
      g.fillRoundedRect(42 * s, 60 * s, 16 * s, 28 * s, 4 * s);
    },
  };
}

function makeReplaySpec(size: number): FrameSpec {
  return {
    name: 'replay',
    width: size,
    height: size,
    draw: (g, w) => {
      const s = w / 100;
      g.lineStyle(9 * s, COLORS.iconDark, 1);
      g.beginPath();
      g.arc(50 * s, 50 * s, 30 * s, -Math.PI * 0.35, Math.PI * 1.25);
      g.strokePath();
      g.fillStyle(COLORS.iconDark, 1);
      g.fillPoints(
        [
          new Phaser.Math.Vector2(50 * s, 6 * s),
          new Phaser.Math.Vector2(76 * s, 26 * s),
          new Phaser.Math.Vector2(46 * s, 34 * s),
        ],
        true,
      );
    },
  };
}

function makeArrowSpec(size: number, dir: 'left' | 'right'): FrameSpec {
  return {
    name: dir === 'left' ? 'arrow_left' : 'arrow_right',
    width: size,
    height: size,
    draw: (g, w) => {
      const s = w / 100;
      const flip = dir === 'left' ? -1 : 1;
      const cx = 50 * s;
      const cy = 50 * s;
      g.fillStyle(COLORS.iconDark, 1);
      g.fillPoints(
        [
          new Phaser.Math.Vector2(cx + flip * 26 * s, cy),
          new Phaser.Math.Vector2(cx - flip * 12 * s, cy - 26 * s),
          new Phaser.Math.Vector2(cx - flip * 12 * s, cy + 26 * s),
        ],
        true,
      );
    },
  };
}

function makeLockSpec(size: number): FrameSpec {
  return {
    name: 'lock',
    width: size,
    height: size,
    draw: (g, w) => {
      const s = w / 100;
      g.lineStyle(10 * s, COLORS.slotEdge, 1);
      g.beginPath();
      g.arc(50 * s, 42 * s, 22 * s, Math.PI, Math.PI * 2);
      g.strokePath();
      g.fillStyle(COLORS.slotEdge, 1);
      g.fillRoundedRect(20 * s, 42 * s, 60 * s, 46 * s, 8 * s);
    },
  };
}

function makeDotSpec(size: number): FrameSpec {
  return {
    name: 'dot',
    width: size,
    height: size,
    draw: (g, w) => {
      g.fillStyle(0xffffff, 1);
      g.fillCircle(w / 2, w / 2, w / 2 - 2);
    },
  };
}

/** 8px-wide vertical gradient strip, stretched to fill a scene. */
function makeBgStripSpec(width: number, height: number): FrameSpec {
  return {
    name: 'bg_strip',
    width,
    height,
    draw: (g, w, h) => {
      const top = Phaser.Display.Color.IntegerToColor(COLORS.bgTop);
      const bottom = Phaser.Display.Color.IntegerToColor(COLORS.bgBottom);
      const steps = 24;
      const bandH = h / steps;
      for (let i = 0; i < steps; i += 1) {
        const t = i / (steps - 1);
        const c = Phaser.Display.Color.Interpolate.ColorWithColor(top, bottom, 1, t);
        g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
        // +1px overlaps the next band so no seam shows, but the LAST band is
        // clamped to the frame edge: overhanging it by a pixel let the strip
        // paint into the frame packed below it.
        const y = i * bandH;
        const bandHeight = Math.min(h - y, Math.ceil(bandH) + 1);
        g.fillRect(0, y, w, bandHeight);
      }
    },
  };
}

/** Every frame the game uses, in draw order. */
export function buildFrameSpecs(): FrameSpec[] {
  const specs: FrameSpec[] = [];

  const letterColors: TileColors = {
    face: COLORS.tileFace,
    edge: COLORS.tileEdge,
    shine: COLORS.tileShine,
  };
  const chunkColors: TileColors = {
    face: COLORS.chunkFace,
    edge: COLORS.chunkEdge,
    shine: COLORS.chunkShine,
  };

  for (const bucket of FRAME_BUCKETS) {
    const w = bucketDesignWidth(bucket);
    specs.push(makeTileFrameSpec('tile', w, TILE_H, letterColors, bucket));
    specs.push(makeTileFrameSpec('chunk', w, TILE_H, chunkColors, bucket));
    specs.push(makeSlotFrameSpec('slot', w, TILE_H, false, bucket));
    specs.push(makeSlotFrameSpec('slot_done', w, TILE_H, true, bucket));
  }

  specs.push(
    makeButtonFrameSpec(
      'btn',
      BUTTON_SIZE.width,
      BUTTON_SIZE.height,
      COLORS.btnFace,
      COLORS.btnEdge,
      false,
    ),
  );
  specs.push(
    makeButtonFrameSpec(
      'btn_down',
      BUTTON_SIZE.width,
      BUTTON_SIZE.height,
      COLORS.btnFace,
      COLORS.btnEdge,
      true,
    ),
  );
  specs.push(
    makeButtonFrameSpec(
      'btn_alt',
      BUTTON_SIZE.width,
      BUTTON_SIZE.height,
      COLORS.btnAltFace,
      COLORS.btnAltEdge,
      false,
    ),
  );
  specs.push(
    makeButtonFrameSpec(
      'btn_alt_down',
      BUTTON_SIZE.width,
      BUTTON_SIZE.height,
      COLORS.btnAltFace,
      COLORS.btnAltEdge,
      true,
    ),
  );
  specs.push(
    makeButtonFrameSpec(
      'btn_sq',
      BANDS.headerButton,
      BANDS.headerButton,
      COLORS.white,
      COLORS.panelEdge,
      false,
    ),
  );
  specs.push(
    makeButtonFrameSpec(
      'btn_sq_down',
      BANDS.headerButton,
      BANDS.headerButton,
      COLORS.panel,
      COLORS.panelEdge,
      true,
    ),
  );

  specs.push(makePanelSpec('panel', PANEL_SIZE.width, PANEL_SIZE.height, 0.97));
  specs.push(makePanelSpec('card', CARD_SIZE.width, CARD_SIZE.height, 1));

  specs.push(makeStarSpec(96));
  specs.push(makeSpeakerSpec(96));
  specs.push(makeHomeSpec(96));
  specs.push(makeReplaySpec(96));
  specs.push(makeArrowSpec(96, 'left'));
  specs.push(makeArrowSpec(96, 'right'));
  specs.push(makeLockSpec(96));
  specs.push(makeDotSpec(20));
  specs.push(makeBgStripSpec(8, DESIGN_HEIGHT));

  return specs;
}

export interface PackedAtlas {
  width: number;
  height: number;
  placements: Map<string, { x: number; y: number; width: number; height: number }>;
}

/** Simple shelf packer: deterministic layout, no external deps. */
export function packFrames(specs: FrameSpec[], maxWidth: number, padding: number): PackedAtlas {
  const placements = new Map<string, { x: number; y: number; width: number; height: number }>();
  let cursorX = padding;
  let cursorY = padding;
  let rowHeight = 0;
  let usedWidth = 0;

  for (const spec of specs) {
    const w = spec.width + padding;
    const h = spec.height + padding;
    if (cursorX + w > maxWidth && cursorX > padding) {
      cursorX = padding;
      cursorY += rowHeight;
      rowHeight = 0;
    }
    placements.set(spec.name, {
      x: cursorX,
      y: cursorY,
      width: spec.width,
      height: spec.height,
    });
    cursorX += w;
    rowHeight = Math.max(rowHeight, h);
    usedWidth = Math.max(usedWidth, cursorX);
  }

  return {
    width: Math.max(1, usedWidth),
    height: Math.max(1, cursorY + rowHeight),
    placements,
  };
}

/**
 * Builds ONE texture (`ui`) containing every UI frame, so the game never loads a
 * per-element image file. Frames are addressed by name (`tile_w3`, `star`, ...).
 * Idempotent: calling twice is a no-op.
 */
export function buildUiAtlas(scene: Phaser.Scene, maxWidth = 2048): Phaser.Textures.Texture {
  const existing = scene.textures.exists(ATLAS_KEY) ? scene.textures.get(ATLAS_KEY) : null;
  if (existing && existing.key === ATLAS_KEY && existing.has('tile_w1')) {
    return existing;
  }

  const specs = buildFrameSpecs();
  const packed = packFrames(specs, maxWidth, ATLAS_PADDING);

  const rt = scene.make.renderTexture({ width: packed.width, height: packed.height }, false);
  rt.setOrigin(0, 0);

  for (const spec of specs) {
    const at = packed.placements.get(spec.name);
    if (!at) continue;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    spec.draw(g, spec.width, spec.height);
    rt.draw(g, at.x, at.y);
    g.destroy();
  }

  rt.saveTexture(ATLAS_KEY);

  const texture = scene.textures.get(ATLAS_KEY);
  for (const spec of specs) {
    const at = packed.placements.get(spec.name);
    if (!at) continue;
    if (!texture.has(spec.name)) {
      texture.add(spec.name, 0, at.x, at.y, spec.width, spec.height);
    }
  }

  rt.destroy();
  return texture;
}
