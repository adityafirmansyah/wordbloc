/**
 * Visual + layout constants. Placeholder art only — real art is a later milestone.
 * Design space is 1280x720 (docs/SPEC.md) with Scale.FIT + center.
 *
 * TOUCH-TARGET MATH (spec: "Touch targets >= 64x64 CSS px")
 * Scale.FIT renders the 1280x720 design space at `s = min(vw/1280, vh/720)`.
 * Every interactive element is therefore sized so that `size * s >= 64` at the
 * smallest viewport we support (640x360 CSS, i.e. a phone in landscape, s = 0.5):
 *   - tiles      128 x 144 design -> 64 x 72 CSS at s = 0.5
 *   - buttons    128 tall design  -> 64 CSS tall at s = 0.5
 * Measured in a real browser by `tests/manual/touch-targets` evidence in the PR.
 */

export const DESIGN_WIDTH = 1280;
export const DESIGN_HEIGHT = 720;

/** Worst-case Scale.FIT factor we design touch targets for (640x360 CSS). */
export const MIN_VIEWPORT_SCALE = 0.5;

export const COLORS = {
  bgTop: 0x9adaff,
  bgBottom: 0xe6f7ff,
  sun: 0xfff3b0,
  cloud: 0xffffff,
  hill: 0xbfe9a8,
  ink: 0x21324a,
  inkSoft: 0x54708c,

  tileFace: 0xffd166,
  tileEdge: 0xd99b1a,
  tileShine: 0xffe9a8,
  tileText: '#3a2a00',

  chunkFace: 0xa8e6a1,
  chunkEdge: 0x3f9450,
  chunkShine: 0xd2f5cd,
  chunkText: '#13351b',

  slotFill: 0xf2f8fc,
  slotEdge: 0x9dc2da,
  slotDoneEdge: 0x3f9450,
  slotDoneFill: 0xdaf3d4,

  btnFace: 0xff6b6b,
  btnEdge: 0xc24848,
  btnText: '#ffffff',

  btnAltFace: 0x5bb8ff,
  btnAltEdge: 0x2b7fb8,

  star: 0xffd93d,
  starEdge: 0xd9a300,

  panel: 0xffffff,
  panelEdge: 0xbcd7ea,

  ghost: 0x8fb0c9,
  iconDark: 0x3d5c7d,
  white: 0xffffff,
  confetti: [0xff6b6b, 0xffd93d, 0x5bb8ff, 0xa8e6a1, 0xff9ecd, 0xffffff] as const,
} as const;

export const FONT_FAMILY = '"Trebuchet MS", "Segoe UI", Verdana, sans-serif';

/** Interactive tile height (design px). See touch-target math above. */
export const TILE_HEIGHT = 144;
/** Minimum tile width; keeps 1-letter tiles above the 64 CSS px floor at s=0.5. */
export const TILE_WIDTH_MIN = 128;
const TILE_WIDTH_PAD = 60;
const TILE_WIDTH_PER_CHAR = 34;

/** Gaps between slots / tiles, in design px. */
export const SLOT_GAP = 8;
export const TRAY_GAP = 10;
export const TRAY_ROW_GAP = 14;
/** Maximum row width the tray may occupy before it wraps. */
export const TRAY_MAX_WIDTH = 1180;

/** Routes. */
export const SCENES = {
  boot: 'Boot',
  menu: 'Menu',
  game: 'Game',
  reward: 'Reward',
  wordbook: 'Wordbook',
} as const;

/** Width of a tile/slot holding `unit`. */
export function tileWidth(unit: string): number {
  const chars = Math.max(unit.length, 1);
  return Math.max(TILE_WIDTH_MIN, TILE_WIDTH_PAD + chars * TILE_WIDTH_PER_CHAR);
}

/**
 * Atlas frames are bucketed by unit length, capped at 6 characters. Frame k is
 * generated at `tileWidth('X'.repeat(k))`, so it is always at least as wide as
 * the widest tile in that bucket and sprites only ever scale down (never up).
 */
export const MAX_FRAME_BUCKET = 6;

export function frameBucketFor(unit: string): number {
  return Math.min(Math.max(unit.length, 1), MAX_FRAME_BUCKET);
}

/** Every bucket 1..MAX_FRAME_BUCKET, used by the atlas builder. */
export const FRAME_BUCKETS: readonly number[] = [1, 2, 3, 4, 5, 6];

export function bucketDesignWidth(bucket: number): number {
  return tileWidth('X'.repeat(bucket));
}

export function tileFrameFor(unit: string): string {
  return `tile_w${frameBucketFor(unit)}`;
}
export function chunkFrameFor(unit: string): string {
  return `chunk_w${frameBucketFor(unit)}`;
}
export function slotFrameFor(unit: string): string {
  return `slot_w${frameBucketFor(unit)}`;
}
export function slotDoneFrameFor(unit: string): string {
  return `slot_done_w${frameBucketFor(unit)}`;
}

export const ATLAS_KEY = 'ui';

/** Colour triple for a tile family (letter tiles vs chunk tiles). */
export interface TileColors {
  face: number;
  edge: number;
  shine: number;
}

/** Non-tile frame names produced by buildUiAtlas(). */
export const FRAMES = {
  bgStrip: 'bg_strip',
  panel: 'panel',
  card: 'card',
  star: 'star',
  speaker: 'speaker',
  home: 'home',
  replay: 'replay',
  arrowLeft: 'arrow_left',
  arrowRight: 'arrow_right',
  lock: 'lock',
  dot: 'dot',
  btn: 'btn',
  btnDown: 'btn_down',
  btnAlt: 'btn_alt',
  btnAltDown: 'btn_alt_down',
  btnSq: 'btn_sq',
  btnSqDown: 'btn_sq_down',
} as const;

/** Button frame sizes (design px). Height 128 keeps the 64 CSS px floor at s=0.5. */
export const BUTTON_SIZE = { width: 340, height: 128 } as const;
export const HEADER_BUTTON_SIZE = { width: 128, height: 128 } as const;

/** Frame sizes for panel-like frames (real size is set per-use via setDisplaySize). */
export const PANEL_SIZE = { width: 1000, height: 560 } as const;
export const CARD_SIZE = { width: 300, height: 180 } as const;

/** Vertical bands of the game scene, in design px. */
export const BANDS = {
  headerCenterY: 76,
  headerButton: HEADER_BUTTON_SIZE.width,
  artCenterY: 214,
  artSize: { width: 300, height: 150 },
  /** Mechanic instruction line ("Drag the letters"). */
  mechanicY: 318,
  /** Level hint / riddle line, one row below the instruction. */
  hintY: 352,
  slotsCenterY: 444,
  slotHeight: TILE_HEIGHT,
  trayCenterY: 604,
  /** Bottom margin the tray must never cross. */
  safeBottom: 704,
} as const;
