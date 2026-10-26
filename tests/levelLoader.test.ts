import { describe, expect, it } from 'vitest';
import { parseLevel, parseLevelManifest } from '../src/game/levelLoader';
import { LevelContractError } from '../src/game/levelTypes';

const validLevel = {
  id: 'lvl_x',
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
};

describe('parseLevel — happy path', () => {
  it('parses a spec-shaped level', () => {
    const level = parseLevel(validLevel, 0);
    expect(level.word).toBe('CAT');
    expect(level.tier).toBe(1);
    expect(level.mechanic).toBe('letter_drag');
    expect(level.chunks).toBeNull();
    expect(level.ghost_letters).toBe(true);
  });

  it('parses a chunk mechanic with chunks present', () => {
    const level = parseLevel(
      {
        ...validLevel,
        id: 'lvl_bfly',
        word: 'BUTTERFLY',
        display: 'butterfly',
        tier: 3,
        mechanic: 'syllable_tap',
        tiles: ['BUT', 'TER', 'FLY'],
        chunks: ['BUT', 'TER', 'FLY'],
        ghost_letters: false,
      },
      0,
    );
    expect(level.mechanic).toBe('syllable_tap');
    expect(level.chunks).toEqual(['BUT', 'TER', 'FLY']);
  });
});

describe('parseLevel — readable contract violations', () => {
  it('throws on unknown mechanic and names the bad value', () => {
    expect(() => parseLevel({ ...validLevel, mechanic: 'teleport' }, 0)).toThrowError(
      LevelContractError,
    );
    try {
      parseLevel({ ...validLevel, mechanic: 'teleport' }, 0);
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('lvl_x');
      expect(message).toContain('teleport');
      expect(message).toContain('letter_drag');
    }
  });

  it('throws on missing tiles', () => {
    const withoutTiles: Record<string, unknown> = { ...validLevel };
    delete withoutTiles.tiles;
    expect(() => parseLevel(withoutTiles, 0)).toThrowError(/missing "tiles"/);
  });

  it('throws on empty tiles array', () => {
    expect(() => parseLevel({ ...validLevel, tiles: [] }, 0)).toThrowError(/tiles/);
  });

  it('throws on missing chunks for a chunk mechanic', () => {
    expect(() =>
      parseLevel({ ...validLevel, mechanic: 'compound', tiles: ['SUN', 'FLOW'], chunks: null }, 0),
    ).toThrowError(/missing "chunks"/);
  });

  it('throws on invalid tier', () => {
    expect(() => parseLevel({ ...validLevel, tier: 9 }, 0)).toThrowError(/tier/);
  });

  it('throws when tiles cannot spell the word', () => {
    expect(() => parseLevel({ ...validLevel, tiles: ['C', 'A'] }, 0)).toThrowError(
      /cannot be completed/,
    );
  });

  it('throws when a level has fewer phonemes than slots (the HOUSE/MOUSE defect)', () => {
    // lvl_0013 HOUSE shipped 4 phonemes for 5 slots; the old loader tolerated it
    // and every later slot spoke its neighbour's sound (U said /s/, S said /e/).
    expect(() =>
      parseLevel(
        {
          ...validLevel,
          id: 'lvl_house',
          word: 'HOUSE',
          display: 'house',
          tiles: ['H', 'O', 'U', 'S', 'E'],
          audio_phonemes: ['phonemes/h', 'phonemes/ow', 'phonemes/s', 'phonemes/e'],
        },
        0,
      ),
    ).toThrowError(/4 audio_phonemes for 5 slots/);
  });

  it('throws when a level has MORE phonemes than slots', () => {
    expect(() =>
      parseLevel(
        { ...validLevel, audio_phonemes: ['phonemes/k', 'phonemes/ae', 'phonemes/t', 'x'] },
        0,
      ),
    ).toThrowError(/4 audio_phonemes for 3 slots/);
  });

  it('names the level and the field on the phoneme-count error', () => {
    try {
      parseLevel({ ...validLevel, audio_phonemes: ['phonemes/k'] }, 0);
      expect.fail('should have thrown');
    } catch (error) {
      const err = error as LevelContractError;
      expect(err.levelId).toBe('lvl_x');
      expect(err.field).toBe('audio_phonemes');
      expect(err.message).toContain('silent');
    }
  });

  it('throws on an empty phoneme key', () => {
    expect(() =>
      parseLevel({ ...validLevel, audio_phonemes: ['phonemes/k', '', 'phonemes/t'] }, 0),
    ).toThrowError(/empty audio_phonemes entry at slot 1/);
  });

  it('accepts one silent marker per silent letter', () => {
    const level = parseLevel(
      {
        ...validLevel,
        id: 'lvl_apple',
        word: 'APPLE',
        display: 'apple',
        tiles: ['A', 'P', 'P', 'L', 'E'],
        audio_phonemes: [
          'phonemes/ae',
          'phonemes/p',
          'phonemes/p',
          'phonemes/l',
          'phonemes/silent',
        ],
      },
      0,
    );
    expect(level.audio_phonemes).toHaveLength(5);
  });

  it('names the index when the entry is not an object', () => {
    expect(() => parseLevel('nope', 7)).toThrowError(/index 7/);
  });

  it('exposes levelId and field on the error', () => {
    try {
      parseLevel({ ...validLevel, mechanic: 'nope' }, 0);
      expect.fail('should have thrown');
    } catch (error) {
      const err = error as LevelContractError;
      expect(err.levelId).toBe('lvl_x');
      expect(err.field).toBe('mechanic');
    }
  });
});

describe('parseLevelPack — removed with the monolithic pack', () => {
  // The single-file pack is gone: `manifest.json` + per-level files replace it, so
  // pack-level parsing has no caller. `parseLevelManifest` (below) covers the
  // duplicate-id/empty-collection cases the pack parser used to guard.
  it('is no longer exported', async () => {
    const loader = await import('../src/game/levelLoader');
    expect('parseLevelPack' in loader).toBe(false);
  });
});

const validManifestEntry = {
  id: 'lvl_0001',
  tier: 1,
  word: 'CAT',
  display: 'cat',
  meaning_id: 'kucing',
  category: 'animals',
  mechanic: 'letter_drag',
  file: 'tier-1/lvl_0001_cat.json',
};

describe('parseLevelManifest — the index the app reads synchronously', () => {
  it('parses a spec-shaped manifest', () => {
    const manifest = parseLevelManifest({ version: 2, levels: [validManifestEntry] });
    expect(manifest.version).toBe(2);
    expect(manifest.levels[0]).toEqual(validManifestEntry);
  });

  it('rejects a missing / unsupported version', () => {
    expect(() => parseLevelManifest({ levels: [validManifestEntry] })).toThrowError(/version/);
    expect(() => parseLevelManifest({ version: 1, levels: [validManifestEntry] })).toThrowError(
      /not supported/,
    );
  });

  it('rejects an empty levels array', () => {
    expect(() => parseLevelManifest({ version: 2, levels: [] })).toThrowError(/levels/);
  });

  it('rejects an unknown mechanic and names it', () => {
    expect(() =>
      parseLevelManifest({
        version: 2,
        levels: [{ ...validManifestEntry, mechanic: 'teleport' }],
      }),
    ).toThrowError(/teleport/);
  });

  it('rejects duplicate ids and duplicate files', () => {
    expect(() =>
      parseLevelManifest({ version: 2, levels: [validManifestEntry, validManifestEntry] }),
    ).toThrowError(/Duplicate level id/);
    expect(() =>
      parseLevelManifest({
        version: 2,
        levels: [validManifestEntry, { ...validManifestEntry, id: 'lvl_0002' }],
      }),
    ).toThrowError(/share the file/);
  });

  it('rejects a file that escapes the tier directory', () => {
    for (const file of ['../../etc/passwd', 'tier-1/../../x.json', 'http://evil/x.json']) {
      expect(() =>
        parseLevelManifest({ version: 2, levels: [{ ...validManifestEntry, file }] }),
      ).toThrowError(LevelContractError);
    }
  });

  it('rejects a file in a different tier directory than declared', () => {
    expect(() =>
      parseLevelManifest({
        version: 2,
        levels: [{ ...validManifestEntry, tier: 2, file: 'tier-1/lvl_0001_cat.json' }],
      }),
    ).toThrowError(/declares tier 2/);
  });

  it('names the entry and field on a bad file path', () => {
    try {
      parseLevelManifest({
        version: 2,
        levels: [{ ...validManifestEntry, file: 'nope.json' }],
      });
      expect.fail('should have thrown');
    } catch (error) {
      const err = error as LevelContractError;
      expect(err.levelId).toBe('lvl_0001');
      expect(err.field).toBe('file');
    }
  });
});
