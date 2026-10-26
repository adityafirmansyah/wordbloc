import rawManifest from '../data/levels/manifest.json';
import {
  LevelContractError,
  type Level,
  type LevelManifest,
  type LevelManifestEntry,
  type Tier,
} from './levelTypes';
import { parseLevel, parseLevelManifest } from './levelLoader';

/**
 * Level catalogue: a synchronously-available manifest plus lazily-imported
 * per-level puzzle files.
 *
 * Why not one levels.json (the v1 shape)? A single file forces every player to
 * download every level — 30 today, hundreds later — and makes one level's edit a
 * whole-file diff. Here:
 *
 *   manifest.json            ~1 line per level, imported synchronously
 *   tier-N/<id>_<word>.json  the full puzzle, its own Vite chunk
 *
 * Menu, Progress and Wordbook read the manifest only; the GameScene awaits
 * `loadLevel(id)`, which pulls down that one chunk. Adding a level is a new file
 * plus one manifest row, and nothing else re-downloads.
 */

/** Map of `../data/levels/<file>` -> dynamic import, as produced by the glob. */
export type LevelModuleMap = Record<string, () => Promise<unknown>>;

/** Directory prefix the manifest's `file` values are relative to. */
const LEVELS_DIR = '../data/levels/';

/**
 * Every level file as a lazy import. Vite turns EACH match into its own chunk,
 * so the glob is a compile-time index — no request is made until one is called.
 */
const levelModules = import.meta.glob<Record<string, unknown>>(
  '../data/levels/tier-*/*.json',
) as LevelModuleMap;

export interface LevelCatalog {
  manifest(): LevelManifest;
  entryById(id: string): LevelManifestEntry | undefined;
  indexOf(id: string): number;
  count(): number;
  entriesByTier(): Map<Tier, LevelManifestEntry[]>;
  nextEntry(id: string): LevelManifestEntry | null;
  /** Manifest rows whose file is not in the bundle. Empty when data is sound. */
  missingFiles(): string[];
  /** Parsed levels currently held in memory. */
  cachedIds(): string[];
  /** Drops the cache (tests / hot reload). */
  clearCache(): void;
  loadLevel(id: string): Promise<Level>;
  preloadLevel(id: string): Promise<void>;
}

/** Pulls the JSON payload out of an ES module namespace. */
function moduleValue(namespace: unknown): Record<string, unknown> {
  if (typeof namespace !== 'object' || namespace === null) return {};
  const withDefault = namespace as { default?: unknown };
  const value = withDefault.default ?? namespace;
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Builds a catalogue over an explicit module map. The app uses the singleton at
 * the bottom of this file; tests inject their own map to exercise missing files
 * and malformed payloads without touching the real data.
 */
export function createLevelCatalog(rawManifest: unknown, modules: LevelModuleMap): LevelCatalog {
  let validated: LevelManifest | null = null;
  const cache = new Map<string, Level>();
  const inFlight = new Map<string, Promise<Level>>();

  const manifest = (): LevelManifest => {
    validated ??= parseLevelManifest(rawManifest);
    return validated;
  };

  const entryById = (id: string): LevelManifestEntry | undefined =>
    manifest().levels.find((entry) => entry.id === id);

  const indexOf = (id: string): number => manifest().levels.findIndex((entry) => entry.id === id);

  const entriesByTier = (): Map<Tier, LevelManifestEntry[]> => {
    const map = new Map<Tier, LevelManifestEntry[]>();
    for (const entry of manifest().levels) {
      const list = map.get(entry.tier) ?? [];
      list.push(entry);
      map.set(entry.tier, list);
    }
    return map;
  };

  const nextEntry = (id: string): LevelManifestEntry | null => {
    const index = indexOf(id);
    if (index === -1) return null;
    return manifest().levels[index + 1] ?? null;
  };

  const missingFiles = (): string[] =>
    manifest()
      .levels.filter((entry) => modules[LEVELS_DIR + entry.file] === undefined)
      .map((entry) => entry.file);

  const loadLevel = (id: string): Promise<Level> => {
    const cached = cache.get(id);
    if (cached) return Promise.resolve(cached);

    const pending = inFlight.get(id);
    if (pending) return pending;

    const entry = entryById(id);
    if (!entry) {
      return Promise.reject(
        new LevelContractError(`Unknown level id "${id}" — not present in the manifest.`, id, 'id'),
      );
    }

    const load = modules[LEVELS_DIR + entry.file];
    if (!load) {
      return Promise.reject(
        new LevelContractError(
          `Level "${id}" points at "${entry.file}", which is not in the bundle.`,
          id,
          'file',
        ),
      );
    }

    const task = (async (): Promise<Level> => {
      let namespace: unknown;
      try {
        namespace = await load();
      } catch (error) {
        throw new LevelContractError(
          `Level "${id}" could not be loaded from "${entry.file}": ` +
            (error instanceof Error ? error.message : String(error)),
          id,
          'file',
        );
      }

      const raw = moduleValue(namespace);
      // The level's own file must agree with the manifest row that pointed here,
      // otherwise a rename/copy-paste silently serves the wrong word.
      for (const field of ['id', 'tier', 'word', 'display', 'mechanic'] as const) {
        if (raw[field] !== undefined && raw[field] !== entry[field]) {
          throw new LevelContractError(
            `Level "${id}" disagrees with the manifest on "${field}": ` +
              `file has ${JSON.stringify(raw[field])}, manifest has ` +
              `${JSON.stringify(entry[field])}.`,
            id,
            field,
          );
        }
      }

      const level = parseLevel(raw, indexOf(id));
      if (level.id !== entry.id) {
        throw new LevelContractError(
          `Level file "${entry.file}" parsed as "${level.id}" but the manifest claims "${id}".`,
          id,
          'id',
        );
      }
      cache.set(id, level);
      return level;
    })();

    inFlight.set(id, task);
    // Drop the in-flight entry once settled — a rejection in particular must not
    // be replayed to every later caller instead of reporting the error again.
    const forget = (): void => {
      inFlight.delete(id);
    };
    void task.then(forget, forget);
    return task;
  };

  /**
   * Warms the chunk for `id` without ever throwing: a failed prefetch must not
   * break the scene that asked for it — the next `loadLevel` reports the error.
   */
  const preloadLevel = async (id: string): Promise<void> => {
    try {
      await loadLevel(id);
    } catch {
      // Intentionally swallowed; see doc comment.
    }
  };

  return {
    manifest,
    entryById,
    indexOf,
    count: () => manifest().levels.length,
    entriesByTier,
    nextEntry,
    missingFiles,
    cachedIds: () => [...cache.keys()],
    clearCache: () => {
      cache.clear();
      inFlight.clear();
    },
    loadLevel,
    preloadLevel,
  };
}

/**
 * App-wide catalogue. Built lazily so a malformed manifest surfaces inside
 * main.ts's try/catch (readable boot-failure panel) instead of as a module
 * evaluation error before the panel exists.
 */
let shared: LevelCatalog | null = null;

export function levelCatalog(): LevelCatalog {
  shared ??= createLevelCatalog(rawManifest, levelModules);
  return shared;
}

// ------------------------------------------------------------ manifest helpers
// Synchronous, manifest-only: safe for Menu / Progress / Wordbook rendering.

export function levelManifest(): LevelManifest {
  return levelCatalog().manifest();
}

export function manifestEntryById(id: string): LevelManifestEntry | undefined {
  return levelCatalog().entryById(id);
}

export function manifestIndexOf(id: string): number {
  return levelCatalog().indexOf(id);
}

export function manifestCount(): number {
  return levelCatalog().count();
}

export function manifestEntriesByTier(): Map<Tier, LevelManifestEntry[]> {
  return levelCatalog().entriesByTier();
}

export function nextLevelManifest(id: string): LevelManifestEntry | null {
  return levelCatalog().nextEntry(id);
}

/** Manifest rows with no bundled file. Should always be empty. */
export function manifestMissingFiles(): string[] {
  return levelCatalog().missingFiles();
}

// ------------------------------------------------------------- lazy level data

/** Loads (and caches) one level's full puzzle. */
export function loadLevel(id: string): Promise<Level> {
  return levelCatalog().loadLevel(id);
}

/** Warms one level's chunk in the background. Never rejects. */
export function preloadLevel(id: string): Promise<void> {
  return levelCatalog().preloadLevel(id);
}

/** Ids of levels already decoded into memory. */
export function cachedLevelIds(): string[] {
  return levelCatalog().cachedIds();
}

export function clearLevelCache(): void {
  levelCatalog().clearCache();
}

/**
 * Boot-time integrity check: valid manifest AND a bundled file behind every row.
 * Deliberately does NOT import the level files — validating all of them at boot
 * would undo the lazy loading. `tests/levels.data.test.ts` is what proves every
 * file parses.
 */
export function assertCatalogData(catalog: LevelCatalog): LevelManifest {
  const manifest = catalog.manifest();
  const missing = catalog.missingFiles();
  if (missing.length > 0) {
    throw new LevelContractError(
      `Level manifest references missing files: ${missing.join(', ')}.`,
      null,
      'file',
    );
  }
  return manifest;
}

/** Same check against the app catalogue. */
export function assertLevelData(): LevelManifest {
  return assertCatalogData(levelCatalog());
}
