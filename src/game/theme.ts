/**
 * Visual + layout constants and the stage (viewport) model.
 * Placeholder art only — real art is a later milestone.
 *
 * STAGE MODEL (Scale.RESIZE — replaces the old Scale.FIT + letterboxed 1280x720)
 * -----------------------------------------------------------------------------
 * The canvas now always fills the browser viewport 1:1 (Phaser.Scale.RESIZE sizes
 * the canvas to #game, which is 100% x 100%), so there is never a dead letterbox
 * bar. Scenes still author against a fixed CONTENT ISLAND of DESIGN_WIDTH x
 * DESIGN_HEIGHT whose centre is (ISLAND_CENTRE_X, ISLAND_CENTRE_Y); the camera is
 * zoomed and centred on that island, so the island stays centred while the
 * background paints edge to edge.
 *
 * The live stage is the part of the world the viewport actually shows:
 *
 *     aspect = viewportWidth / viewportHeight
 *     width  = max(MIN_DESIGN_WIDTH, DESIGN_HEIGHT * aspect)   // world px
 *     height = width / aspect                                  // world px
 *     scale  = viewportWidth / width  (=== viewportHeight / height)
 *
 * `width * scale === viewportWidth` and `height * scale === viewportHeight` by
 * construction, which is what makes the canvas full-bleed at EVERY aspect ratio.
 *
 * Two regimes fall out of that one formula:
 *   - WIDE (aspect >= 16:9, e.g. phone landscape 932x430 = 2.17:1):
 *     width grows, height stays 720. The island sits in the middle and extra sky
 *     is painted left/right; the scale is driven by HEIGHT alone (vh / 720).
 *   - NARROW (aspect < 16:9, e.g. tablet landscape 1180x820 = 1.44:1):
 *     width is pinned at MIN_DESIGN_WIDTH so the widest fixed-width surface still
 *     fits, and the visible HEIGHT GROWS past 720 instead of letterboxing
 *     vertically. The island band stays vertically centred with sky above/below;
 *     the scale is driven by WIDTH alone (vw / 1280).
 *
 * "Grow the visible height" is the ONE mechanism chosen for narrow viewports (as
 * opposed to down-scaling content through a second camera zoom): content always
 * renders at exactly `scale` CSS px per design px, so the touch-target math below
 * stays exact and one number describes both regimes.
 *
 * TOUCH-TARGET MATH (spec: "Touch targets >= 64x64 CSS px")
 * In both regimes `scale === min(vw / DESIGN_WIDTH, vh / DESIGN_HEIGHT)`. Every
 * interactive element is sized so `size * scale >= 64` at the smallest supported
 * viewport (640x360 CSS, i.e. a phone in landscape, scale = 0.5):
 *   - tiles      128 x 144 design -> 64 x 72 CSS at scale 0.5
 *   - buttons    128 tall design  -> 64 CSS tall at scale 0.5
 *
 * Below that scale the 64px floor cannot be met for ANY fixed design size, so the
 * app refuses to present the playable stage: `viewportFit()` reports 'rotate'
 * (portrait phone) or 'too-small' (tiny landscape window) and the HTML overlay in
 * index.html replaces the canvas with a readable instruction. That keeps the
 * constraint true across the whole viewport domain instead of only in landscape.
 *
 * RENDER RESOLUTION (measured trade-off, recorded so it is not rediscovered)
 * Scale.RESIZE gives one canvas backing pixel per CSS pixel: Phaser sizes the
 * canvas to the parent and deliberately ignores devicePixelRatio (see the
 * fill-rate warning in ScaleManager's docs). The pre-fix FIT build instead drew
 * 1280x720 backing pixels into a 764-CSS-px box at 932x430, i.e. ~1.67 backing px
 * per CSS px, so a DPR-3 phone now rasterises type at 1.0 instead of 1.67 CSS-px
 * density and the browser upscales it. Measured on the wordmark at DPR 3 the
 * mid-tone edge band grows from 10.8% to 11.9% of the crop — a slight softening,
 * still read as crisp, and NOT a layout regression. Raising the density needs the
 * canvas backing store to differ from the game size, which Phaser's pointer
 * transform (`displayScale = baseSize / canvasBounds`) ties to the game size; that
 * is a separate renderer decision, not a layout one. Fill cost stays bounded by
 * the viewport: 0.40M px at 932x430 vs the old fixed 0.92M px buffer.
 */

export const DESIGN_WIDTH = 1280;
export const DESIGN_HEIGHT = 720;

/** Centre of the content island — every scene centres its content here. */
export const ISLAND_CENTRE_X = DESIGN_WIDTH / 2;
export const ISLAND_CENTRE_Y = DESIGN_HEIGHT / 2;

/**
 * Narrowest live stage width (world px). Below this the fixed-width surfaces stop
 * fitting: the Wordbook panel is 980 wide with pager arrows at 76 / width-76
 * (needs >= 1264) and GameScene's tray wraps at TRAY_MAX_WIDTH = 1180. Pinning the
 * stage to the island width satisfies both by construction.
 */
export const MIN_DESIGN_WIDTH = DESIGN_WIDTH;

/** Worst-case stage scale we design touch targets for (640x360 CSS). */
export const MIN_VIEWPORT_SCALE = 0.5;

/** Viewport gate verdict: playable, rotate the device, or enlarge the window. */
export type ViewportNotice = 'none' | 'rotate' | 'too-small';

export interface ViewportFit {
  /** Stage scale for this viewport (design px -> CSS px). */
  scale: number;
  /** What to tell the player. 'none' means the stage is playable. */
  notice: ViewportNotice;
}

/**
 * The live, full-bleed stage for a viewport. All values are world (design) px
 * except `scale`, which converts world px to CSS px.
 */
export interface StageMetrics {
  /** Visible stage width; always >= MIN_DESIGN_WIDTH. */
  width: number;
  /** Visible stage height; always >= DESIGN_HEIGHT. */
  height: number;
  /** World px -> CSS px factor (0 only for a degenerate 0-area viewport). */
  scale: number;
  /** World x of the visible left edge (negative when the stage is wider). */
  left: number;
  /** World x of the visible right edge. */
  right: number;
  /** World y of the visible top edge (negative when the stage is taller). */
  top: number;
  /** World y of the visible bottom edge. */
  bottom: number;
  /** World x of the content island centre (constant: the island never moves). */
  centreX: number;
  /** World y of the content island centre. */
  centreY: number;
}

/**
 * The stage model. Pure: this is the single source of truth for how a viewport
 * maps onto the design space, used by the camera binding (src/ui/stage.ts), the
 * scenes, and the viewport gate.
 */
export function stageMetrics(viewportWidth: number, viewportHeight: number): StageMetrics {
  const vw = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 0;
  const vh = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 0;

  if (vw === 0 || vh === 0) {
    // Degenerate viewport: describe the island so nothing divides by zero.
    return {
      width: MIN_DESIGN_WIDTH,
      height: DESIGN_HEIGHT,
      scale: 0,
      left: ISLAND_CENTRE_X - MIN_DESIGN_WIDTH / 2,
      right: ISLAND_CENTRE_X + MIN_DESIGN_WIDTH / 2,
      top: 0,
      bottom: DESIGN_HEIGHT,
      centreX: ISLAND_CENTRE_X,
      centreY: ISLAND_CENTRE_Y,
    };
  }

  const aspect = vw / vh;
  const width = Math.max(MIN_DESIGN_WIDTH, DESIGN_HEIGHT * aspect);
  const height = width / aspect;
  const scale = vw / width;

  return {
    width,
    height,
    scale,
    left: ISLAND_CENTRE_X - width / 2,
    right: ISLAND_CENTRE_X + width / 2,
    top: ISLAND_CENTRE_Y - height / 2,
    bottom: ISLAND_CENTRE_Y + height / 2,
    centreX: ISLAND_CENTRE_X,
    centreY: ISLAND_CENTRE_Y,
  };
}

/**
 * Decides whether the stage can honour the 64 CSS px touch-target floor.
 * Below MIN_VIEWPORT_SCALE no design size can, so we ask the player to rotate
 * (portrait) or enlarge the window (landscape) instead of serving 36px buttons.
 */
export function viewportFit(width: number, height: number): ViewportFit {
  const scale = stageMetrics(width, height).scale;
  if (Number.isFinite(scale) && scale >= MIN_VIEWPORT_SCALE - 1e-9) {
    return { scale, notice: 'none' };
  }
  return { scale, notice: height > width ? 'rotate' : 'too-small' };
}

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

/**
 * Magnetic drop zone, as extra design px around a slot's half width / half height.
 * The SAME numbers govern the hover highlight and the actual drop: if the green
 * accept frame shows, releasing there places the tile. (They used to differ —
 * highlight at +56, drop at +20 — so a tile could light up a slot and then bounce
 * home as a wrong drop. That contradiction is what these shared constants remove.)
 */
export const DROP_SLOP_X = 20;
export const DROP_SLOP_Y = 30;

/**
 * Is the point (tile centre) within the drop zone of a slot centred at (x, y)?
 * Pure so the rule can be unit-tested and shared by hover and drop.
 */
export function withinDropZone(
  tile: { x: number; y: number },
  slot: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    Math.abs(tile.x - slot.x) <= slot.width / 2 + DROP_SLOP_X &&
    Math.abs(tile.y - slot.y) <= slot.height / 2 + DROP_SLOP_Y
  );
}

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

/**
 * Wordbook screen geometry (design px).
 *
 * The previous layout stacked a 3-row grid (ending at y=656), the pager (y=580)
 * and a bottom Back button (598..726) on top of each other: the pager drew over
 * row 3, the Back button covered its lower third AND overflowed the 1280x720
 * stage by 6px, and tapping a card at (560,620) hit both the card and Back.
 *
 * Now: Back is promoted into the header, the pager arrows move to the sides of
 * the grid (vertically centred), and every band is disjoint and inside 720.
 *    header 10..142   pill 164..180
 *    grid   186..594  (3 rows x 128 + 2 x 12 gaps)
 *    pager  316..448  (side arrows only, clear of the 186..1094 card band)
 *    pager caption    y 650 (638..662), below the grid
 *
 * HORIZONTAL anchoring: `inset` values are measured from the LIVE stage edge
 * (`wordbookPagerX`, `wordbookColumnX`), not from the 1280 design width, so on a
 * wide phone stage the arrows hug the screen edges and the cards stay centred in
 * whatever the viewport shows. The panel keeps its 980px content width and is
 * centred: a centred content island in a full-bleed sky.
 */
export const WORDBOOK = {
  columns: 3,
  rows: 3,
  gridTop: 186,
  card: { width: 292, height: 128 },
  gapX: 16,
  gapY: 12,
  /** Pager arrows: `pagerInset` from each live stage edge, vertically centred. */
  pagerY: 390,
  pagerInset: 76,
  pagerButtonSize: 132,
  /** Caption row under the grid (page indicator). */
  pagerCaptionY: 650,
  /** Back lives in the header, `backInset` from the live stage's left edge. */
  backInset: 116,
  backButtonY: 76,
  backButtonWidth: 200,
  backButtonHeight: 132,
  /**
   * Backdrop panel, sized to sit exactly BETWEEN the pager arrows and below the
   * header, so no control straddles its rounded edge. Centred on the stage.
   */
  panel: { y: 425, width: 980, height: 550 },
} as const;

/** Pager arrow centres for a live stage: `pagerInset` inside its left/right edges. */
export function wordbookPagerX(stage: StageMetrics): { left: number; right: number } {
  return { left: stage.left + WORDBOOK.pagerInset, right: stage.right - WORDBOOK.pagerInset };
}

/** The Wordbook Back button x for a live stage (header, hugging the left edge). */
export function wordbookBackX(stage: StageMetrics): number {
  return stage.left + WORDBOOK.backInset;
}

/**
 * Horizontal anchoring rule for an object that follows the live stage.
 * Centred content needs no rule at all (the camera keeps the island centred);
 * this exists for surfaces that hug a stage edge — header buttons, pager arrows,
 * Wordbook Back, decorations — so they stay inside the frame on any aspect ratio.
 */
export type StageAnchor =
  | { readonly kind: 'centre'; readonly dx?: number }
  | { readonly kind: 'left'; readonly inset: number }
  | { readonly kind: 'right'; readonly inset: number };

/** Stage-relative x for an anchor. Pure, so the rule itself is unit-tested. */
export function anchorX(stage: StageMetrics, anchor: StageAnchor): number {
  switch (anchor.kind) {
    case 'left':
      return stage.left + anchor.inset;
    case 'right':
      return stage.right - anchor.inset;
    case 'centre':
      return stage.centreX + (anchor.dx ?? 0);
  }
}

export const WORDBOOK_PER_PAGE = WORDBOOK.columns * WORDBOOK.rows;

/** Bottom edge of the last grid row, in design px. */
export const WORDBOOK_GRID_BOTTOM =
  WORDBOOK.gridTop + WORDBOOK.rows * WORDBOOK.card.height + (WORDBOOK.rows - 1) * WORDBOOK.gapY;

/** Full width of a centred grid row, in design px. */
export const WORDBOOK_GRID_WIDTH =
  WORDBOOK.columns * WORDBOOK.card.width + (WORDBOOK.columns - 1) * WORDBOOK.gapX;

/** x of the column `col` centre (0-based), centred on the content island. */
export function wordbookColumnX(col: number, columnsInRow: number = WORDBOOK.columns): number {
  return ISLAND_CENTRE_X + (col - (columnsInRow - 1) / 2) * (WORDBOOK.card.width + WORDBOOK.gapX);
}

/** y of the row `row` centre (0-based). */
export function wordbookRowY(row: number): number {
  return WORDBOOK.gridTop + row * (WORDBOOK.card.height + WORDBOOK.gapY) + WORDBOOK.card.height / 2;
}

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
