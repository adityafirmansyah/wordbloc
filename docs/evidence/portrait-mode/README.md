# Vertical / Portrait View Mode (Dual-Orientation Adaptive Layout) — Evidence

Task: `t_7e2e7627` · Producer: eng-frontend · Date: 2026-10-28  
Branch: `feat/portrait-adaptive-layout` · Build verified: production bundle (`vite preview`, port 4210)

## Overview & Architecture

This feature enables WordBloc to be played natively in vertical (portrait) orientation on mobile phones, removing the forced "Turn your device sideways" rotation requirement. Players can hold their phone upright with one hand and enjoy the full game loop.

### 1. Dual-Orientation Stage Metrics (`src/game/theme.ts`)
- **Orientation Detection:** `isPortrait = vh > vw`.
- **Landscape (`vw >= vh`):** Design base 1280x720, content island centered at (640, 360).
- **Portrait (`vh > vw`):** Design base 720x1280, content island centered at (360, 640).
- **Stage Scaling:** `scale = min(vw / baseWidth, vh / baseHeight)`. Under typical phone portrait (e.g. 393x851 or 412x915 CSS px), scale is ~0.546–0.572.
- **Touch Targets:** At scale ~0.55, controls are large and kid-friendly:
  - Letter tiles (128x144 design px) render at ~70x78.6 CSS px (well above the 44 CSS px WCAG / 64 CSS px spec floor).
  - Primary buttons (340x128 design px) render at ~185x70 CSS px.
  - Header buttons (128x128 design px) render at ~70x70 CSS px.
- **Viewport Gate (`viewportFit`):**
  - Removed unconditional `rotate` gate when `vh > vw`. Both portrait and landscape are first-class playable orientations.
  - Returns `notice: 'none'` whenever scale is above `MIN_VIEWPORT_SCALE = 0.36`.
  - Returns `notice: 'too-small'` only when dimensions are below the playable threshold.

### 2. Adaptive Scene Layouts

- **`MenuScene` (`src/scenes/MenuScene.ts`):**
  - In Portrait: Vertically stacked title ("WORDBLOC"), subtitle ("Build words, open worlds."), Play button, and Wordbook button.
  - 5 decorative floating letter tiles ("W", "B", "L", "O", "C") spaced across the 720px width above the bottom hills.
  - Edge buttons (speaker toggle, star count) dynamically positioned with safe insets.

- **`GameScene` (`src/scenes/GameScene.ts`):**
  - Header at top (y ~ 80): Home (left), Speaker (right), Level text centered.
  - Art illustration badge: Large and prominent in upper half (y ~ 330, 300x300px badge with category halo).
  - Prompt / hint / mechanic text at y ~ 510–550.
  - Target Slots (y ~ 680):
    - Words with <= 5 units: 1 centered row.
    - Words with > 5 units (e.g. 8-letter words like ELEPHANT): wrap into 2 rows (row 0 at y=630, row 1 at y=770).
  - Tile Tray (y ~ 1040): In portrait, tiles wrap into 2 rows in the thumb zone (max width 680px) for comfortable one-handed reach.

- **`RewardScene` (`src/scenes/RewardScene.ts`):**
  - Portrait backdrop panel (660x780 design px) centered at y=520.
  - Star award & "+1 Star" text centered in the upper section (y=260).
  - Congratulatory text and completed word readout in middle section (y=390–460).
  - Large primary Next button at y=640.
  - Replay and Wordbook buttons side-by-side below at y=800.

- **`WordbookScene` (`src/scenes/WordbookScene.ts`):**
  - Grid adapts to 2 columns x 4 rows = 8 cards per page with comfortable margins.
  - Responsive header with Back button and Home button.
  - Progress pill and pager arrows centered and reachable.

- **Orientation Change / Resize Handling:**
  - All scenes listen to `StageLayout.onStageChange(stage)` and reposition elements cleanly without recreating DOM/canvas objects or duplicating UI elements.

---

## Evidence Screenshots

Captured from the production build running under Chrome via CDP emulation:

| File | Viewport | Scene | Description |
|---|---|---|---|
| `01-menu-portrait-393x851.png` | 393x851 | Menu | Title screen in portrait on Pixel 8 (stacked buttons, floating tiles) |
| `01-menu-portrait-412x915.png` | 412x915 | Menu | Title screen in portrait on modern Android |
| `02-game-portrait-393x851.png` | 393x851 | Game (Lvl 1 CAT) | Gameplay with prominent 300px art badge, 3 slots, 1-row tray |
| `02-game-portrait-412x915.png` | 412x915 | Game (Lvl 1 CAT) | Gameplay on 412x915 portrait viewport |
| `03-game-long-word-portrait.png` | 393x851 | Game (Lvl 20 ELEPHANT) | 8-letter puzzle with slots wrapped into 2 rows and tiles wrapped in thumb zone |
| `03-game-long-word-portrait-412x915.png` | 412x915 | Game (Lvl 20 ELEPHANT) | 8-letter puzzle on 412x915 portrait viewport |
| `04-reward-portrait-393x851.png` | 393x851 | Reward | Star reward screen with vertical layout and clear action hierarchy |
| `04-reward-portrait-412x915.png` | 412x915 | Reward | Star reward screen on 412x915 portrait viewport |
| `05-wordbook-portrait-393x851.png` | 393x851 | Wordbook | 2-column x 4-row grid with unlocked card thumbnails and pager |
| `05-wordbook-portrait-412x915.png` | 412x915 | Wordbook | 2-column x 4-row grid on 412x915 portrait viewport |
| `06-wordbook-landscape-851x299.png` | 851x299 | Wordbook | Reference comparison verifying landscape layout remains intact |

---

## Test Verification

All automated test suites and quality gates pass:

1. **Vitest Unit & Regression Tests:**
   - `tests/theme.test.ts`: Portrait design space (720x1280), portrait bands, portrait stage metrics, portrait touch targets (> 64 CSS px at scale ~0.55), and portrait viewportFit.
   - `tests/stage.test.ts`: Portrait stage metrics, full-bleed aspect ratios, island centering at (360, 640), and anchorX rules.
   - `tests/viewportGate.test.ts`: Portrait phones accepted without rotation notice; too-small viewports gated.
   - `tests/wordbookLayout.regression.test.ts`: Wordbook card layout constraints preserved.
   - **Result:** 19/19 test files passed, 438/438 tests passing.

2. **Code Quality Gates:**
   - ESLint: `./node_modules/.bin/eslint .` -> Clean (0 errors, 0 warnings).
   - Prettier: `./node_modules/.bin/prettier --check .` -> Clean.
   - TypeScript: `npm run typecheck` (`tsc -b`) -> Clean.
   - Production Build: `npm run build` -> Clean bundle generated in `dist/`.
