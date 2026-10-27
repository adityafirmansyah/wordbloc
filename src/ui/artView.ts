/**
 * `makeArtView` — one Phaser image that shows a soft placeholder immediately and
 * swaps itself to the real illustration once the WebP arrives.
 *
 * Two reasons this is a shared helper instead of a line in each scene:
 *   1. Scenes must never block on art. The board/tray/cards draw first and the
 *      sticker drops in; a failed sticker leaves a tidy placeholder rather than a
 *      green "missing texture" box.
 *   2. Square-ness is a property of the PACK (512x512 transparent WebP), so the
 *      display size is written once, here, on every swap. Scenes only say "180px
 *      sticker for animals/cat".
 *
 * The returned promise never rejects and resolves `true` only when the real
 * texture is showing, so callers can assert on it in tests and browser probes.
 */

import type Phaser from 'phaser';
import { loadArt, hasArt, artTextureKey } from '../game/art';
import { ATLAS_KEY, FRAMES } from '../game/theme';

export interface ArtViewOptions {
  x: number;
  y: number;
  /** Display size in design px (square). */
  size: number;
  /** Level `image` ref, e.g. `animals/cat`. Empty => permanent placeholder. */
  imageKey: string;
  /** Placeholder frame from the UI atlas (defaults to the soft panel card). */
  placeholderFrame?: string;
  /** Injected decoder for tests; production uses an HTMLImageElement. */
  decode?: (url: string) => Promise<unknown>;
}

export interface ArtView {
  image: Phaser.GameObjects.Image;
  /** True once the REAL sticker is displayed. Never rejects. */
  ready: Promise<boolean>;
}

export function makeArtView(scene: Phaser.Scene, opts: ArtViewOptions): ArtView {
  const { x, y, size, imageKey } = opts;
  const image = scene.add
    .image(x, y, ATLAS_KEY, opts.placeholderFrame ?? FRAMES.card)
    .setDisplaySize(size, size);

  if (!imageKey) return { image, ready: Promise.resolve(false) };

  const show = (): void => {
    if (!hasArt(scene, imageKey)) return;
    image.setTexture(artTextureKey(imageKey));
    // Texture swap resets the display size to the raw 512px source, so re-apply.
    image.setDisplaySize(size, size);
  };

  if (hasArt(scene, imageKey)) {
    show();
    return { image, ready: Promise.resolve(true) };
  }

  const ready = loadArt(scene, [imageKey], opts.decode).then((result) => {
    if (result.loaded.includes(imageKey) && image.active) {
      show();
      return hasArt(scene, imageKey);
    }
    return false;
  });

  return { image, ready };
}
