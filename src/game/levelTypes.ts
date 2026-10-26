/**
 * Level contract — mirrors docs/SPEC.md ("Level JSON Contract").
 * This is the FROZEN shape. Do not add fields without a spec change.
 */

export const MECHANICS = ['letter_drag', 'syllable_tap', 'compound', 'affix'] as const;

export type Mechanic = (typeof MECHANICS)[number];

export const TIERS = [1, 2, 3, 4, 5] as const;

export type Tier = (typeof TIERS)[number];

/** Schema version of `src/data/levels/manifest.json`. Bump on a breaking change. */
export const MANIFEST_VERSION = 2 as const;

export interface Level {
  id: string;
  tier: Tier;
  /** Uppercase target spelling, e.g. "CAT" / "BUTTERFLY". */
  word: string;
  /** Lowercase display form. */
  display: string;
  /** Reserved for future Indonesian gloss. */
  meaning_id: string;
  category: string;
  mechanic: Mechanic;
  /** Atlas frame key, never a file path with extension. */
  image: string;
  /** Atlas audio key, never a file path with extension. */
  audio_word: string;
  audio_phonemes: string[];
  /** Shuffled-ready source pool. The engine shuffles at runtime. */
  tiles: string[];
  distractors: string[];
  /** Only used by syllable_tap / compound / affix. */
  chunks: string[] | null;
  hint: string;
  ghost_letters: boolean;
}

/**
 * One row of `src/data/levels/manifest.json` (schema version 2).
 *
 * The manifest is the ONLY level data imported synchronously: it holds the
 * display metadata the Menu, Progress and Wordbook overview need and nothing
 * puzzle-specific (tiles, phonemes, hints), so it stays small as levels grow.
 * The full puzzle for an entry lives in its own file under `file`.
 */
export interface LevelManifestEntry {
  id: string;
  tier: Tier;
  /** Uppercase target spelling, e.g. "CAT". */
  word: string;
  display: string;
  meaning_id: string;
  category: string;
  mechanic: Mechanic;
  /** Path under `src/data/levels/`, e.g. `tier-1/lvl_0001_cat.json`. */
  file: string;
}

export interface LevelManifest {
  version: number;
  levels: LevelManifestEntry[];
}

/** Thrown by the loader with a human-readable, level-scoped message. */
export class LevelContractError extends Error {
  readonly levelId: string | null;
  readonly field: string | null;

  constructor(message: string, levelId: string | null = null, field: string | null = null) {
    super(message);
    this.name = 'LevelContractError';
    this.levelId = levelId;
    this.field = field;
  }
}
