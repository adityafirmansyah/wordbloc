import { describe, expect, it } from 'vitest';
import {
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  ISLAND_CENTRE_X,
  MIN_VIEWPORT_SCALE,
  WORDBOOK,
  WORDBOOK_GRID_BOTTOM,
  WORDBOOK_GRID_WIDTH,
  WORDBOOK_PER_PAGE,
  anchorX,
  stageMetrics,
  wordbookBackX,
  wordbookColumnX,
  wordbookPagerX,
  wordbookRowY,
} from '../src/game/theme';

/**
 * Regression guards for round-1 review findings B2/B3, re-pinned for the
 * full-bleed stage (defect: "on mobile the layout did not use full space").
 *
 * B2 — Wordbook overflow/tap collision. Measured live with 12 entries:
 *   row 3 cards   y 528..656
 *   pager text    y 567..593  (drawn ON TOP of the row-3 cards)
 *   Back button   y 598..726  (bottom third of row 3, and 6px past the stage)
 *   a click at (560,620) hit both the ELEPHANT card and Back -> navigated to Menu.
 *
 * B3 — Touch targets only held in landscape. These tests pin the geometry and
 * the viewport gate that make the constraint true across the viewport domain.
 *
 * NEW — horizontal anchoring. The pager arrows and Back used to be positioned
 * from the 1280 constant, so on a 2.17:1 phone stage they sat ~250 design px
 * inside the frame (and the arrows would have clipped a narrower one). They now
 * follow the LIVE stage edges; the centred panel and grid stay on the island.
 */

const MIN_CSS = 64;

/** Every acceptance viewport from the full-bleed defect report, landscape only. */
const VIEWPORTS = [
  [932, 430],
  [915, 412],
  [1280, 720],
  [1180, 820],
  [1024, 768],
] as const;

/** Card band for `rows` rows, as [top, bottom] in design px. */
function gridBand(rows = WORDBOOK.rows): [number, number] {
  return [
    WORDBOOK.gridTop,
    WORDBOOK.gridTop + rows * (WORDBOOK.card.height + WORDBOOK.gapY) - WORDBOOK.gapY,
  ];
}

describe('Wordbook geometry — regression: row 3 collided with pager and Back', () => {
  it('three rows of cards fit entirely inside the 720px island', () => {
    const [, bottom] = gridBand();
    expect(bottom).toBe(WORDBOOK_GRID_BOTTOM);
    expect(bottom).toBeLessThanOrEqual(DESIGN_HEIGHT);
  });

  it('the grid ends above the page caption (was: pager text over row 3)', () => {
    const captionTop = WORDBOOK.pagerCaptionY - 26 / 2;
    expect(captionTop).toBeGreaterThan(WORDBOOK_GRID_BOTTOM);
  });

  it('the page caption is fully inside the island', () => {
    expect(WORDBOOK.pagerCaptionY + 26 / 2).toBeLessThanOrEqual(DESIGN_HEIGHT);
  });

  it('Back lives in the header, clear of the grid and inside the stage (was: 598..726)', () => {
    const top = WORDBOOK.backButtonY - WORDBOOK.backButtonHeight / 2;
    const bottom = WORDBOOK.backButtonY + WORDBOOK.backButtonHeight / 2;
    expect(top).toBeGreaterThanOrEqual(0);
    expect(bottom).toBeLessThanOrEqual(DESIGN_HEIGHT);
    // The old defect: Back's band (598..726) intersected the row-3 cards.
    expect(bottom).toBeLessThan(WORDBOOK.gridTop);
  });

  it('pager arrows sit outside the card band horizontally (no tap conflict)', () => {
    for (const [vw, vh] of VIEWPORTS) {
      const stage = stageMetrics(vw, vh);
      const pager = wordbookPagerX(stage);
      const gridLeft = ISLAND_CENTRE_X - WORDBOOK_GRID_WIDTH / 2;
      const gridRight = ISLAND_CENTRE_X + WORDBOOK_GRID_WIDTH / 2;
      expect(pager.left + WORDBOOK.pagerButtonSize / 2, `${vw}x${vh} left`).toBeLessThanOrEqual(
        gridLeft,
      );
      expect(
        pager.right - WORDBOOK.pagerButtonSize / 2,
        `${vw}x${vh} right`,
      ).toBeGreaterThanOrEqual(gridRight);
    }
  });

  it('pager arrows stay inside the live stage on every acceptance aspect', () => {
    for (const [vw, vh] of VIEWPORTS) {
      const stage = stageMetrics(vw, vh);
      const pager = wordbookPagerX(stage);
      expect(
        pager.left - WORDBOOK.pagerButtonSize / 2,
        `${vw}x${vh} left edge`,
      ).toBeGreaterThanOrEqual(stage.left);
      expect(
        pager.right + WORDBOOK.pagerButtonSize / 2,
        `${vw}x${vh} right edge`,
      ).toBeLessThanOrEqual(stage.right);
    }
  });

  it('the Back button stays inside the live stage on every acceptance aspect', () => {
    for (const [vw, vh] of VIEWPORTS) {
      const stage = stageMetrics(vw, vh);
      const backX = wordbookBackX(stage);
      expect(backX - WORDBOOK.backButtonWidth / 2, `${vw}x${vh}`).toBeGreaterThanOrEqual(
        stage.left,
      );
      expect(backX + WORDBOOK.backButtonWidth / 2, `${vw}x${vh}`).toBeLessThanOrEqual(stage.right);
      // And the generic anchor helper agrees with the named helper.
      expect(anchorX(stage, { kind: 'left', inset: WORDBOOK.backInset })).toBe(backX);
    }
  });

  it('a card and Back can never share a point (the (560,620) defect)', () => {
    const backTop = WORDBOOK.backButtonY - WORDBOOK.backButtonHeight / 2;
    const backBottom = WORDBOOK.backButtonY + WORDBOOK.backButtonHeight / 2;

    for (let i = 0; i < WORDBOOK_PER_PAGE; i += 1) {
      const row = Math.floor(i / WORDBOOK.columns);
      const cy = wordbookRowY(row);
      const top = cy - WORDBOOK.card.height / 2;
      const bottom = cy + WORDBOOK.card.height / 2;
      // Vertical separation is what makes the overlap impossible: Back is a
      // header band (10..142) and the grid starts at 186.
      expect(top > backBottom || bottom < backTop, `card ${i} overlaps Back`).toBe(true);
      // The old defect had Back's band reach y=726, inside row 3 (528..656).
      expect(bottom < backTop || top > backBottom).toBe(true);
    }
  });

  it('every card stays inside the island horizontally', () => {
    for (let col = 0; col < WORDBOOK.columns; col += 1) {
      const cx = wordbookColumnX(col);
      expect(cx - WORDBOOK.card.width / 2).toBeGreaterThanOrEqual(0);
      expect(cx + WORDBOOK.card.width / 2).toBeLessThanOrEqual(DESIGN_WIDTH);
    }
  });

  it('rows never overlap each other', () => {
    for (let row = 1; row < WORDBOOK.rows; row += 1) {
      const prevBottom = wordbookRowY(row - 1) + WORDBOOK.card.height / 2;
      const thisTop = wordbookRowY(row) - WORDBOOK.card.height / 2;
      expect(thisTop).toBeGreaterThanOrEqual(prevBottom);
    }
  });

  it('the centred panel sits between the pager arrows and below the header', () => {
    for (const [vw, vh] of VIEWPORTS) {
      const stage = stageMetrics(vw, vh);
      const pager = wordbookPagerX(stage);
      const panelLeft = stage.centreX - WORDBOOK.panel.width / 2;
      const panelRight = stage.centreX + WORDBOOK.panel.width / 2;
      const panelTop = WORDBOOK.panel.y - WORDBOOK.panel.height / 2;
      const panelBottom = WORDBOOK.panel.y + WORDBOOK.panel.height / 2;

      expect(panelLeft, `${vw}x${vh}`).toBeGreaterThan(pager.left + WORDBOOK.pagerButtonSize / 2);
      expect(panelRight, `${vw}x${vh}`).toBeLessThan(pager.right - WORDBOOK.pagerButtonSize / 2);
      expect(panelTop).toBeGreaterThan(WORDBOOK.backButtonY + WORDBOOK.backButtonHeight / 2);
      expect(panelBottom).toBeLessThanOrEqual(DESIGN_HEIGHT);
      // And it must still enclose the whole grid.
      expect(panelLeft).toBeLessThanOrEqual(ISLAND_CENTRE_X - WORDBOOK_GRID_WIDTH / 2);
      expect(panelRight).toBeGreaterThanOrEqual(ISLAND_CENTRE_X + WORDBOOK_GRID_WIDTH / 2);
      expect(panelTop).toBeLessThanOrEqual(WORDBOOK.gridTop);
      expect(panelBottom).toBeGreaterThanOrEqual(WORDBOOK_GRID_BOTTOM);
    }
  });

  it('shows 9 cards per page (3x3), so 12 words fit on two pages without row 3 overflow', () => {
    expect(WORDBOOK_PER_PAGE).toBe(9);
    expect(WORDBOOK_PER_PAGE).toBe(WORDBOOK.columns * WORDBOOK.rows);
  });
});

describe('touch targets — regression: only landscape satisfied 64 CSS px', () => {
  it('every interactive element clears 64 CSS px at the documented worst scale', () => {
    const css = (designPx: number): number => designPx * MIN_VIEWPORT_SCALE;
    expect(css(WORDBOOK.card.height)).toBeGreaterThanOrEqual(MIN_CSS);
    expect(css(WORDBOOK.card.width)).toBeGreaterThanOrEqual(MIN_CSS);
    expect(css(WORDBOOK.backButtonHeight)).toBeGreaterThanOrEqual(MIN_CSS);
    expect(css(WORDBOOK.backButtonWidth)).toBeGreaterThanOrEqual(MIN_CSS);
    expect(css(WORDBOOK.pagerButtonSize)).toBeGreaterThanOrEqual(MIN_CSS);
  });

  it('every card, arrow and Back button clears 64 CSS px on every acceptance viewport', () => {
    for (const [vw, vh] of VIEWPORTS) {
      const { scale } = stageMetrics(vw, vh);
      expect(WORDBOOK.card.height * scale, `${vw}x${vh} card h`).toBeGreaterThanOrEqual(MIN_CSS);
      expect(WORDBOOK.card.width * scale, `${vw}x${vh} card w`).toBeGreaterThanOrEqual(MIN_CSS);
      expect(WORDBOOK.pagerButtonSize * scale, `${vw}x${vh} pager`).toBeGreaterThanOrEqual(MIN_CSS);
      expect(WORDBOOK.backButtonHeight * scale, `${vw}x${vh} back`).toBeGreaterThanOrEqual(MIN_CSS);
    }
  });

  it('portrait phones fall below the worst supported scale — hence the gate', () => {
    // Measured in a real browser before the fix: 41.4 / 37.5 / 36.0 CSS px.
    for (const [w, h] of [
      [414, 896],
      [375, 667],
      [360, 640],
    ] as const) {
      const { scale } = stageMetrics(w, h);
      expect(scale, `${w}x${h}`).toBeLessThan(MIN_VIEWPORT_SCALE);
      expect(WORDBOOK.card.height * scale, `${w}x${h} card`).toBeLessThan(MIN_CSS);
    }
  });

  it('the design floor is exactly reachable at 640x360 landscape', () => {
    expect(stageMetrics(640, 360).scale).toBe(MIN_VIEWPORT_SCALE);
    expect(WORDBOOK.card.height * MIN_VIEWPORT_SCALE).toBeGreaterThanOrEqual(MIN_CSS);
  });
});
