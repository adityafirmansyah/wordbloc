import { describe, expect, it } from 'vitest';
import {
  ASSET_BASE,
  assetUrl,
  audioUrl,
  imageKeyFor,
  imageUrl,
  textureKey,
} from '../src/game/assets';
import {
  buildTray,
  isPuzzleComplete,
  resolveDrop,
  targetUnits,
  type TrayItem,
} from '../src/game/puzzle';
import { levelManifest, loadLevel } from '../src/game/levels';
import { SILENT_PHONEME, audioKeysForLevel } from '../src/game/audio';
import type { Level } from '../src/game/levelTypes';

/**
 * Asset-layer suite: proves the code's ref -> file mapping matches the deliverable
 * pack that now lives in `public/assets/`.
 *
 * The pack (30 WebP stickers + 80 MP3 clips) was produced outside this repo and
 * verified separately (`wordbloc-assets/VERIFICATION.md`). What this suite pins is
 * the JOIN between the two: every `image`/`audio_*` ref in every level file must
 * resolve to a path that exists, and the two surfaces that only have a manifest row
 * (Wordbook cards, and Reward's `words/<display>` fallback) must derive the same
 * keys the file-based loader uses.
 *
 * File EXISTENCE is checked directly on disk with node:fs — a unit test that only
 * compared strings would cheerfully pass against an empty public/ directory.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Vitest's jsdom environment gives `import.meta.url` an http-ish URL, so the repo
 * root comes from the runner's cwd instead (vitest is always invoked from the
 * package root — `tests/` and `public/` are siblings there).
 */
const REPO_ROOT = process.cwd();
const PUBLIC_DIR = join(REPO_ROOT, 'public');

/** Every level, loaded through the real lazy catalogue. */
const levelsPromise: Promise<Level[]> = levelManifest().levels.reduce<Promise<Level[]>>(
  async (accPromise, entry) => {
    const acc = await accPromise;
    acc.push(await loadLevel(entry.id));
    return acc;
  },
  Promise.resolve([]),
);

const EXPECTED_IMAGES = 30;
const EXPECTED_WORDS = 30;
const EXPECTED_PHONEMES = 50;

describe('asset URL construction', () => {
  it('builds the documented pack layout', () => {
    expect(ASSET_BASE.endsWith('assets/')).toBe(true);
    expect(imageUrl('animals/cat')).toMatch(/assets\/images\/animals\/cat\.webp$/);
    expect(audioUrl('words/cat')).toMatch(/assets\/audio\/words\/cat\.mp3$/);
    expect(audioUrl('phonemes/k')).toMatch(/assets\/audio\/phonemes\/k\.mp3$/);
  });

  it('puts exactly one extension on a key', () => {
    // The classic defect: a key that already carries its extension.
    expect(imageUrl('animals/cat')).not.toMatch(/\.webp\.webp$/);
    expect(audioUrl('words/cat')).not.toMatch(/\.mp3\.mp3$/);
  });

  it('namespaces texture keys so stickers cannot shadow atlas frames', () => {
    expect(textureKey('animals/cat')).toBe('art/animals/cat');
    for (const frame of ['tile_w3', 'panel', 'card', 'dot', 'lock']) {
      expect(textureKey('animals/cat')).not.toBe(frame);
    }
  });

  it('rejects refs that are not pack keys', () => {
    for (const bad of ['', ' ', '/animals/cat', '../secret', 'animals/cat.webp', 'cat.mp3']) {
      expect(() => imageUrl(bad), JSON.stringify(bad)).toThrow(/not a valid asset/);
    }
    expect(() => assetUrl('')).toThrow(/non-empty/);
  });

  it('derives the Wordbook image key from a manifest row', () => {
    // The manifest schema is frozen at v2 (no `image` field), so `category/display`
    // IS the contract. Proven against every level file below.
    expect(imageKeyFor('animals', 'cat')).toBe('animals/cat');
    expect(imageKeyFor('feelings', 'unhappy')).toBe('feelings/unhappy');
  });
});

describe('the pack on disk (public/assets/)', () => {
  it('ships exactly 30 webp illustrations', () => {
    const files = walk(join(PUBLIC_DIR, 'assets/images')).filter((f) => f.endsWith('.webp'));
    expect(files).toHaveLength(EXPECTED_IMAGES);
  });

  it('ships exactly 30 word clips and 50 phoneme clips', () => {
    const words = readdirSync(join(PUBLIC_DIR, 'assets/audio/words')).filter((f) =>
      f.endsWith('.mp3'),
    );
    const phonemes = readdirSync(join(PUBLIC_DIR, 'assets/audio/phonemes')).filter((f) =>
      f.endsWith('.mp3'),
    );
    expect(words).toHaveLength(EXPECTED_WORDS);
    expect(phonemes).toHaveLength(EXPECTED_PHONEMES);
  });

  it('ships NO silent.mp3 (the silent key must resolve without a request)', () => {
    expect(existsSync(join(PUBLIC_DIR, 'assets/audio/phonemes/silent.mp3'))).toBe(false);
  });

  it('every illustration is a 512x512 WebP under the 40 KB budget', () => {
    const files = walk(join(PUBLIC_DIR, 'assets/images')).filter((f) => f.endsWith('.webp'));
    for (const file of files) {
      const bytes = readFileSync(join(PUBLIC_DIR, 'assets/images', file));
      // RIFF....WEBP — a truncated/misnamed file would fail here.
      expect(bytes.toString('ascii', 0, 4), file).toBe('RIFF');
      expect(bytes.toString('ascii', 8, 12), file).toBe('WEBP');
      // VP8X extended header: canvas width-1 / height-1 as 24-bit LE at 24..29.
      expect(bytes.toString('ascii', 12, 16), file).toBe('VP8X');
      const width = 1 + ((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16));
      const height = 1 + ((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16));
      expect([width, height], file).toEqual([512, 512]);
      expect(bytes.length, file).toBeLessThan(40 * 1024);
    }
  });

  it('keeps the whole payload under 2 MB (a single phone download)', () => {
    const total = walk(join(PUBLIC_DIR, 'assets')).reduce(
      (sum, file) => sum + statSync(join(PUBLIC_DIR, 'assets', file)).size,
      0,
    );
    expect(total).toBeLessThan(2 * 1024 * 1024);
  });
});

describe('every level ref resolves to a real file', () => {
  it('illustration keys all exist', async () => {
    const levels = await levelsPromise;
    const missing = levels
      .map((level) => level.image)
      .filter((key) => !existsSync(join(PUBLIC_DIR, 'assets', `images/${key}.webp`)));
    expect(missing).toEqual([]);
  });

  it('word audio keys all exist', async () => {
    const levels = await levelsPromise;
    const missing = levels
      .map((level) => level.audio_word)
      .filter((key) => !existsSync(join(PUBLIC_DIR, 'assets', `audio/${key}.mp3`)));
    expect(missing).toEqual([]);
  });

  it('every phoneme key exists, except the explicit silent marker', async () => {
    const levels = await levelsPromise;
    const keys = new Set<string>();
    for (const level of levels) for (const key of level.audio_phonemes) keys.add(key);

    const missing = [...keys].filter(
      (key) =>
        key !== SILENT_PHONEME && !existsSync(join(PUBLIC_DIR, 'assets', `audio/${key}.mp3`)),
    );
    expect(missing).toEqual([]);
    // And the silent marker is genuinely used by real levels, so it is not dead code.
    expect(keys.has(SILENT_PHONEME)).toBe(true);
  });

  it('the manifest-only derive rule matches every level file (Wordbook cards)', async () => {
    const levels = await levelsPromise;
    const mismatched = levels
      .map((level) => ({
        id: level.id,
        file: level.image,
        manifest: imageKeyFor(level.category, level.display),
      }))
      .filter((row) => row.file !== row.manifest);
    expect(mismatched).toEqual([]);
  });

  it('the Reward fallback key `words/<display>` is a real file', async () => {
    const levels = await levelsPromise;
    const fallback = levels.map((level) => `words/${level.display}`);
    for (const key of fallback) {
      expect(existsSync(join(PUBLIC_DIR, 'assets', `audio/${key}.mp3`)), key).toBe(true);
    }
  });

  it('no staged clip is orphaned (every file is referenced by a level)', async () => {
    const levels = await levelsPromise;
    const referencedWords = new Set(levels.map((level) => level.audio_word));
    const referencedPhonemes = new Set(levels.flatMap((level) => level.audio_phonemes));

    const orphanWords = readdirSync(join(PUBLIC_DIR, 'assets/audio/words'))
      .filter((f) => f.endsWith('.mp3'))
      .map((f) => `words/${f.replace(/\.mp3$/, '')}`)
      .filter((key) => !referencedWords.has(key));

    const orphanPhonemes = readdirSync(join(PUBLIC_DIR, 'assets/audio/phonemes'))
      .filter((f) => f.endsWith('.mp3'))
      .map((f) => `phonemes/${f.replace(/\.mp3$/, '')}`)
      .filter((key) => !referencedPhonemes.has(key));

    expect({ orphanWords, orphanPhonemes }).toEqual({ orphanWords: [], orphanPhonemes: [] });
  });
});

describe('every level is playable with its real assets', () => {
  it('preloads the word clip plus one clip per slot, and one per slot no more', async () => {
    const levels = await levelsPromise;
    for (const level of levels) {
      const keys = audioKeysForLevel(level);
      const units = targetUnits(level);
      const spokenSlots = units.filter((unit) => unit.phoneme !== SILENT_PHONEME);

      // Word first: it is what plays on arrival.
      expect(keys[0], level.id).toBe(level.audio_word);
      // Then each distinct non-silent phoneme exactly once.
      const expected = [level.audio_word, ...new Set(spokenSlots.map((unit) => unit.phoneme))];
      expect(keys, level.id).toEqual(expected);
      expect(keys, level.id).not.toContain(SILENT_PHONEME);
    }
  });

  it('the tray can still spell the word after the asset swap (assets changed nothing)', async () => {
    const levels = await levelsPromise;
    for (const level of levels) {
      // The tray is the multiset of tiles+distractors; each target unit must be
      // drawable from it (the loader already proves this per level, so this is the
      // end-to-end guard that the asset work did not touch puzzle data).
      const tray: TrayItem[] = buildTray(level);
      const pool = tray.map((item) => item.unit);
      const filled: (string | null)[] = targetUnits(level).map(() => null);

      for (const [index, target] of targetUnits(level).entries()) {
        const at = pool.indexOf(target.unit);
        expect(at, `${level.id} slot ${index} (${target.unit})`).toBeGreaterThanOrEqual(0);
        pool.splice(at, 1);

        const result = resolveDrop(level, target.unit, index, filled);
        expect(result.snapTo, `${level.id} slot ${index}`).not.toBeNull();
        filled[index] = target.unit;
      }
      expect(isPuzzleComplete(level, filled), level.id).toBe(true);
    }
  });
});

/** Recursive file listing, relative to `dir`. */
function walk(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}
