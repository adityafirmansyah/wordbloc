import { describe, expect, it } from 'vitest';
import { parseLevel, parseLevelPack } from '../src/game/levelLoader';
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

describe('parseLevelPack', () => {
  it('rejects a missing version', () => {
    expect(() => parseLevelPack({ levels: [validLevel] })).toThrowError(/version/);
  });

  it('rejects an empty levels array', () => {
    expect(() => parseLevelPack({ version: 1, levels: [] })).toThrowError(/levels/);
  });

  it('rejects duplicate ids', () => {
    expect(() => parseLevelPack({ version: 1, levels: [validLevel, validLevel] })).toThrowError(
      /Duplicate level id/,
    );
  });

  it('parses a valid pack', () => {
    const pack = parseLevelPack({ version: 1, levels: [validLevel] });
    expect(pack.version).toBe(1);
    expect(pack.levels).toHaveLength(1);
  });
});
