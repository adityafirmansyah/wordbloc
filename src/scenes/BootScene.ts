import Phaser from 'phaser';
import { buildUiAtlas } from '../game/uiAtlas';
import { assertLevelData, manifestCount } from '../game/levels';
import { SCENES } from '../game/theme';

/**
 * Boot: builds the procedural UI atlas (ONE texture, all frames), validates the
 * level manifest, then hands off to Menu. No external image is ever loaded.
 *
 * Level PUZZLES are NOT loaded here — each one is its own lazily-imported chunk.
 * Boot only proves the manifest is valid and that every row has a file behind it.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SCENES.boot);
  }

  preload(): void {
    // Intentionally empty: v1 loads ZERO per-file images.
    // A single generated atlas is built in create().
  }

  create(): void {
    buildUiAtlas(this);

    // Manifest validity + file coverage, without pulling any puzzle down.
    assertLevelData();
    this.registry.set('levelCount', manifestCount());

    this.scene.start(SCENES.menu);
  }
}
