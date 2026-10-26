import Phaser from 'phaser';
import { BootScene } from '../scenes/BootScene';
import { MenuScene } from '../scenes/MenuScene';
import { GameScene } from '../scenes/GameScene';
import { RewardScene } from '../scenes/RewardScene';
import { WordbookScene } from '../scenes/WordbookScene';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from './theme';

/**
 * Phaser.AUTO = WebGL with Canvas2D fallback (required for low-spec Android).
 *
 * Scale.RESIZE (not FIT): the canvas is sized to its parent (#game is 100% x 100%
 * of the viewport), so there is NEVER a letterbox bar — the canvas rect always
 * equals the viewport rect. The design space is then mapped onto that full-bleed
 * canvas by the main camera (see src/ui/stage.ts and the STAGE MODEL note in
 * theme.ts): zoom = stage scale, centred on the 1280x720 content island.
 *
 * `autoCenter` stays off because the canvas already fills the screen; centring is
 * the camera's job.
 */
export function createGameConfig(parent: HTMLElement): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#9adaff',
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.NO_CENTER,
      width: DESIGN_WIDTH,
      height: DESIGN_HEIGHT,
      // Canvas pixels === CSS pixels: cheap on 2GB-RAM Android devices, and the
      // stage model's scale then applies 1:1 to the CSS viewport.
      autoRound: true,
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
