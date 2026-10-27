/**
 * Static asset layer — the ONE place that knows where a real art/audio file lives.
 *
 * The level data keeps using atlas/key refs (docs/SPEC.md: "Paths in `image`/
 * `audio_*` are atlas/key refs, never file extensions"), e.g. `animals/cat` and
 * `phonemes/k`. This module turns those refs into URLs under `public/assets/`:
 *
 *   image key `animals/cat`  -> assets/images/animals/cat.webp   (512x512, transparent)
 *   audio key `words/cat`    -> assets/audio/words/cat.mp3       (-23 LUFS normalised)
 *   audio key `phonemes/k`   -> assets/audio/phonemes/k.mp3
 *
 * Nothing else in `src/` hardcodes a file path, so the pack can be re-nested or
 * moved behind a CDN by editing this file alone.
 *
 * URL shape: Vite copies `public/` verbatim into `dist/`, so `assets/...` is
 * already the deployed path. `import.meta.env.BASE_URL` is folded in so a
 * `base` other than `./` (sub-path deploy) keeps working; for the shipped
 * `base: './'` it contributes nothing and the URLs stay page-relative.
 */

/** Directory under `public/` (mirrored to the site root at build time). */
export const ASSET_DIR = 'assets';

/** Vite's configured base, normalised to '' or 'x/' with no `./`. */
function normalizeBase(base: string | undefined): string {
  if (!base || base === './' || base === '.') return '';
  return base.endsWith('/') ? base : `${base}/`;
}

/**
 * `assets/` (base `./`) or `/sub/assets/` (base `/sub/`), always trailing-slashed.
 * Exported for the asset tests and for preloading hints.
 */
export const ASSET_BASE = `${normalizeBase(import.meta.env.BASE_URL)}${ASSET_DIR}/`;

/** Joins the asset base with a pack-relative path. */
export function assetUrl(path: string): string {
  const clean = path.replace(/^\/+/, '');
  if (clean === '') {
    throw new Error('WordBloc assets: assetUrl() needs a non-empty pack-relative path.');
  }
  return `${ASSET_BASE}${clean}`;
}

/**
 * URL for a level's illustration. `imageKey` is a level `image` ref such as
 * `animals/cat` — never a path, never an extension.
 */
export function imageUrl(imageKey: string): string {
  return assetUrl(`images/${requireKey(imageKey)}.webp`);
}

/** URL for a word or phoneme clip. `key` is an `audio_*` ref such as `words/cat`. */
export function audioUrl(key: string): string {
  return assetUrl(`audio/${requireKey(key)}.mp3`);
}

/**
 * Phaser texture key for an illustration. Namespaced (`art/animals/cat`) so a
 * loaded sticker can never collide with a generated UI-atlas frame (`tile_w3`).
 */
export function textureKey(imageKey: string): string {
  return `art/${requireKey(imageKey)}`;
}

/**
 * The `image` ref implied by a manifest row / wordbook entry.
 *
 * The manifest deliberately does NOT carry an `image` field (its schema is
 * frozen at version 2, docs/SPEC.md) so the derive rule `category/display` is the
 * contract between a manifest row and its illustration — `tests/assets.test.ts`
 * proves every level file agrees with it.
 */
export function imageKeyFor(category: string, display: string): string {
  return `${requireKey(category, 'category')}/${requireKey(display, 'display')}`;
}

/**
 * Rejects refs that cannot be a pack key: empty, absolute, traversal, or already
 * carrying an extension (the classic `cat.webp` -> `cat.webp.webp`).
 */
function requireKey(key: string, field = 'key'): string {
  const value = typeof key === 'string' ? key.trim() : '';
  const valid =
    value !== '' &&
    !value.startsWith('/') &&
    !value.includes('..') &&
    !/\.(webp|mp3|png|jpg|jpeg|wav|ogg)$/i.test(value);
  if (!valid) {
    throw new Error(
      `WordBloc assets: "${key}" is not a valid asset ${field}. ` +
        'Expected a pack ref like "animals/cat" or "phonemes/k" (no leading slash, ' +
        'no "..", no file extension).',
    );
  }
  return value;
}
