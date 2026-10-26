import { beforeEach, describe, expect, it } from 'vitest';
import {
  assertCatalogData,
  assertLevelData,
  cachedLevelIds,
  clearLevelCache,
  createLevelCatalog,
  levelCatalog,
  loadLevel,
  manifestCount,
  manifestMissingFiles,
  nextLevelManifest,
  preloadLevel,
  type LevelModuleMap,
} from '../src/game/levels';
import { LevelContractError } from '../src/game/levelTypes';

/**
 * Lazy-loading engine tests.
 *
 * The real bundle is exercised by `levels.data.test.ts`; here we inject module
 * maps so we can assert the parts that are impossible to trigger with sound data:
 * a manifest row with no bundled file, a broken chunk, a file that disagrees with
 * its manifest row, and cache/prefetch behaviour.
 */

const PREFIX = '../data/levels/';

const catFile = {
  id: 'lvl_0001',
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

const dogFile = { ...catFile, id: 'lvl_0002', word: 'DOG', display: 'dog', tiles: ['D', 'O', 'G'] };

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'lvl_0001',
    tier: 1,
    word: 'CAT',
    display: 'cat',
    meaning_id: 'kucing',
    category: 'animals',
    mechanic: 'letter_drag',
    file: 'tier-1/lvl_0001_cat.json',
    ...overrides,
  };
}

function manifest(levels: Record<string, unknown>[] = [entry()], version = 2): unknown {
  return { version, levels };
}

function modules(map: Record<string, unknown>, calls?: string[]): LevelModuleMap {
  const out: LevelModuleMap = {};
  for (const [file, payload] of Object.entries(map)) {
    out[PREFIX + file] = async () => {
      calls?.push(file);
      // Vite namespaces JSON default exports; mirror that shape.
      return { default: payload };
    };
  }
  return out;
}

beforeEach(() => {
  clearLevelCache();
});

describe('createLevelCatalog — synchronous manifest', () => {
  it('exposes metadata without importing any level chunk', () => {
    const calls: string[] = [];
    const catalog = createLevelCatalog(
      manifest([entry(), entry({ id: 'lvl_0002', file: 'tier-1/lvl_0002_dog.json' })]),
      modules({ 'tier-1/lvl_0001_cat.json': catFile }, calls),
    );

    expect(catalog.count()).toBe(2);
    expect(catalog.entryById('lvl_0002')?.file).toBe('tier-1/lvl_0002_dog.json');
    expect(catalog.indexOf('lvl_0002')).toBe(1);
    expect(catalog.entriesByTier().get(1)).toHaveLength(2);
    expect(catalog.nextEntry('lvl_0001')?.id).toBe('lvl_0002');
    expect(catalog.nextEntry('lvl_0002')).toBeNull();
    // The whole point: no chunk was touched.
    expect(calls).toEqual([]);
    expect(catalog.cachedIds()).toEqual([]);
  });

  it('reports manifest rows with no bundled file', () => {
    const catalog = createLevelCatalog(
      manifest([
        entry(),
        entry({ id: 'lvl_0002', word: 'DOG', display: 'dog', file: 'tier-1/lvl_0002_dog.json' }),
      ]),
      modules({ 'tier-1/lvl_0001_cat.json': catFile }),
    );
    expect(catalog.missingFiles()).toEqual(['tier-1/lvl_0002_dog.json']);
  });

  it('loads a second bundled file independently of the first', async () => {
    const catalog = createLevelCatalog(
      manifest([
        entry(),
        entry({ id: 'lvl_0002', word: 'DOG', display: 'dog', file: 'tier-1/lvl_0002_dog.json' }),
      ]),
      modules({ 'tier-1/lvl_0001_cat.json': catFile, 'tier-1/lvl_0002_dog.json': dogFile }),
    );
    expect((await catalog.loadLevel('lvl_0002')).word).toBe('DOG');
    expect(catalog.cachedIds()).toEqual(['lvl_0002']);
  });
});

describe('createLevelCatalog — lazy loadLevel', () => {
  it('imports the chunk once and caches the parsed level', async () => {
    const calls: string[] = [];
    const catalog = createLevelCatalog(
      manifest(),
      modules({ 'tier-1/lvl_0001_cat.json': catFile }, calls),
    );

    const first = await catalog.loadLevel('lvl_0001');
    const second = await catalog.loadLevel('lvl_0001');

    expect(first.word).toBe('CAT');
    expect(second).toBe(first);
    expect(calls).toEqual(['tier-1/lvl_0001_cat.json']);
    expect(catalog.cachedIds()).toEqual(['lvl_0001']);
  });

  it('shares one in-flight import between concurrent callers', async () => {
    const calls: string[] = [];
    const catalog = createLevelCatalog(
      manifest(),
      modules({ 'tier-1/lvl_0001_cat.json': catFile }, calls),
    );

    const [a, b] = await Promise.all([
      catalog.loadLevel('lvl_0001'),
      catalog.loadLevel('lvl_0001'),
    ]);
    expect(a).toBe(b);
    expect(calls).toHaveLength(1);
  });

  it('rejects an unknown id with a LevelContractError naming it', async () => {
    const catalog = createLevelCatalog(manifest(), modules({}));
    const error = await catalog.loadLevel('lvl_9999').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LevelContractError);
    expect((error as LevelContractError).levelId).toBe('lvl_9999');
  });

  it('rejects a manifest row whose file is not in the bundle', async () => {
    const catalog = createLevelCatalog(manifest(), modules({}));
    await expect(catalog.loadLevel('lvl_0001')).rejects.toThrow(/not in the bundle/);
  });

  it('wraps a failing chunk import and retries on the next call', async () => {
    let attempt = 0;
    const map: LevelModuleMap = {
      [PREFIX + 'tier-1/lvl_0001_cat.json']: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('network down');
        return { default: catFile };
      },
    };
    const catalog = createLevelCatalog(manifest(), map);

    await expect(catalog.loadLevel('lvl_0001')).rejects.toThrow(/network down/);
    // A rejected in-flight promise must not be replayed forever.
    await expect(catalog.loadLevel('lvl_0001')).resolves.toMatchObject({ word: 'CAT' });
    expect(attempt).toBe(2);
  });

  it('rejects a file that disagrees with its manifest row', async () => {
    const catalog = createLevelCatalog(
      manifest(),
      modules({ 'tier-1/lvl_0001_cat.json': { ...catFile, word: 'DOG' } }),
    );
    const error = await catalog.loadLevel('lvl_0001').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LevelContractError);
    expect((error as LevelContractError).field).toBe('word');
    expect((error as Error).message).toContain('DOG');
  });

  it('rejects a file that fails the level contract', async () => {
    const catalog = createLevelCatalog(
      manifest(),
      modules({ 'tier-1/lvl_0001_cat.json': { ...catFile, mechanic: 'teleport' } }),
    );
    await expect(catalog.loadLevel('lvl_0001')).rejects.toBeInstanceOf(LevelContractError);
  });

  it('rejects a file whose parsed id differs from the manifest id', async () => {
    const catalog = createLevelCatalog(
      manifest(),
      modules({ 'tier-1/lvl_0001_cat.json': { ...catFile, id: 'lvl_0007' } }),
    );
    await expect(catalog.loadLevel('lvl_0001')).rejects.toThrow(/disagrees with the manifest/);
  });
});

describe('createLevelCatalog — preloadLevel', () => {
  it('warms the cache and never rejects', async () => {
    const catalog = createLevelCatalog(manifest(), modules({}));
    // Missing file: preload swallows the failure.
    await expect(catalog.preloadLevel('lvl_0001')).resolves.toBeUndefined();
    expect(catalog.cachedIds()).toEqual([]);

    const healthy = createLevelCatalog(
      manifest(),
      modules({ 'tier-1/lvl_0001_cat.json': catFile }),
    );
    await healthy.preloadLevel('lvl_0001');
    expect(healthy.cachedIds()).toEqual(['lvl_0001']);
  });

  it('leaves the level loadable after a failed preload', async () => {
    const catalog = createLevelCatalog(manifest(), modules({}));
    await catalog.preloadLevel('lvl_0001');
    await expect(catalog.loadLevel('lvl_0001')).rejects.toThrow(/not in the bundle/);
  });
});

describe('createLevelCatalog — manifest contract', () => {
  it('rejects a non-object manifest', () => {
    expect(() => createLevelCatalog('nope', {}).manifest()).toThrow(LevelContractError);
  });

  it('rejects a missing or unsupported version', () => {
    expect(() => createLevelCatalog({ levels: [entry()] }, {}).manifest()).toThrow(/version/);
    expect(() => createLevelCatalog({ version: 1, levels: [entry()] }, {}).manifest()).toThrow(
      /not supported/,
    );
  });

  it('rejects an empty levels array', () => {
    expect(() => createLevelCatalog(manifest([]), {}).manifest()).toThrow(/levels/);
  });

  it('rejects an invalid tier or mechanic', () => {
    expect(() => createLevelCatalog(manifest([entry({ tier: 9 })]), {}).manifest()).toThrow(/tier/);
    expect(() =>
      createLevelCatalog(manifest([entry({ mechanic: 'teleport' })]), {}).manifest(),
    ).toThrow(/mechanic/);
  });

  it('rejects duplicate ids and duplicate files', () => {
    expect(() => createLevelCatalog(manifest([entry(), entry()]), {}).manifest()).toThrow(
      /Duplicate level id/,
    );
    expect(() =>
      createLevelCatalog(manifest([entry(), entry({ id: 'lvl_0002' })]), {}).manifest(),
    ).toThrow(/share the file/);
  });

  it('rejects a file path outside the tier-N layout', () => {
    for (const file of ['../evil.json', 'tier-1/x.js', '/abs/lvl.json', 'tier-9/x.json']) {
      expect(() => createLevelCatalog(manifest([entry({ file })]), {}).manifest(), file).toThrow(
        LevelContractError,
      );
    }
  });

  it('rejects a file that lives outside its declared tier', () => {
    expect(() =>
      createLevelCatalog(manifest([entry({ file: 'tier-2/lvl_0001_cat.json' })]), {}).manifest(),
    ).toThrow(/declares tier 1/);
  });
});

describe('real catalogue wiring', () => {
  it('the app catalogue has no missing files and a full manifest', () => {
    expect(manifestMissingFiles()).toEqual([]);
    expect(manifestCount()).toBe(30);
    expect(levelCatalog().manifest().levels).toHaveLength(30);
    expect(assertLevelData().levels).toHaveLength(30);
  });

  it('assertCatalogData fails loudly when a file is missing', () => {
    const broken = createLevelCatalog(manifest(), modules({}));
    expect(() => assertCatalogData(broken)).toThrow(/references missing files/);
    expect(() => assertCatalogData(broken)).toThrow(/tier-1\/lvl_0001_cat\.json/);
  });

  it('loads a real level by id and remembers it', async () => {
    clearLevelCache();
    const level = await loadLevel('lvl_0019');
    expect(level.word).toBe('BUTTERFLY');
    expect(level.chunks).toEqual(['BUT', 'TER', 'FLY']);
    expect(cachedLevelIds()).toContain('lvl_0019');
  });

  it('preloads the next level without throwing', async () => {
    const next = nextLevelManifest('lvl_0019');
    expect(next?.id).toBe('lvl_0020');
    await expect(preloadLevel(next!.id)).resolves.toBeUndefined();
    expect(cachedLevelIds()).toContain('lvl_0020');
  });
});
