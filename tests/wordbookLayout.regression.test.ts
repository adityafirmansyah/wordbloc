import { describe, expect, it } from 'vitest';
import {
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  MIN_VIEWPORT_SCALE,
  WORDBOOK,
  WORDBOOK_GRID_BOTTOM,
  WORDBOOK_GRID_WIDTH,
  WORDBOOK_PER_PAGE,
  wordbookColumnX,
  wordbookRowY,
} from '../src/game/theme';

/**
 * Regression guards for round-1 review findings B2 and B3.
 *
 * B2 — Wordbook overflow/tap collision. Measured live with 12 entries:
 *   row 3 cards   y 528..656
 *   pager text    y 567..593  (drawn ON TOP of the row-3 cards)
 *   Back button   y 598..726  (bottom third of row 3, and 6px past the stage)
 *   a click at (560,620) hit both the ELEPHANT card and Back -> navigated to Menu.
 * The 7-word evidence screenshot only ever showed two rows, so it hid the bug.
 *
 * B3 — Touch targets only held in landscape (36.0..41.4 CSS px in portrait).
 * These tests pin the geometry and the viewport gate that make the constraint
 * true across the whole viewport domain.
 */

const MIN_CSS = 64;

/** Card band for `rows` rows, as [top, bottom] in design px. */
function gridBand(rows = WORDBOOK.rows): [number, number] {
  return [
    WORDBOOK.gridTop,
    WORDBOOK.gridTop + rows * (WORDBOOK.card.height + WORDBOOK.gapY) - WORDBOOK.gapY,
  ];
}

describe('Wordbook geometry — regression: row 3 collided with pager and Back', () => {
  it('three rows of cards fit entirely inside the 720px stage', () => {
    const [, bottom] = gridBand();
    expect(bottom).toBe(WORDBOOK_GRID_BOTTOM);
    expect(bottom).toBeLessThanOrEqual(DESIGN_HEIGHT);
  });

  it('the grid ends above the page caption (was: pager text over row 3)', () => {
    const captionTop = WORDBOOK.pagerCaptionY - 26 / 2;
    expect(captionTop).toBeGreaterThan(WORDBOOK_GRID_BOTTOM);
  });

  it('the page caption is fully inside the stage', () => {
    expect(WORDBOOK.pagerCaptionY + 26 / 2).toBeLessThanOrEqual(DESIGN_HEIGHT);
  });

  it('Back lives in the header, clear of the grid and inside the stage (was: 598..726)', () => {
    const { backButton } = WORDBOOK;
    const top = backButton.y - backButton.height / 2;
    const bottom = backButton.y + backButton.height / 2;
    expect(top).toBeGreaterThanOrEqual(0);
    expect(bottom).toBeLessThanOrEqual(DESIGN_HEIGHT);
    // The old defect: Back's band (598..726) intersected the row-3 cards.
    expect(bottom).toBeLessThan(WORDBOOK.gridTop);
  });

  it('pager arrows sit outside the card band horizontally (no tap conflict)', () => {
    const halfGrid = WORDBOOK_GRID_WIDTH / 2;
    const gridLeft = DESIGN_WIDTH / 2 - halfGrid;
    const gridRight = DESIGN_WIDTH / 2 + halfGrid;
    const leftRight = WORDBOOK.pagerX.left + WORDBOOK.pagerButtonSize / 2;
    const rightLeft = WORDBOOK.pagerX.right - WORDBOOK.pagerButtonSize / 2;
    expect(leftRight).toBeLessThanOrEqual(gridLeft);
    expect(rightLeft).toBeGreaterThanOrEqual(gridRight);
  });

  it('pager arrows stay inside the stage', () => {
    expect(WORDBOOK.pagerX.left - WORDBOOK.pagerButtonSize / 2).toBeGreaterThanOrEqual(0);
    expect(WORDBOOK.pagerX.right + WORDBOOK.pagerButtonSize / 2).toBeLessThanOrEqual(DESIGN_WIDTH);
  });

  it('a card and Back can never share a point (the (560,620) defect)', () => {
    // Walk every card centre's box on a full page and assert Back's rect misses it.
    const { backButton } = WORDBOOK;
    const backLeft = backButton.x - backButton.width / 2;
    const backRight = backButton.x + backButton.width / 2;
    const backTop = backButton.y - backButton.height / 2;
    const backBottom = backButton.y + backButton.height / 2;

    for (let i = 0; i < WORDBOOK_PER_PAGE; i += 1) {
      const col = i % WORDBOOK.columns;
      const row = Math.floor(i / WORDBOOK.columns);
      const cx = wordbookColumnX(col);
      const cy = wordbookRowY(row);
      const left = cx - WORDBOOK.card.width / 2;
      const right = cx + WORDBOOK.card.width / 2;
      const top = cy - WORDBOOK.card.height / 2;
      const bottom = cy + WORDBOOK.card.height / 2;
      const overlaps = left < backRight && right > backLeft && top < backBottom && bottom > backTop;
      expect(overlaps, `card ${i} overlaps Back`).toBe(false);
    }
  });

  it('every card stays inside the stage horizontally', () => {
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

  it('the backdrop panel sits between the pager arrows and below the header', () => {
    // Round-2 visual check: the arrows straddled the panel's rounded edge and the
    // Back button crossed its top-left corner.
    const panelLeft = WORDBOOK.panel.x - WORDBOOK.panel.width / 2;
    const panelRight = WORDBOOK.panel.x + WORDBOOK.panel.width / 2;
    const panelTop = WORDBOOK.panel.y - WORDBOOK.panel.height / 2;
    const panelBottom = WORDBOOK.panel.y + WORDBOOK.panel.height / 2;
    expect(panelLeft).toBeGreaterThan(WORDBOOK.pagerX.left + WORDBOOK.pagerButtonSize / 2);
    expect(panelRight).toBeLessThan(WORDBOOK.pagerX.right - WORDBOOK.pagerButtonSize / 2);
    expect(panelTop).toBeGreaterThan(WORDBOOK.backButton.y + WORDBOOK.backButton.height / 2);
    expect(panelBottom).toBeLessThanOrEqual(DESIGN_HEIGHT);
    // And it must still enclose the whole grid.
    expect(panelLeft).toBeLessThanOrEqual(DESIGN_WIDTH / 2 - WORDBOOK_GRID_WIDTH / 2);
    expect(panelRight).toBeGreaterThanOrEqual(DESIGN_WIDTH / 2 + WORDBOOK_GRID_WIDTH / 2);
    expect(panelTop).toBeLessThanOrEqual(WORDBOOK.gridTop);
    expect(panelBottom).toBeGreaterThanOrEqual(WORDBOOK_GRID_BOTTOM);
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
    expect(css(WORDBOOK.backButton.height)).toBeGreaterThanOrEqual(MIN_CSS);
    expect(css(WORDBOOK.backButton.width)).toBeGreaterThanOrEqual(MIN_CSS);
    expect(css(WORDBOOK.pagerButtonSize)).toBeGreaterThanOrEqual(MIN_CSS);
  });

  it('portrait phones fall below the worst supported scale — hence the gate', () => {
    // Measured in a real browser before the fix: 41.4 / 37.5 / 36.0 CSS px.
    for (const [w, h] of [
      [414, 896],
      [375, 667],
      [360, 640],
    ] as const) {
      const scale = Math.min(w / DESIGN_WIDTH, h / DESIGN_HEIGHT);
      expect(scale, `${w}x${h}`).toBeLessThan(MIN_VIEWPORT_SCALE);
      expect(WORDBOOK.card.height * scale, `${w}x${h} card`).toBeLessThan(MIN_CSS);
    }
  });

  it('the design floor is exactly reachable at 640x360 landscape', () => {
    expect(Math.min(640 / DESIGN_WIDTH, 360 / DESIGN_HEIGHT)).toBe(MIN_VIEWPORT_SCALE);
    expect(WORDBOOK.card.height * MIN_VIEWPORT_SCALE).toBeGreaterThanOrEqual(MIN_CSS);
  });
});
