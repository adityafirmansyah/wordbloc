import { beforeAll, describe, expect, it } from 'vitest';
import {
  loadLevel,
  levelManifest,
  manifestEntriesByTier,
  manifestEntryById,
  manifestIndexOf,
  manifestCount,
  nextLevelManifest,
} from '../src/game/levels';
import { buildTray, isPuzzleComplete, resolveDrop, targetUnits } from '../src/game/puzzle';
import type { Level } from '../src/game/levelTypes';

/**
 * Seed-data suite for the MODULAR level layout (src/data/levels/).
 *
 * Every level is its own lazily-imported file, so this suite is async: it pulls
 * all 30 chunks through the public loader and then asserts the same seed-data
 * contract the monolithic pack used to guarantee. Anything that used to be
 * "the pack parses" is now "every individual file loads and validates".
 */

const COUNT = 45;

let levels: Level[];

beforeAll(async () => {
  const ids = levelManifest().levels.map((entry) => entry.id);
  const loaded = await Promise.all(ids.map((id) => loadLevel(id)));
  // File order is manifest order, so tier/index lookups stay predictable.
  levels = loaded;
});

describe('level manifest (src/data/levels/manifest.json)', () => {
  it('lists exactly 45 levels', () => {
    expect(manifestCount()).toBe(COUNT);
    expect(levelManifest().version).toBe(2);
  });

  it('ships exactly 10 / 23 / 6 / 3 / 3 levels by tier', () => {
    const counts = [...manifestEntriesByTier().entries()]
      .map(([tier, entries]) => [tier, entries.length] as const)
      .sort((a, b) => a[0] - b[0]);
    expect(Object.fromEntries(counts)).toEqual({ 1: 10, 2: 23, 3: 6, 4: 3, 5: 3 });
  });

  it('uses unique ids and unique words', () => {
    const entries = levelManifest().levels;
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
    expect(new Set(entries.map((e) => e.word)).size).toBe(entries.length);
  });

  it('points at the documented per-tier file layout', () => {
    for (const entry of levelManifest().levels) {
      expect(entry.file, entry.id).toMatch(/^tier-[1-5]\/lvl_\d{4}_[a-z_]+\.json$/);
      expect(entry.file.startsWith(`tier-${entry.tier}/`), entry.id).toBe(true);
    }
  });

  it('exposes manifest lookups used by the scenes', () => {
    const first = manifestEntryById('lvl_0001');
    expect(first?.word).toBe('CAT');
    expect(manifestIndexOf('lvl_0001')).toBe(0);
    expect(manifestIndexOf('nope')).toBe(-1);
    expect(nextLevelManifest('lvl_0001')?.id).toBe('lvl_0002');
    expect(nextLevelManifest('not-a-level')).toBeNull();
    expect(nextLevelManifest(levelManifest().levels[COUNT - 1]!.id)).toBeNull();
  });
});

describe('every level file loads and validates', () => {
  it('loads all 45 levels through the lazy loader', () => {
    expect(levels).toHaveLength(COUNT);
    expect(levels.map((l) => l.id)).toEqual(levelManifest().levels.map((e) => e.id));
  });

  it('keeps the manifest row and the level file in agreement', () => {
    for (const entry of levelManifest().levels) {
      const level = levels[manifestIndexOf(entry.id)];
      expect(level, entry.id).toBeDefined();
      expect(level!.id, entry.id).toBe(entry.id);
      expect(level!.tier, entry.id).toBe(entry.tier);
      expect(level!.word, entry.id).toBe(entry.word);
      expect(level!.display, entry.id).toBe(entry.display);
      expect(level!.mechanic, entry.id).toBe(entry.mechanic);
      expect(level!.category, entry.id).toBe(entry.category);
    }
  });

  it('covers all 5 tiers and all 4 mechanics', () => {
    const tiers = new Set(levels.map((l) => l.tier));
    const mechanics = new Set(levels.map((l) => l.mechanic));
    expect([...tiers].sort()).toEqual([1, 2, 3, 4, 5]);
    expect([...mechanics].sort()).toEqual(['affix', 'compound', 'letter_drag', 'syllable_tap']);
  });

  it('maps each tier to its spec mechanic', () => {
    const expected: Record<number, string> = {
      1: 'letter_drag',
      2: 'letter_drag',
      3: 'syllable_tap',
      4: 'compound',
      5: 'affix',
    };
    for (const level of levels) {
      if (level.tier === 2 && level.id >= 'lvl_0031') {
        expect(level.mechanic, `${level.id} tier ${level.tier}`).toBe('compound');
      } else {
        expect(level.mechanic, `${level.id} tier ${level.tier}`).toBe(expected[level.tier]);
      }
    }
  });

  it('T1 has no distractors and ghost letters ON; T2+ has distractors and ghosts OFF', () => {
    for (const level of levels) {
      if (level.tier === 1) {
        expect(level.distractors, level.id).toEqual([]);
        expect(level.ghost_letters, level.id).toBe(true);
      } else {
        expect(level.distractors.length, level.id).toBeGreaterThanOrEqual(2);
        expect(level.ghost_letters, level.id).toBe(false);
      }
    }
  });

  it('chunk mechanics carry chunks; letter_drag carries null', () => {
    for (const level of levels) {
      if (level.mechanic === 'letter_drag') {
        expect(level.chunks, level.id).toBeNull();
      } else {
        expect(Array.isArray(level.chunks), level.id).toBe(true);
        expect(level.chunks?.length, level.id).toBeGreaterThan(0);
      }
    }
  });

  it('never references a file extension in asset keys', () => {
    for (const level of levels) {
      for (const key of [level.image, level.audio_word, ...level.audio_phonemes]) {
        expect(key, `${level.id}: ${key}`).not.toMatch(/\.(png|jpg|jpeg|svg|mp3|wav|ogg)$/i);
      }
    }
  });

  it('gives every slot exactly one phoneme key (SPEC: Phonics Rule)', () => {
    // This test would have FAILED before the round-1 fix: HOUSE/WATER/MOUSE had
    // 4 phonemes for 5 slots and the old test only asserted `<= units`, encoding
    // the bug as allowed. One key per slot is now the enforced invariant.
    for (const level of levels) {
      const units = targetUnits(level);
      expect(level.audio_phonemes.length, level.id).toBe(units.length);
    }
  });

  it('maps each slot to its own sound — no shifted or duplicated neighbours', () => {
    // Exact expected sequences for the levels that were wrong in round 1, plus
    // the digraph/silent-letter cases that share the same root cause.
    const expected: Record<string, string[]> = {
      lvl_0010: ['f', 'i', 'sh', 'sh'], // FISH: SH is one sound spanning S and H
      lvl_0011: ['t', 'ie', 'g', 'er', 'er'], // TIGER: ER spans E and R
      lvl_0012: ['ae', 'p', 'p', 'l', 'silent'], // APPLE: final E is silent
      lvl_0013: ['h', 'ow', 'ow', 's', 'silent'], // HOUSE: OU = /ow/, final E silent
      lvl_0014: ['w', 'aw', 't', 'er', 'er'], // WATER: ER spans E and R
      lvl_0015: ['s', 'n', 'ae', 'k', 'silent'], // SNAKE: final E is silent
      lvl_0016: ['m', 'ow', 'ow', 's', 'silent'], // MOUSE: OU = /ow/, final E silent
      lvl_0017: ['t', 'r', 'ae', 'ae', 'n'], // TRAIN: AI = /ae/
    };
    for (const [id, slugs] of Object.entries(expected)) {
      const level = levels.find((l) => l.id === id);
      expect(level, id).toBeDefined();
      expect(
        targetUnits(level!).map((unit) => unit.phoneme.split('/').pop()),
        `${id} (${level!.word})`,
      ).toEqual(slugs);
    }
  });

  it('never plays a letter NAME for a letter_drag slot', () => {
    // "cue ay tee" instead of /k/ /ae/ /t/ is a spec defect. For letter_drag every
    // key must be a single-sound slug, a digraph slug, or the explicit silent marker.
    // (Chunk mechanics intentionally use the chunk itself as the key, e.g.
    // "phonemes/but" for the BUT syllable, so they are excluded here.)
    const allowed = new Set([
      'k',
      'ae',
      't',
      'd',
      'aw',
      'g',
      's',
      'u',
      'n',
      'b',
      'e',
      'p',
      'i',
      'h',
      'm',
      'f',
      'r',
      'o',
      'sh',
      'ie',
      'er',
      'l',
      'ow',
      'w',
      'silent',
    ]);
    for (const level of levels) {
      if (level.mechanic !== 'letter_drag') continue;
      for (const unit of targetUnits(level)) {
        const slug = unit.phoneme.split('/').pop() ?? '';
        expect(allowed.has(slug), `${level.id} ${unit.unit} -> ${unit.phoneme}`).toBe(true);
      }
    }
  });

  it('resolves a phoneme for every slot, never undefined', () => {
    for (const level of levels) {
      for (const unit of targetUnits(level)) {
        expect(unit.phoneme, `${level.id}:${unit.unit}`).toBeTruthy();
      }
    }
  });

  it('every level is completable by dragging its own tiles', () => {
    for (const level of levels) {
      const units = targetUnits(level);
      const available = [...level.tiles];
      for (const unit of units) {
        const at = available.indexOf(unit.unit);
        expect(at, `${level.id} needs ${unit.unit}`).toBeGreaterThanOrEqual(0);
        available.splice(at, 1);
      }
    }
  });

  it('every level can be solved end to end through the pure rules', () => {
    for (const level of levels) {
      const units = targetUnits(level);
      const filled: (string | null)[] = units.map(() => null);
      units.forEach((unit, index) => {
        const result = resolveDrop(level, unit.unit, index, filled);
        expect(result.snapTo, `${level.id} slot ${index}`).toBe(index);
        filled[index] = unit.unit;
      });
      expect(isPuzzleComplete(level, filled), level.id).toBe(true);
    }
  });
});

describe('buildTray', () => {
  it('tray = tiles + distractors', () => {
    for (const level of levels) {
      const tray = buildTray(level);
      expect(tray.length, level.id).toBe(level.tiles.length + level.distractors.length);
    }
  });

  it('is deterministic per level (stable bug reports)', () => {
    const level = levels[0]!;
    expect(buildTray(level).map((t) => t.unit)).toEqual(buildTray(level).map((t) => t.unit));
  });

  it('gives every tile a unique uid, duplicates included', () => {
    const apple = levels.find((l) => l.word === 'APPLE');
    expect(apple).toBeDefined();
    const tray = buildTray(apple!);
    expect(new Set(tray.map((t) => t.uid)).size).toBe(tray.length);
    expect(tray.filter((t) => t.unit === 'P')).toHaveLength(2);
  });

  it('marks distractors', () => {
    const level = levels.find((l) => l.tier === 2)!;
    const tray = buildTray(level);
    expect(tray.filter((t) => t.isDistractor)).toHaveLength(level.distractors.length);
  });
});

describe('edge cases in the tray', () => {
  it('at least one level has duplicate tiles (APPLE/BANANA style)', () => {
    const duplicates = levels.filter((level) => new Set(level.tiles).size !== level.tiles.length);
    expect(duplicates.length).toBeGreaterThan(0);
  });
});
