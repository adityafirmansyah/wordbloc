import { beforeAll, describe, expect, it } from 'vitest';
import { levelManifest, loadLevel } from '../src/game/levels';
import type { Level } from '../src/game/levelTypes';
import { computeSceneLayout } from '../src/game/gameLayout';
import { tileFontSize, tileWidth } from '../src/game/theme';

/**
 * Regression guards for GameScene slot & tray collision on multi-word phrase levels.
 *
 * Verifies:
 * 1. Proportional phrase width computation so 10-char phrases occupy ~240-260px rather than 400px.
 * 2. Dynamic font scaling across character length tiers (1-4, 5-7, 8-12, >12).
 * 3. Guaranteed clearance between slots and tray (max slot bottom < min tile top - 16, <= -24)
 *    across ALL 45 levels in BOTH portrait and landscape.
 * 4. Zero overlap between slots, tiles, prompt text (mechanic & hint), and art badges across all levels.
 * 5. Multi-row landscape fallback behavior when tray wraps into 2 rows.
 */

let levels: Level[];

beforeAll(async () => {
  const ids = levelManifest().levels.map((entry) => entry.id);
  levels = await Promise.all(ids.map((id) => loadLevel(id)));
});

describe('phrase tile width & dynamic font scaling', () => {
  it('10-character phrases occupy ~240-260px rather than 400px', () => {
    const sliceOf = tileWidth('A SLICE OF');
    const pieceOf = tileWidth('A PIECE OF');
    const television = tileWidth('TELEVISION');

    expect(sliceOf).toBeGreaterThanOrEqual(240);
    expect(sliceOf).toBeLessThanOrEqual(260);
    expect(sliceOf).toBe(256);

    expect(pieceOf).toBe(256);
    expect(television).toBe(256);
  });

  it('scales tile label font size dynamically based on unit character length', () => {
    // 1-4 chars: 56px - 58px
    expect(tileFontSize('A')).toBeGreaterThanOrEqual(56);
    expect(tileFontSize('A')).toBeLessThanOrEqual(58);
    expect(tileFontSize('CAT')).toBe(58);
    expect(tileFontSize('FISH')).toBe(58);

    // 5-7 chars: 44px - 48px
    expect(tileFontSize('PIZZA')).toBeGreaterThanOrEqual(44);
    expect(tileFontSize('PIZZA')).toBeLessThanOrEqual(48);
    expect(tileFontSize('FLOWER')).toBe(46);
    expect(tileFontSize('FLOWERS')).toBe(46);

    // 8-12 chars: 32px - 36px
    expect(tileFontSize('A CUP OF')).toBeGreaterThanOrEqual(32);
    expect(tileFontSize('A CUP OF')).toBeLessThanOrEqual(36);
    expect(tileFontSize('A SLICE OF')).toBe(34);
    expect(tileFontSize('TELEVISION')).toBe(34);

    // >12 chars: 26px - 28px
    expect(tileFontSize('BRUSH YOUR TEETH')).toBeGreaterThanOrEqual(26);
    expect(tileFontSize('BRUSH YOUR TEETH')).toBeLessThanOrEqual(28);
    expect(tileFontSize('BRUSH YOUR TEETH')).toBe(28);
  });
});

describe('level 31 ("A SLICE OF PIZZA") layout regression', () => {
  it('tray fits in a single row in landscape with compact phrase widths', () => {
    const lvl31 = levels.find((l) => l.id === 'lvl_0031');
    expect(lvl31).toBeDefined();
    if (!lvl31) return;

    const layout = computeSceneLayout(lvl31, false, 640);
    expect(layout.trayRowsCount).toBe(1);

    const maxSlotBottom = layout.slotBounds.bottom;
    const minTileTop = layout.trayBounds.top;

    // Guaranteed clearance >= 24px (and < -16px)
    expect(minTileTop - maxSlotBottom).toBeGreaterThanOrEqual(24);
    expect(maxSlotBottom).toBeLessThan(minTileTop - 16);
  });
});

describe('all 45 levels layout regression (both portrait and landscape)', () => {
  it('guarantees max(slot.bottom) < min(tile.top) - 16 across all 45 levels in landscape', () => {
    expect(levels).toHaveLength(45);

    for (const level of levels) {
      const layout = computeSceneLayout(level, false, 640);
      const maxSlotBottom = layout.slotBounds.bottom;
      const minTileTop = layout.trayBounds.top;

      expect(
        maxSlotBottom,
        `Level ${level.id} (${level.word}) landscape slot bottom exceeds tray top - 16`,
      ).toBeLessThan(minTileTop - 16);

      // Enforce the strict 24px clearance contract
      expect(
        minTileTop - maxSlotBottom,
        `Level ${level.id} (${level.word}) landscape clearance < 24px`,
      ).toBeGreaterThanOrEqual(24);
    }
  });

  it('guarantees max(slot.bottom) < min(tile.top) - 16 across all 45 levels in portrait', () => {
    expect(levels).toHaveLength(45);

    for (const level of levels) {
      const layout = computeSceneLayout(level, true, 360);
      const maxSlotBottom = layout.slotBounds.bottom;
      const minTileTop = layout.trayBounds.top;

      expect(
        maxSlotBottom,
        `Level ${level.id} (${level.word}) portrait slot bottom exceeds tray top - 16`,
      ).toBeLessThan(minTileTop - 16);

      expect(
        minTileTop - maxSlotBottom,
        `Level ${level.id} (${level.word}) portrait clearance < 24px`,
      ).toBeGreaterThanOrEqual(24);
    }
  });

  it('guarantees zero overlap between slots, tiles, prompt text, and art badge across all 45 levels', () => {
    for (const level of levels) {
      for (const isPortrait of [false, true]) {
        const mode = isPortrait ? 'portrait' : 'landscape';
        const cx = isPortrait ? 360 : 640;
        const layout = computeSceneLayout(level, isPortrait, cx);

        // Header vs Art
        const headerBottom = layout.headerCenterY + 26 + 12; // 24px font height / 2
        const artTop = layout.artCenterY - layout.artSize.height / 2;
        expect(
          artTop,
          `Level ${level.id} (${level.word}) ${mode}: artTop (${artTop}) must be > headerBottom (${headerBottom})`,
        ).toBeGreaterThan(headerBottom);

        // Art vs Mechanic
        const artBottom = layout.artCenterY + layout.artSize.height / 2;
        const mechanicTop = layout.mechanicY - 13;
        expect(
          mechanicTop,
          `Level ${level.id} (${level.word}) ${mode}: mechanicTop (${mechanicTop}) must be > artBottom (${artBottom})`,
        ).toBeGreaterThanOrEqual(artBottom);

        // Mechanic vs Hint (if hint exists)
        const mechanicBottom = layout.mechanicY + 13;
        if (level.hint) {
          const hintTop = layout.hintY - 14;
          expect(
            hintTop,
            `Level ${level.id} (${level.word}) ${mode}: hintTop (${hintTop}) must be > mechanicBottom (${mechanicBottom})`,
          ).toBeGreaterThanOrEqual(mechanicBottom);
        }

        // Prompt (Mechanic/Hint) vs Slots
        const promptBottom = level.hint ? layout.hintY + 14 : mechanicBottom;
        const minSlotTop = layout.slotBounds.top;
        expect(
          minSlotTop,
          `Level ${level.id} (${level.word}) ${mode}: minSlotTop (${minSlotTop}) must be > promptBottom (${promptBottom})`,
        ).toBeGreaterThan(promptBottom);

        // Slots vs Tray
        const maxSlotBottom = layout.slotBounds.bottom;
        const minTileTop = layout.trayBounds.top;
        expect(
          minTileTop,
          `Level ${level.id} (${level.word}) ${mode}: minTileTop (${minTileTop}) must be >= maxSlotBottom + 24 (${maxSlotBottom + 24})`,
        ).toBeGreaterThanOrEqual(maxSlotBottom + 24);
      }
    }
  });
});

describe('multi-row landscape fallback handling', () => {
  it('dynamically adapts layout when tray wraps into 2 rows in landscape', () => {
    // Synthetic stress level with 6 wide phrase tiles that forces 2 tray rows in landscape
    const stressLevel: Level = {
      id: 'stress_001',
      tier: 2,
      word: 'A BUNCH OF GRAPES AND A GLASS OF MILK',
      display: 'a_bunch_of_grapes_and_a_glass_of_milk',
      meaning_id: 'seikat anggur dan segelas susu',
      category: 'food',
      mechanic: 'compound',
      image: 'food/a_slice_of_pizza',
      audio_word: 'words/a_slice_of_pizza',
      audio_phonemes: ['phonemes/a_slice_of', 'phonemes/pizza'],
      tiles: ['A BUNCH OF', 'GRAPES', 'A GLASS OF', 'MILK'],
      distractors: ['A PIECE OF', 'A PAIR OF'],
      chunks: ['A BUNCH OF', 'GRAPES'],
      hint: 'A massive phrase with multiple chunks in tray.',
      ghost_letters: false,
    };

    const layout = computeSceneLayout(stressLevel, false, 640);
    expect(layout.trayRowsCount).toBeGreaterThan(1);
    expect(layout.isMultiRowLandscape).toBe(true);

    // Reduced illustration badge size
    expect(layout.artSize.width).toBeLessThanOrEqual(130);
    expect(layout.artSize.width).toBeGreaterThanOrEqual(110);
    expect(layout.artHaloRadius).toBeLessThanOrEqual(66);

    // Elevated mechanic & hint
    expect(layout.mechanicY).toBeLessThan(300);
    expect(layout.hintY).toBeLessThan(300);

    // Slots strictly cleared from tray
    expect(layout.trayBounds.top - layout.slotBounds.bottom).toBeGreaterThanOrEqual(24);
    expect(layout.slotBounds.bottom).toBeLessThan(layout.trayBounds.top - 16);

    // Slots strictly cleared from hint
    const hintBottom = layout.hintY + 14;
    expect(layout.slotBounds.top).toBeGreaterThan(hintBottom);
  });
});
