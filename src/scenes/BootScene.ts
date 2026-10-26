import Phaser from 'phaser';
import { buildUiAtlas } from '../game/uiAtlas';
import { allLevels } from '../game/levels';
import { SCENES } from '../game/theme';

/**
 * Boot: builds the procedural UI atlas (ONE texture, all frames), pre-warms
 * the level pack, then hands off to Menu. No external image is ever loaded.
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

    // Validate + warm the level pack before any scene needs it.
    const levels = allLevels();
    this.registry.set('levelCount', levels.length);

    this.scene.start(SCENES.menu);
  }
}
