# Redesign Portrait Wordbook: 1-Column Wide Flashcards — Evidence

Task: `t_d293bf4b` · Producer: eng-frontend · Date: 2026-10-28  
Branch: `feat/wordbook-card-redesign` · Build verified: production bundle (`vite preview`, port 4220)

## Problem & Root Cause

The initial portrait Wordbook layout used a 2-column x 4-row grid (8 cards per page). On mobile portrait viewports (design space 720x1280), squeezing two columns resulted in cards of width 292px:
1. **Thumbnail Art Squeezed:** Sticker thumbnail well was restricted to 96px (in CSS on mobile it rendered at ~48–52 CSS px), diminishing the visual impact of the 512x512 WebP sticker illustrations.
2. **Cramped Typography:** Long words were squeezed, and the category metadata label (`Tier 1 · animals`) was rendered at 15px with low legibility.
3. **Small Touch Targets:** The speaker replay button was squeezed down to radius 22px (~20 CSS px on phone), making it difficult for children to tap.

## Redesign Solution: 1-Column Wide Flashcard Layout

We redesigned mobile portrait Wordbook into single-column wide flashcards that take full advantage of the horizontal width:

### 1. Geometry & Constants (`src/game/theme.ts`)
- **Grid & Pagination:**
  - `PORTRAIT_WORDBOOK.columns`: 1 (single column of wide flashcards).
  - `PORTRAIT_WORDBOOK.rows`: 4 (4 flashcards per page; 30 manifest words = 8 pages).
  - `PORTRAIT_WORDBOOK_PER_PAGE`: 4.
  - `PORTRAIT_WORDBOOK.gridTop`: 290, `gapY`: 16.
  - `PORTRAIT_WORDBOOK.panel`: `{ y: 620, width: 660, height: 740 }` enclosing the flashcards with balanced 20px padding.
  - `PORTRAIT_WORDBOOK.pagerY`: 1040, `pagerCaptionY`: 1040, `pagerInset`: 70, `pagerButtonSize`: 110.
  - `PORTRAIT_WORDBOOK.backInset`: 80, `backButtonY`: 76, `backButtonWidth`: 160, `backButtonHeight`: 110.

- **Wide Flashcard Card Metrics:**
  - `PORTRAIT_WORDBOOK.card`: `{ width: 620, height: 148 }` (centered horizontally at design x=360).
  - `PORTRAIT_WORDBOOK_THUMB`: `{ size: 124, inset: 12 }` (generous 124x124 well showcasing the 512x512 WebP sticker in high resolution, art size 116x116).
  - `PORTRAIT_WORDBOOK_SPEAKER`: `{ x: 620 / 2 - 45 = 265, y: 0, radius: 32, size: 64 }` (large 64x64 design px touch target vertically centered on the right edge).
  - `PORTRAIT_WORDBOOK_TEXT`:
    - Word title: font size 38px bold (`#21324a`), vertically centered at `y = -18`.
    - Category label: font size 20px (`#54708c`), vertically centered at `y = 22`.
    - Ample text column width ~360px (`wordbookTextWidth(true)` = 399px) between thumbnail right edge (-174) and speaker left edge (233).
    - Clear vertical separation between word bottom and meta top prevents any overlap.

- **Orientation Switching Helpers:**
  - `wordbookCardSize(isPortrait)`: Returns `{ width: 620, height: 148 }` in portrait, `{ width: 292, height: 128 }` in landscape.
  - `wordbookThumbX(isPortrait)`: Negative card-relative center (-236 in portrait, -86 in landscape).
  - `wordbookSpeaker(isPortrait)`: Returns orientation-specific speaker metrics (radius 32, size 64 at y=0 in portrait; radius 22, size 44 at bottom-right in landscape).
  - `wordbookTextWidth(isPortrait)`: Full clearance of speaker circle and thumbnail well.
  - `wordbookWordX(isPortrait)`: Card-relative word center.

- **Landscape Preservation:**
  - Landscape layout (3x3 grid, 9 cards per page, 980px panel) remains 100% intact and untouched.

### 2. Scene Implementation (`src/scenes/WordbookScene.ts` & `src/ui/stage.ts`)
- `drawCard()`:
  - Dynamically draws cards using orientation-aware metrics for card size, thumbnail well, typography, and speaker button.
  - Hit area spans the entire 620x148 wide card with tactile press bounce (`scale: 0.96`), and speaker icon bounces on tap (`scale: 0.62`).
- `repositionElements()`:
  - Updates anchors dynamically on orientation change or screen resize via `StageLayout.setAnchor()`.
  - Re-renders pages with updated perPage count (4 in portrait, 9 in landscape).

---

## Evidence Screenshots

Captured from production build (`vite preview`) via headless Chrome under device emulation:

| File | Viewport | Screen | Description |
|---|---|---|---|
| `01-wordbook-portrait-393x851-page1.png` | 393x851 | Wordbook (Page 1) | 4 wide flashcards (`cat`, `dog`, `sun`, `bed`) with large 124px thumbnails, bold 38px titles, 20px metadata, and 64px speaker buttons |
| `02-wordbook-portrait-393x851-page2.png` | 393x851 | Wordbook (Page 2) | Second page with `pig`, `cup`, `hat`, `map` showing consistent alignment and layout |
| `03-wordbook-portrait-393x851-page3.png` | 393x851 | Wordbook (Page 3) | Long words page (`butterfly`, `elephant`, `sunflower`, `pancake`) demonstrating ample width, zero clipping, and clean margins |
| `04-wordbook-portrait-412x915.png` | 412x915 | Wordbook (Page 1) | Verification on modern Android viewport (Pixel 8 / Galaxy S24) |
| `05-wordbook-landscape-851x299.png` | 851x299 | Wordbook (Landscape) | Reference comparison confirming 3x3 landscape layout remains 100% intact |

---

## Verification & Quality Gates

All automated tests and linters pass cleanly:
- `npm run lint` (`eslint .`): exit 0 (no errors, no warnings)
- `npm run format:check` (`prettier --check .`): exit 0 (all matched files use Prettier code style)
- `npm run test` (`vitest run`): 19 test files passed, 449 tests passed
- `npm run build` (`tsc -b && vite build`): exit 0 (clean production build)
