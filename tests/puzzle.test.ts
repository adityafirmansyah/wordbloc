import { describe, expect, it } from 'vitest';
import { parseLevel } from '../src/game/levelLoader';
import {
  buildTray,
  firstFittingSlot,
  isPuzzleComplete,
  progress,
  remainingRequirement,
  resolveDrop,
  targetUnits,
} from '../src/game/puzzle';
import type { Level } from '../src/game/levelTypes';

const cat: Level = parseLevel(
  {
    id: 'lvl_cat',
    tier: 1,
    word: 'CAT',
    display: 'cat',
    meaning_id: 'kucing',
    category: 'animals',
    mechanic: 'letter_drag',
    image: 'animals/cat',
    audio_word: 'words/cat',
    audio_phonemes: ['phonemes/k', 'phonemes/ae', 'phonemes/t'],
    tiles: ['C', 'A', 'T'],
    distractors: [],
    chunks: null,
    hint: 'It says meow.',
    ghost_letters: true,
  },
  0,
);

const butterfly: Level = parseLevel(
  {
    id: 'lvl_bfly',
    tier: 3,
    word: 'BUTTERFLY',
    display: 'butterfly',
    meaning_id: 'kupu-kupu',
    category: 'animals',
    mechanic: 'syllable_tap',
    image: 'animals/butterfly',
    audio_word: 'words/butterfly',
    audio_phonemes: ['phonemes/but', 'phonemes/ter', 'phonemes/fly'],
    tiles: ['BUT', 'TER', 'FLY'],
    distractors: ['BAT'],
    chunks: ['BUT', 'TER', 'FLY'],
    hint: 'It has colourful wings.',
    ghost_letters: false,
  },
  1,
);

describe('targetUnits', () => {
  it('splits a letter_drag word into characters', () => {
    expect(targetUnits(cat).map((u) => u.unit)).toEqual(['C', 'A', 'T']);
  });

  it('uses chunks for chunk mechanics', () => {
    expect(targetUnits(butterfly).map((u) => u.unit)).toEqual(['BUT', 'TER', 'FLY']);
  });

  it('pairs each unit with its phoneme key', () => {
    expect(targetUnits(cat)[1]).toEqual({ unit: 'A', phoneme: 'phonemes/ae' });
  });
});

describe('resolveDrop — the single magnet/snap rule', () => {
  it('snaps a correct tile into its slot', () => {
    expect(resolveDrop(cat, 'C', 0, [null, null, null])).toEqual({ snapTo: 0 });
  });

  it('rejects a correct tile in the wrong slot (bounce, no penalty)', () => {
    expect(resolveDrop(cat, 'C', 1, [null, null, null])).toEqual({
      snapTo: null,
      reason: 'wrong_slot',
    });
  });

  it('rejects a distractor everywhere', () => {
    const filled: (string | null)[] = [null, null, null, null];
    expect(resolveDrop(butterfly, 'BAT', 0, filled).snapTo).toBeNull();
  });

  it('rejects dropping onto an occupied slot', () => {
    expect(resolveDrop(cat, 'A', 0, ['C', null, null])).toEqual({
      snapTo: null,
      reason: 'occupied',
    });
  });

  it('rejects an out-of-range slot', () => {
    expect(resolveDrop(cat, 'C', 9, [null, null, null]).snapTo).toBeNull();
  });

  it('works identically for chunk mechanics', () => {
    expect(resolveDrop(butterfly, 'TER', 1, [null, null, null])).toEqual({ snapTo: 1 });
  });
});

describe('firstFittingSlot', () => {
  it('finds the earliest empty slot for a letter', () => {
    expect(firstFittingSlot(cat, 'T', [null, null, null])).toBe(2);
  });

  it('skips already-filled slots', () => {
    expect(firstFittingSlot(cat, 'A', [null, 'A', null])).toBe(-1);
  });

  it('returns -1 for a unit that does not fit', () => {
    expect(firstFittingSlot(cat, 'Z', [null, null, null])).toBe(-1);
  });

  it('handles duplicate units (second P goes to the second P slot)', () => {
    const apple = parseLevel(
      {
        ...cat,
        id: 'lvl_apple',
        tier: 2,
        word: 'APPLE',
        tiles: ['A', 'P', 'P', 'L', 'E'],
        audio_phonemes: ['a', 'b', 'c', 'd', 'e'],
      },
      0,
    );
    const filled: (string | null)[] = ['A', 'P', null, null, null];
    expect(firstFittingSlot(apple, 'P', filled)).toBe(2);
  });
});

describe('isPuzzleComplete / progress', () => {
  it('is false while slots remain', () => {
    expect(isPuzzleComplete(cat, ['C', 'A', null])).toBe(false);
  });

  it('is true when every slot matches', () => {
    expect(isPuzzleComplete(cat, ['C', 'A', 'T'])).toBe(true);
  });

  it('is false for a wrong arrangement', () => {
    expect(isPuzzleComplete(cat, ['C', 'T', 'A'])).toBe(false);
  });

  it('counts filled slots', () => {
    expect(progress([null, 'A', null])).toBe(1);
    expect(progress([])).toBe(0);
  });

  it('reports what is still needed', () => {
    expect(remainingRequirement(cat, ['C', null, null])).toEqual(['A', 'T']);
  });
});

describe('buildTray invariants', () => {
  it('contains every tile needed to solve the level', () => {
    const tray = buildTray(cat);
    const units = tray.map((t) => t.unit);
    for (const target of targetUnits(cat)) {
      expect(units).toContain(target.unit);
    }
  });

  it('appends distractors to the tray', () => {
    const tray = buildTray(butterfly);
    expect(tray).toHaveLength(4);
    expect(tray.some((t) => t.unit === 'BAT' && t.isDistractor)).toBe(true);
  });
});
