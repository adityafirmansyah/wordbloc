import { describe, expect, it } from 'vitest';
import {
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  ISLAND_CENTRE_X,
  MIN_TOUCH_CSS,
  MIN_VIEWPORT_SCALE,
  WORDBOOK,
  WORDBOOK_GRID_BOTTOM,
  WORDBOOK_GRID_WIDTH,
  WORDBOOK_PER_PAGE,
  WORDBOOK_SPEAKER,
  WORDBOOK_THUMB,
  WORDBOOK_CARD_TEXT,
  anchorX,
  stageMetrics,
  wordbookBackX,
  wordbookColumnX,
  wordbookPagerX,
  wordbookRowY,
  wordbookTextLeft,
  wordbookTextRight,
  wordbookTextWidth,
  wordbookThumbX,
  wordbookWordX,
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

const SPEC_CSS = 64;

/** Every acceptance viewport from the full-bleed defect report, landscape only. */
const VIEWPORTS = [
  [932, 430],
  [915, 412],
  [1280, 720],
  [1180, 820],
  [1024, 768],
  // Real phones in landscape with the browser toolbar visible (owner defect).
  [851, 299],
  [800, 275],
  [932, 320],
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

describe('Wordbook card — layout for the real illustration thumbnail', () => {
  const halfW = WORDBOOK.card.width / 2;
  const halfH = WORDBOOK.card.height / 2;

  it('the thumbnail well fits inside the card on all four sides', () => {
    const left = wordbookThumbX() - WORDBOOK_THUMB.size / 2;
    const right = wordbookThumbX() + WORDBOOK_THUMB.size / 2;
    const top = -WORDBOOK_THUMB.size / 2;
    const bottom = WORDBOOK_THUMB.size / 2;

    // A sticker touching (or crossing) a card edge would look like a mistake.
    expect(left).toBeGreaterThan(-halfW);
    expect(right).toBeLessThan(halfW);
    expect(top).toBeGreaterThan(-halfH);
    expect(bottom).toBeLessThan(halfH);

    // The well is pinned to the card's left edge by `inset`, and the same margin
    // appears above/below (16 = (128 - 96) / 2), so it reads as deliberately
    // inset rather than floating.
    expect(left - -halfW).toBeCloseTo(WORDBOOK_THUMB.inset, 6);
    expect(halfH - bottom).toBeCloseTo((WORDBOOK.card.height - WORDBOOK_THUMB.size) / 2, 6);
  });

  it('the thumbnail is square (the sticker pack is 512x512)', () => {
    // The pack is uniformly square, so a square well needs no cropping logic.
    expect(WORDBOOK_THUMB.size).toBeGreaterThan(0);
    expect(WORDBOOK_THUMB.size).toBeLessThanOrEqual(
      WORDBOOK.card.height - 2 * WORDBOOK_THUMB.inset,
    );
  });

  it('the text column is bounded by the thumbnail on the left and the speaker on the right', () => {
    // The whole point: the right bound is DEFINED from the speaker, so text can
    // never overlap the replay button no matter how long the word is.
    expect(wordbookTextLeft()).toBeCloseTo(wordbookThumbX() + WORDBOOK_THUMB.size / 2, 6);
    expect(wordbookTextRight()).toBeCloseTo(WORDBOOK_SPEAKER.x - WORDBOOK_SPEAKER.radius - 8, 6);
    expect(wordbookTextWidth()).toBeGreaterThan(100);
    expect(wordbookTextWidth()).toBeLessThanOrEqual(WORDBOOK.card.width - WORDBOOK_THUMB.size);
  });

  it('the word label is centred in the text column', () => {
    const expected = (wordbookTextLeft() + wordbookTextRight()) / 2;
    expect(wordbookWordX()).toBeCloseTo(expected, 6);
    // ...and the column itself sits inside the card.
    expect(wordbookTextLeft()).toBeGreaterThan(-halfW);
    expect(wordbookTextRight()).toBeLessThan(halfW);
  });

  it('the replay speaker sits inside the card', () => {
    const { x, y, radius } = WORDBOOK_SPEAKER;
    expect(x + radius).toBeLessThanOrEqual(halfW);
    expect(x - radius).toBeGreaterThan(-halfW);
    expect(y + radius).toBeLessThanOrEqual(halfH);
    expect(y - radius).toBeGreaterThan(-halfH);
    // Bottom-right corner: below the card's midline, right of the text column.
    expect(y).toBeGreaterThan(0);
    expect(x).toBeGreaterThan(wordbookTextRight());
  });

  it('a 9-letter word cannot reach the speaker icon', () => {
    // "butterfly" is the longest real display (9 chars). The label is wrapped to
    // the column width, and the column right edge stops 8px short of the speaker
    // circle, so the clearance is structural — not a glyph-width estimate.
    expect(wordbookTextWidth()).toBeGreaterThanOrEqual(9 * 8);
    expect(wordbookTextRight()).toBeLessThan(WORDBOOK_SPEAKER.x - WORDBOOK_SPEAKER.radius);
  });

  it('the word and meta rows never overlap, and the word clears the speaker vertically', () => {
    const { wordY, metaY } = WORDBOOK_CARD_TEXT;
    // 32px bold word bottom vs 15px meta top.
    expect(wordY + 32 / 2).toBeLessThan(metaY - 15 / 2);
    // The meta row shares the speaker's row vertically, so its right edge (the
    // column bound) is what keeps them apart.
    expect(metaY + 15 / 2).toBeLessThanOrEqual(halfH);
    expect(WORDBOOK_SPEAKER.y - WORDBOOK_SPEAKER.radius).toBeLessThan(metaY + 15 / 2);
  });

  it('the speaker never overlaps the thumbnail well', () => {
    const wellRight = wordbookThumbX() + WORDBOOK_THUMB.size / 2;
    expect(WORDBOOK_SPEAKER.x - WORDBOOK_SPEAKER.radius).toBeGreaterThan(wellRight);
  });
});

describe('touch targets — regression: only landscape satisfied 64 CSS px', () => {
  it('every interactive element clears the 64 CSS px spec floor at scale 0.5', () => {
    const specCss = (designPx: number): number => designPx * 0.5;
    expect(specCss(WORDBOOK.card.height)).toBeGreaterThanOrEqual(SPEC_CSS);
    expect(specCss(WORDBOOK.card.width)).toBeGreaterThanOrEqual(SPEC_CSS);
    expect(specCss(WORDBOOK.backButtonHeight)).toBeGreaterThanOrEqual(SPEC_CSS);
    expect(specCss(WORDBOOK.backButtonWidth)).toBeGreaterThanOrEqual(SPEC_CSS);
    expect(specCss(WORDBOOK.pagerButtonSize)).toBeGreaterThanOrEqual(SPEC_CSS);
  });

  it('every interactive element still clears 44 CSS px at the 0.36 floor', () => {
    // The floor a real phone in landscape can reach (vh >= 260 CSS px). 44 is the
    // WCAG 2.5.5 / Android Material minimum, and the gate blocks below it.
    const floorCss = (designPx: number): number => designPx * MIN_VIEWPORT_SCALE;
    expect(floorCss(WORDBOOK.card.height)).toBeGreaterThanOrEqual(MIN_TOUCH_CSS);
    expect(floorCss(WORDBOOK.card.width)).toBeGreaterThanOrEqual(MIN_TOUCH_CSS);
    expect(floorCss(WORDBOOK.backButtonHeight)).toBeGreaterThanOrEqual(MIN_TOUCH_CSS);
    expect(floorCss(WORDBOOK.backButtonWidth)).toBeGreaterThanOrEqual(MIN_TOUCH_CSS);
    expect(floorCss(WORDBOOK.pagerButtonSize)).toBeGreaterThanOrEqual(MIN_TOUCH_CSS);
    // 128 * 0.36 = 46.08 CSS px — the card's tightest axis.
    expect(floorCss(WORDBOOK.card.height)).toBeCloseTo(46.08, 2);
  });

  it('every card, arrow and Back button clears 44 CSS px on every playable viewport', () => {
    for (const [vw, vh] of VIEWPORTS) {
      const { scale } = stageMetrics(vw, vh);
      expect(scale, `${vw}x${vh} is gated`).toBeGreaterThanOrEqual(MIN_VIEWPORT_SCALE);
      expect(WORDBOOK.card.height * scale, `${vw}x${vh} card h`).toBeGreaterThanOrEqual(
        MIN_TOUCH_CSS,
      );
      expect(WORDBOOK.card.width * scale, `${vw}x${vh} card w`).toBeGreaterThanOrEqual(
        MIN_TOUCH_CSS,
      );
      expect(WORDBOOK.pagerButtonSize * scale, `${vw}x${vh} pager`).toBeGreaterThanOrEqual(
        MIN_TOUCH_CSS,
      );
      expect(WORDBOOK.backButtonHeight * scale, `${vw}x${vh} back`).toBeGreaterThanOrEqual(
        MIN_TOUCH_CSS,
      );
    }
  });

  it('portrait phones reach supported scale and clear touch targets under dual-orientation mode', () => {
    // Under dual-orientation portrait base (720x1280), scale is >= 0.5 and cards clear touch target floors
    for (const [w, h] of [
      [414, 896],
      [375, 667],
      [360, 640],
    ] as const) {
      const { scale } = stageMetrics(w, h);
      expect(scale, `${w}x${h}`).toBeGreaterThanOrEqual(MIN_VIEWPORT_SCALE);
      expect(WORDBOOK.card.height * scale, `${w}x${h} card`).toBeGreaterThanOrEqual(MIN_TOUCH_CSS);
    }
  });

  it('the floor is exactly reachable on a real phone landscape viewport', () => {
    // 851x299 (owner's phone, Chrome toolbar visible) sits comfortably inside.
    expect(stageMetrics(851, 299).scale).toBeGreaterThan(MIN_VIEWPORT_SCALE);
    expect(WORDBOOK.card.height * stageMetrics(851, 299).scale).toBeGreaterThanOrEqual(
      MIN_TOUCH_CSS,
    );
    // And at exactly the floor the tightest target is still above 44 CSS px.
    expect(WORDBOOK.card.height * MIN_VIEWPORT_SCALE).toBeGreaterThanOrEqual(MIN_TOUCH_CSS);
  });
});
