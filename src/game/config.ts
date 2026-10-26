import Phaser from 'phaser';
import { BootScene } from '../scenes/BootScene';
import { MenuScene } from '../scenes/MenuScene';
import { GameScene } from '../scenes/GameScene';
import { RewardScene } from '../scenes/RewardScene';
import { WordbookScene } from '../scenes/WordbookScene';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from './theme';

/**
 * Phaser.AUTO = WebGL with Canvas2D fallback (required for low-spec Android).
 * Scale.FIT + CENTER_BOTH keeps the 1280x720 design space letterboxed on any
 * viewport; touch targets are sized to stay >= 64 CSS px at the smallest
 * supported viewport (see theme.ts touch-target math).
 */
export function createGameConfig(parent: HTMLElement): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#9adaff',
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: DESIGN_WIDTH,
      height: DESIGN_HEIGHT,
    },
    render: {
      antialias: true,
      // Keep the pixel budget low for 2GB-RAM Android devices.
      powerPreference: 'default',
      roundPixels: true,
    },
    dom: { createContainer: false },
    audio: { disableWebAudio: false, noAudio: false },
    scene: [BootScene, MenuScene, GameScene, RewardScene, WordbookScene],
  };
}
