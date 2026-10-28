# Button shadow fix — evidence

Owner report: *"fix issue on the button shadows. its glitches"* (Menu **Play** and
**Wordbook** buttons).

Two distinct defects, both in `src/game/uiAtlas.ts`, both consequences of drawing
past the frame rectangle the atlas declares for a texture. This folder holds the
before/after captures and the measurements taken from them.

Method: two production builds of the same commit range — `main` (d071d12, pre-fix)
and this branch (post-fix) — served side by side and captured in the same browser
at 1280x720, DPR 1, via CDP `Page.captureScreenshot`. Every number below was read
back out of those PNGs with PIL, not estimated.

## 1. Top-left protruding artifact on "Play"

`makeTileFrameSpec()` drew its drop shadow at `(+5, +8)` with the FULL frame size,
so a 230x144 tile frame painted ink out to `w + 5` and `h + 8`. In the packed
atlas the frame below it started 2px later, so the shadow landed inside the
*neighbouring* frame's rectangle.

Measured on the pre-fix atlas (`textures.get('ui').frames`, read from the running
game at 1280x720):

```
btn       frame rect      x 800  y 294  w 340  h 128
tile_w5   frame rect      x 596  y 148  w 230  h 144   shadow -> y 156..300
chunk_w5  frame rect      x 828  y 148  w 230  h 144   shadow -> y 156..300
slot_w5   frame rect      x 1060 y 148  w 230  h 144   shadow -> (no shadow, but
                                                        sits 2px under chunk_w5)
```

`chunk_w5`'s shadow ends at y = 300 while `btn` starts at y = 294, so **6 rows of
foreign shadow (x 833..1063) were baked into the Play button's texture**. The
button draws its 30px rounded corner on top, so that contaminated strip appeared
outside the button's top-left curve.

Pixel measurement of that strip in `01-menu-before.png` (the 20px band above/left
of the Play button's corner, non-sky pixels):

| capture | non-sky pixels in the band | extent |
| --- | --- | --- |
| `01-menu-before.png` | **25** | x 470..499, y 290 (one row, 25px long) |
| `02-menu-after.png` | **5** | x 495..499, y 290 (the button's own top edge) |

The pre-fix strip is the 25px bar visible at 6x in
`03-play-corner-before.png`; `04-play-corner-after.png` shows the same 6x crop
with the band clean.

A full sweep of the pre-fix atlas found **9** (frame → frame) bleed pairs — the
same mechanism appearing wherever a tile/chunk frame sat above or beside another
frame. After the fix every frame's ink is bounded by its own rectangle (enforced
by `tests/uiAtlas.regression.test.ts`), and the tightest gap between any two
frame rects is the configured gutter:

```
pre-fix  atlas 2006x1724   min separation between frame rects:  2px (tile_w1 / chunk_w1)
post-fix atlas 2032x1808   min separation between frame rects: 16px (tile_w1 / chunk_w1)
```

## 2. Clipped bottom on button shadows

`makeButtonFrameSpec()` drew the shadow `h` tall from `y = 8` (ending at
`h + 8 = 136`) while the frame is 128 tall, so the atlas clipped the shadow's
last 8 rows flat — destroying the rounded bottom corners.

Shadow colour (`rgb(165,197,215)` = black 16% over the sky) sampled per row across
the Play button, from the two captures:

```
            before                                   after
y=406  x 472..807  width 336            y=406  x 476..803  width 328
y=410  x 474..805  width 332            y=410  x 480..799  width 320
y=414  x 476..803  width 328            y=414  x 486..793  width 308
y=417  x 479..800  width 322            y=417  x 495..784  width 290
y=418  (no shadow)                      y=418  (no shadow)
```

Both end at the frame's last row (y=417, frame bottom 418) — but the taper tells
the two shapes apart. Pre-fix the width only shrinks **14px over the last 12 rows**
(336 → 322): the shadow is a rectangle cut off at the bottom, its corners still
almost square. Post-fix it shrinks **38px over the same rows** (328 → 290),
following the 30px corner radius all the way round. `05-play-bottom-before.png`
and `06-play-bottom-after.png` show the same edge at 4x.

Fixing the height exposed a second half of the same bug: because the shadow now
ENDS on the frame edge, any frame packed below it is adjacent to live ink rather
than transparent padding — which is exactly why the gutter change (item 3) is
part of this fix rather than a tidy-up.

## 3. Atlas gutter

`buildUiAtlas()` now packs with `ATLAS_PADDING = 16` (was a literal `2`). 16px
absorbs half-texel bilinear overhang at any scale AND the worst-case
devicePixelRatio rounding of a scaled frame, so a frame can never sample its
neighbour even if a future draw change creeps a pixel over its bounds.

Atlas cost: 2006x1724 → 2032x1808 (+3.2% area, still one texture under the 2048
width cap). `13-menu-dpr3-932x430.png` is the same menu at DPR 3 in phone
landscape (932x430) — no fringing on any button edge.

## 4. Tiles

`makeTileFrameSpec()` now insets the body and the shadow so that:

```
body   (0, 0, w-4, h-6)          -> right/bottom edge at w-4 / h-6
shadow (4, 6, w-4, h-6)          -> right/bottom edge at w   / h   (exactly the frame edge)
```

Tiles read 4px narrower and 6px shorter than their frame (2px/3px per side at
design scale, i.e. ~1 CSS px in the worst supported viewport), which reads as the
tile sitting *inside* its slot rather than filling it. Hit areas are unaffected —
containers set their own `setSize(width, TILE_HEIGHT)` from `theme.ts`, not from
the texture — so the 64 CSS px touch-target floor still holds.
`11-tile-shadow-before.png` / `12-tile-shadow-after.png` are the same tray tile at
4x: pre-fix the shadow's bottom-right ends in a flat cut, post-fix it follows the
corner radius.

## 5. Diff maps

`09-diff-menu.png` and `10-diff-game.png` are absolute difference images,
amplified 8x, so every changed pixel is visible. Outside the buttons and tiles the
only differences are the small rings around the header icon buttons
(`btn_sq`/`btn_sq_down` shadows, boxes at x 21..127 and x 1153..1259, y 93..115
in the Game capture) — i.e. the same two defects on the square buttons. Layout,
type, backgrounds, illustration, audio and level data are untouched: no cluster
larger than 2.1k px exists outside those bands, and the clouds/hills/wordmark are
pixel-identical.

## Files

| file | what it shows |
| --- | --- |
| `01-menu-before.png` / `02-menu-after.png` | full 1280x720 Menu, before / after |
| `03-play-corner-before.png` / `04-play-corner-after.png` | Play top-left corner, 6x |
| `05-play-bottom-before.png` / `06-play-bottom-after.png` | Play bottom shadow, 4x |
| `07-wordbook-bottom-before.png` / `08-wordbook-bottom-after.png` | Wordbook bottom shadow, 4x |
| `09-diff-menu.png` / `10-diff-game.png` | 8x amplified absolute difference |
| `11-tile-shadow-before.png` / `12-tile-shadow-after.png` | Game tray tile, 4x |
| `13-menu-dpr3-932x430.png` | phone landscape, DPR 3 |

## Gates

```
eslint .            exit 0
prettier --check .  exit 0
tsc -b              exit 0
vitest run          17 files / 366 tests passed  (was 16 / 304; +62 new)
vite build          exit 0  (dist built in 12.7s)
```

`tests/uiAtlas.regression.test.ts` replays every `FrameSpec.draw` against a
recording Graphics double and asserts the ink bounds stay inside
`[0..width] x [0..height]`, plus canaries that reproduce the pre-fix formulas and
prove the assertions fail on them (restoring the old file makes 25 of its 62
tests fail).
