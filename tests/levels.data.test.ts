import { describe, expect, it } from 'vitest';
import rawLevels from '../src/data/levels.json';
import { parseLevelPack } from '../src/game/levelLoader';
import { buildTray, isPuzzleComplete, resolveDrop, targetUnits } from '../src/game/puzzle';
import { levelPack } from '../src/game/levels';

const pack = parseLevelPack(rawLevels);
const levels = pack.levels;

describe('seeded level data (docs/SPEC.md v1 scope)', () => {
  it('parses cleanly', () => {
    expect(levels.length).toBe(30);
  });

  it('ships exactly 10 / 8 / 6 / 3 / 3 levels by tier', () => {
    const byTier = new Map<number, number>();
    for (const level of levels) byTier.set(level.tier, (byTier.get(level.tier) ?? 0) + 1);
    expect(Object.fromEntries(byTier)).toEqual({ 1: 10, 2: 8, 3: 6, 4: 3, 5: 3 });
  });

  it('covers all 5 tiers and all 4 mechanics', () => {
    const tiers = new Set(levels.map((l) => l.tier));
    const mechanics = new Set(levels.map((l) => l.mechanic));
    expect([...tiers].sort()).toEqual([1, 2, 3, 4, 5]);
    expect([...mechanics].sort()).toEqual(['affix', 'compound', 'letter_drag', 'syllable_tap']);
  });

  it('uses unique ids and unique words', () => {
    expect(new Set(levels.map((l) => l.id)).size).toBe(levels.length);
    expect(new Set(levels.map((l) => l.word)).size).toBe(levels.length);
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
      expect(level.mechanic, `${level.id} tier ${level.tier}`).toBe(expected[level.tier]);
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

describe('levelPack() singleton', () => {
  it('returns the same validated pack', () => {
    expect(levelPack().levels.length).toBe(30);
    expect(levelPack()).toBe(levelPack());
  });
});
