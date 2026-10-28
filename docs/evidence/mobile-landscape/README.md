# Mobile Landscape Viewport Gate Evidence (vh >= 260px)

Task: `t_5434e28f` · Producer: eng-frontend · Date: 2026-10-28
Branch: `fix/mobile-landscape-viewport` · Verified on real production build (`vite build` + `vite preview` on port 2434) and baseline (`main` @ `3c890e7` on port 2435).

## Problem & Root Cause

Owner Defect Report:
When opening WordBloc on an Android phone (Chrome mobile in landscape, 2340x1080 screen with DPR=2.75), the viewport gate blocked the game and displayed:
> "Window too small. Make the window at least 360px tall (or 640px wide on a squarer screen) so the letter tiles stay big enough to tap."

Root cause:
1. Physical phone screen in portrait is ~393 CSS px wide. When rotated to landscape, total height is 393 CSS px.
2. In Chrome mobile, browser chrome takes ~94 CSS px (Android Status Bar ~24px + Chrome URL Omnibox ~56px + gesture nav bar ~14px).
3. The remaining visible web viewport height (`window.innerHeight`) is only ~299 CSS px (on smaller 360px phones, it's ~265–275px).
4. `src/game/theme.ts` had `MIN_VIEWPORT_SCALE = 0.5`, requiring `innerHeight >= 360 CSS px`.
5. As a result, EVERY real mobile phone in landscape with the browser address bar visible was gated!

## The Fix

1. **Lowered `MIN_VIEWPORT_SCALE` to `0.36`** (`src/game/theme.ts`):
   - Corresponds to `vh >= 260 CSS px` floor.
   - At `scale = 0.36` (e.g. 851x299 viewport with scale = 0.415, and 260px floor with scale = 0.36):
     - Slot height: `144 * 0.36 = 51.8 CSS px` (clears Android Material 48px).
     - 1-letter tile: `128 * 0.36 = 46.1 CSS px` (clears WCAG AA 44px standard).
     - Multi-letter tile: `162 * 0.36 = 58.3 CSS px`.
     - Primary buttons: `128 * 0.36 = 46.1 CSS px` (height), `340 * 0.36 = 122.4 CSS px` (width).
     - Header buttons: `128 * 0.36 = 46.1 CSS px`.
2. **Updated Viewport Gate Copy & Fullscreen Action** (`src/ui/viewportGate.ts`, `src/ui/fullscreen.ts`, `index.html`):
   - Notice copy for `too-small` updated to:
     `Make the window at least 260px tall so the letter tiles stay big enough to tap.`
   - Added an optional Fullscreen button affordance (`#viewport-notice-fullscreen`) to the viewport gate overlay: on Android phones, tapping "Go fullscreen" hides the Chrome URL bar and expands the viewport back to ~393 CSS px. Automatically hidden where the Fullscreen API is unsupported (e.g. iPhone Safari).
3. **Updated Test Suites**:
   - `tests/theme.test.ts`: verified touch targets at `0.5` (spec 64px) and at `MIN_VIEWPORT_SCALE = 0.36` (clearing 44px WCAG AA touch floor).
   - `tests/stage.test.ts`: verified scale floor arithmetic for `MIN_VIEWPORT_SCALE = 0.36` (`vh >= 259.2`).
   - `tests/layout.regression.test.ts`: updated touch target tests.
   - `tests/viewportGate.test.ts`: verified real mobile landscape viewports:
     - `851 x 299` (FHD+ landscape phone with Chrome toolbar) -> notice `'none'`
     - `800 x 275` (budget phone with toolbar) -> notice `'none'`
     - `932 x 320` (iPhone Pro Max landscape with Safari toolbar) -> notice `'none'`
     - `780 x 265` (360px phone landscape with toolbar) -> notice `'none'`
     - `412 x 892` (portrait phone) -> notice `'rotate'`
     - `300 x 200` (tiny window) -> notice `'too-small'`
   - `tests/wordbookLayout.regression.test.ts`: touch target assertions aligned to `MIN_VIEWPORT_SCALE = 0.36`.

## Captured Browser Evidence (851x299, DPR 2.75)

| Filename | Description | Status |
| --- | --- | --- |
| `00-before-gate-851x299.png` | Baseline (`main` @ `3c890e7`) on port 2435: blocked by "Window too small" gate | Repro Confirmed |
| `01-menu-851x299.png` | Fixed build on port 2434: Menu scene renders clean, 0 clipping, wordmark + Play + Wordbook centered | Pass |
| `02-game-851x299.png` | Fixed build: Game scene (CAT), header buttons, sticker illustration, 3 slots + 3 tray tiles visible & separated | Pass |
| `03-reward-851x299.png` | Fixed build: Reward scene, Nice work modal, star, Next + Replay + Wordbook buttons cleanly aligned | Pass |
| `04-wordbook-851x299.png` | Fixed build: Wordbook scene, 3x3 grid of cards with stickers, side pager arrows, Back button in header | Pass |
