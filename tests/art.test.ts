import { describe, expect, it, vi } from 'vitest';
import { artTextureKey, hasArt, loadArt, type ImageDecoder } from '../src/game/art';

/**
 * Illustration loader suite.
 *
 * `loadArt` is the one place a sticker enters the texture cache, and it runs at
 * the worst possible moment — after the board has already drawn. The failure
 * modes that matter are therefore about *not hanging* and *not throwing*:
 *   - a 404 must resolve as `failed`, never reject (the scene keeps its placeholder);
 *   - two widgets on the same card must share ONE request;
 *   - a scene that shuts down mid-flight must not leave the caller awaiting.
 *
 * Phaser is not imported: `loadArt` takes a structural `scene`, so a tiny double
 * with `textures` + `events` is enough and keeps this suite fast.
 */

interface TextureDouble {
  exists: (key: string) => boolean;
  addImage: (key: string, source: unknown) => void;
}

interface SceneDouble {
  textures: TextureDouble & { added: string[] };
  events: {
    once: (name: string, fn: () => void) => void;
    off: (name: string, fn: () => void) => void;
    /** Fire the registered SHUTDOWN handler(s). */
    shutdown: () => void;
  };
  /** Cast helper: `loadArt` only uses the two members above. */
}

function makeScene(): SceneDouble {
  const keys = new Map<string, unknown>();
  const listeners = new Set<() => void>();
  const added: string[] = [];

  const textures = {
    added,
    exists: (key: string): boolean => keys.has(key),
    addImage: (key: string, source: unknown): void => {
      if (source === null || source === undefined) throw new Error('bad source');
      keys.set(key, source);
      added.push(key);
    },
  };

  return {
    textures,
    events: {
      once: (name, fn) => {
        if (name === 'shutdown') listeners.add(fn);
      },
      off: (name, fn) => {
        if (name === 'shutdown') listeners.delete(fn);
      },
      shutdown: () => {
        for (const fn of [...listeners]) fn();
        listeners.clear();
      },
    },
  };
}

type LoaderScene = Parameters<typeof loadArt>[0];

function scene(spec: SceneDouble): LoaderScene {
  return spec as unknown as LoaderScene;
}

/** A decoder that never settles — for the shutdown race. */
const neverDecodes: ImageDecoder = () => new Promise<unknown>(() => undefined);

describe('loadArt — success path', () => {
  it('loads one sticker and registers it under the namespaced texture key', async () => {
    const double = makeScene();
    const decode = vi.fn<ImageDecoder>(() => Promise.resolve({ width: 512 }));

    const result = await loadArt(scene(double), ['animals/cat'], decode);

    expect(result).toEqual({ loaded: ['animals/cat'], failed: [] });
    expect(hasArt(scene(double), 'animals/cat')).toBe(true);
    expect(double.textures.added).toEqual([artTextureKey('animals/cat')]);
    expect(artTextureKey('animals/cat')).toBe('art/animals/cat');
  });

  it('requests the pack URL for the key', async () => {
    const double = makeScene();
    const urls: string[] = [];
    const decode: ImageDecoder = (url) => {
      urls.push(url);
      return Promise.resolve({});
    };
    await loadArt(scene(double), ['feelings/unhappy'], decode);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/assets\/images\/feelings\/unhappy\.webp$/);
  });

  it('skips keys that are already cached', async () => {
    const double = makeScene();
    double.textures.addImage('art/animals/cat', {});
    const decode = vi.fn<ImageDecoder>(() => Promise.resolve({}));

    const result = await loadArt(scene(double), ['animals/cat'], decode);

    expect(result).toEqual({ loaded: [], failed: [] });
    expect(decode).not.toHaveBeenCalled();
  });

  it('loads several keys and dedupes the request list', async () => {
    const double = makeScene();
    const decode = vi.fn<ImageDecoder>(() => Promise.resolve({}));

    const result = await loadArt(
      scene(double),
      ['animals/cat', 'animals/cat', 'food/apple'],
      decode,
    );

    expect(result.loaded).toEqual(['animals/cat', 'food/apple']);
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it('returns the cached list without touching the network for an empty request', async () => {
    const double = makeScene();
    const decode = vi.fn<ImageDecoder>(() => Promise.resolve({}));
    expect(await loadArt(scene(double), [], decode)).toEqual({ loaded: [], failed: [] });
    expect(await loadArt(scene(double), [''], decode)).toEqual({ loaded: [], failed: [] });
    expect(decode).not.toHaveBeenCalled();
  });
});

describe('loadArt — dedupe and failure', () => {
  it('shares ONE in-flight request between concurrent callers', async () => {
    const double = makeScene();
    let resolveDecode: (value: unknown) => void = () => undefined;
    const decode = vi.fn<ImageDecoder>(
      () =>
        new Promise<unknown>((resolve) => {
          resolveDecode = resolve;
        }),
    );

    const first = loadArt(scene(double), ['animals/cat'], decode);
    const second = loadArt(scene(double), ['animals/cat'], decode);
    resolveDecode({});
    const [a, b] = await Promise.all([first, second]);

    expect(decode).toHaveBeenCalledTimes(1);
    expect(a.loaded).toEqual(['animals/cat']);
    expect(b.loaded).toEqual(['animals/cat']);
  });

  it('reports a 404 as failed and never rejects', async () => {
    const double = makeScene();
    const decode: ImageDecoder = () => Promise.reject(new Error('404'));

    const result = await loadArt(scene(double), ['animals/nope'], decode);

    expect(result).toEqual({ loaded: [], failed: ['animals/nope'] });
    expect(hasArt(scene(double), 'animals/nope')).toBe(false);
  });

  it('retries a failed key on the next call (failure is not cached forever)', async () => {
    const double = makeScene();
    const failing: ImageDecoder = () => Promise.reject(new Error('offline'));
    await loadArt(scene(double), ['animals/cat'], failing);

    const decode = vi.fn<ImageDecoder>(() => Promise.resolve({}));
    const retry = await loadArt(scene(double), ['animals/cat'], decode);

    expect(decode).toHaveBeenCalledTimes(1);
    expect(retry.loaded).toEqual(['animals/cat']);
  });

  it('survives a decoder that returns nothing', async () => {
    const double = makeScene();
    const result = await loadArt(scene(double), ['animals/cat'], () => Promise.resolve(null));
    expect(result).toEqual({ loaded: [], failed: ['animals/cat'] });
  });

  it('survives a decoder that throws synchronously', async () => {
    const double = makeScene();
    const result = await loadArt(scene(double), ['animals/cat'], () => {
      throw new Error('no Image constructor');
    });
    expect(result).toEqual({ loaded: [], failed: ['animals/cat'] });
  });

  it('survives textures.addImage throwing', async () => {
    const double = makeScene();
    double.textures.addImage = (): void => {
      throw new Error('texture manager torn down');
    };
    const result = await loadArt(scene(double), ['animals/cat'], () => Promise.resolve({}));
    expect(result.failed).toEqual(['animals/cat']);
  });

  it('reports per-key outcomes for a mixed batch', async () => {
    const double = makeScene();
    const decode: ImageDecoder = (url) =>
      url.includes('apple') ? Promise.reject(new Error('404')) : Promise.resolve({});

    const result = await loadArt(scene(double), ['animals/cat', 'food/apple'], decode);

    expect(result.loaded).toEqual(['animals/cat']);
    expect(result.failed).toEqual(['food/apple']);
  });
});

describe('loadArt — scene shutdown race', () => {
  it('resolves as failed when the scene shuts down mid-flight', async () => {
    const double = makeScene();
    const pending = loadArt(scene(double), ['animals/cat'], neverDecodes);
    double.events.shutdown();
    expect(await pending).toEqual({ loaded: [], failed: ['animals/cat'] });
  });

  it('detaches its shutdown listener after a successful load', async () => {
    const double = makeScene();
    const off = vi.spyOn(double.events, 'off');
    await loadArt(scene(double), ['animals/cat'], () => Promise.resolve({}));
    expect(off).toHaveBeenCalledWith('shutdown', expect.any(Function));
  });
});
