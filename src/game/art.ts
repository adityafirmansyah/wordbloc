/**
 * Illustration loader — pulls a level's WebP sticker into Phaser's texture cache.
 *
 * The stickers are 512x512 transparent WebP (18-40 KB each, 30 in the pack), so
 * they are deliberately NOT part of a boot load: a scene asks for the ONE key it
 * is about to draw, and every request is deduped for that scene's lifetime.
 *
 * WHY NOT `Phaser.Loader`? The loader is a per-scene state machine that only
 * auto-starts inside `preload()`; adding a file from `create()` — or later, when a
 * level chunk arrives — means calling `start()` by hand and re-entering its queue.
 * Scenes here draw their art asynchronously, long after boot, and the
 * illustrations are same-origin static files, so one `Image` + `textures.addImage`
 * is the smaller, race-free mechanism.
 *
 * A failure is reported, never thrown: the caller keeps its procedural placeholder,
 * so a broken or missing sticker cannot take a level down (docs/SPEC.md "Hard
 * Constraints": the game stays playable and logs no console errors).
 *
 * Key namespace: textures are registered as `art/<category>/<word>` (see
 * `assets.textureKey`), so a sticker can never collide with the generated UI atlas
 * frames (`tile_w3`, `panel`, ...) that share the same TextureManager.
 */

import type Phaser from 'phaser';
import { imageUrl, textureKey } from './assets';

export interface ArtLoadResult {
  /** Keys whose texture is available in the cache when the promise resolves. */
  loaded: string[];
  /** Keys the network/decoder rejected. Scenes must fall back for these. */
  failed: string[];
}

/**
 * Decodes one image URL. Resolves with whatever `textures.addImage` accepts as a
 * source (an HTMLImageElement in the browser, a canvas in tests), or rejects /
 * resolves null when the file cannot be used.
 */
export type ImageDecoder = (url: string) => Promise<unknown>;

/** Default decoder: an HTMLImageElement, decoded off the main thread when possible. */
export function decodeImageElement(url: string): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      resolve(img);
    };
    img.onerror = () => {
      reject(new Error(`WordBloc art: could not load ${url}`));
    };
    img.src = url;
  });
}

/**
 * Per-scene in-flight map, so two widgets asking for the same sticker share one
 * request instead of queueing the file twice. Weak so a destroyed scene's entry
 * disappears with it.
 */
const inFlight = new WeakMap<Phaser.Scene, Map<string, Promise<boolean>>>();

/** True when the sticker for `imageKey` is already decodable in this scene. */
export function hasArt(scene: Phaser.Scene, imageKey: string): boolean {
  if (!imageKey) return false;
  try {
    return scene.textures.exists(textureKey(imageKey));
  } catch {
    return false;
  }
}

/** Texture key to hand to `scene.add.image()` for `imageKey`. */
export function artTextureKey(imageKey: string): string {
  return textureKey(imageKey);
}

/**
 * Loads every `imageKeys` entry that is not already cached and resolves once each
 * one has either arrived or failed. Safe to call repeatedly and concurrently.
 * Never rejects.
 */
export function loadArt(
  scene: Phaser.Scene,
  imageKeys: readonly string[],
  decode: ImageDecoder = decodeImageElement,
): Promise<ArtLoadResult> {
  const wanted = [...new Set(imageKeys.filter((key) => typeof key === 'string' && key !== ''))];
  const pending = wanted.filter((key) => !hasArt(scene, key));

  if (pending.length === 0) {
    return Promise.resolve({ loaded: [], failed: [] });
  }

  const perScene = inFlight.get(scene) ?? new Map<string, Promise<boolean>>();
  inFlight.set(scene, perScene);

  const tasks = pending.map((key) => {
    const existing = perScene.get(key);
    if (existing) return existing;
    const task = loadOne(scene, key, decode);
    perScene.set(key, task);
    const forget = (): void => {
      perScene.delete(key);
    };
    void task.then(forget, forget);
    return task;
  });

  return Promise.all(tasks).then((results) => {
    const loaded: string[] = [];
    const failed: string[] = [];
    results.forEach((ok, index) => {
      const key = pending[index];
      if (key === undefined) return;
      (ok ? loaded : failed).push(key);
    });
    return { loaded, failed };
  });
}

/** One image file -> resolve(true) once it is in the texture cache. */
async function loadOne(
  scene: Phaser.Scene,
  imageKey: string,
  decode: ImageDecoder,
): Promise<boolean> {
  const key = textureKey(imageKey);
  if (hasArt(scene, imageKey)) return true;

  // A scene that shuts down mid-flight must not leave the caller awaiting
  // forever: the decode is raced against the scene's SHUTDOWN event.
  let onShutdown: (() => void) | null = null;
  const shutdown = new Promise<null>((resolve) => {
    onShutdown = () => resolve(null);
    try {
      scene.events.once('shutdown', onShutdown);
    } catch {
      resolve(null);
    }
  });

  try {
    const source = await Promise.race([decode(imageUrl(imageKey)), shutdown]);
    if (source === null || source === undefined) return false;
    if (hasArt(scene, imageKey)) return true;
    scene.textures.addImage(key, source as HTMLImageElement);
    return scene.textures.exists(key);
  } catch {
    return false;
  } finally {
    if (onShutdown) {
      try {
        scene.events.off('shutdown', onShutdown);
      } catch {
        // scene already gone — nothing to detach
      }
    }
  }
}
