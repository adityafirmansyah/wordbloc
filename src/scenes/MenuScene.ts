import Phaser from 'phaser';
import { resumeLevelId } from '../game/progress';
import { wordbook } from '../game/wordbook';
import { AudioManager, type SfxKey } from '../game/audio';
import {
  ATLAS_KEY,
  BANDS,
  FRAMES,
  ISLAND_CENTRE_X,
  ISLAND_CENTRE_Y,
  SCENES,
  type StageMetrics,
} from '../game/theme';
import { makeButton, makeEdgeIconButton, makeText } from '../ui/kit';
import { StageLayout } from '../ui/stage';

/** Title screen: Play, Wordbook, and a small progress readout. */
export class MenuScene extends Phaser.Scene {
  private layout!: StageLayout;
  private audio!: AudioManager;

  constructor() {
    super(SCENES.menu);
  }

  /** Game-juice click for this scene's buttons; reads the live manager. */
  private clickSfx = (key: SfxKey): void => {
    void this.audio.playSfx(key).catch(() => undefined);
  };

  create(): void {
    // The title screen is the FIRST gesture of a session, so it is also where the
    // audio context gets unlocked: without that, the Play tap is inaudible and the
    // first tile of the level after it stays silent too.
    this.audio = new AudioManager();
    this.audio.setEnabled(this.registry.get('muted') !== true);
    this.audio.preloadSfx();
    this.input.once(Phaser.Input.Events.POINTER_DOWN, () => void this.audio.unlock());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.release());

    // Stage first: it paints the full-bleed backdrop and keeps the camera centred
    // on the 1280x720 content island on any viewport aspect ratio.
    this.layout = new StageLayout(this, { hills: true });

    // Title block: letter tiles spelling WORDBLOC would be noisy; use wordmark art.
    const wordmark = makeText(this, ISLAND_CENTRE_X, 150, 'WORDBLOC', 104, '#21324a', true);
    wordmark.setShadow(0, 6, 'rgba(0,0,0,0.18)', 0);
    wordmark.setDepth(5);

    makeText(this, ISLAND_CENTRE_X, 226, 'Build words, open worlds.', 34, '#54708c');

    // Decorative floating tiles along the bottom edge, spread across the LIVE
    // stage so a wide phone screen stays decorated out to its edges.
    this.addFloatingTiles();

    const book = wordbook();

    makeButton(this, {
      x: ISLAND_CENTRE_X,
      y: 354,
      label: 'Play',
      onClick: () => this.startGame(),
      variant: 'primary',
      sfx: this.clickSfx,
    });

    makeButton(this, {
      x: ISLAND_CENTRE_X,
      y: 514,
      label: `Wordbook (${book.count()})`,
      onClick: () => this.scene.start(SCENES.wordbook),
      variant: 'alt',
      sfx: this.clickSfx,
    });

    const stars = this.add.container(0, 92, [
      this.add.image(0, 0, ATLAS_KEY, FRAMES.star).setScale(0.72),
      makeText(this, 56, 4, `${book.count()}`, 40, '#21324a', true),
    ]);
    stars.setDepth(6);
    this.layout.attach(stars, { kind: 'right', inset: 156 });

    // Sound toggle (phonics audio on/off), pinned inside the live left edge.
    const muted = this.registry.get('muted') === true;
    makeEdgeIconButton(this, this.layout, {
      edge: 'left',
      inset: 92,
      y: BANDS.headerCenterY,
      frame: FRAMES.speaker,
      // No click SFX on purpose: this handler RESTARTS the scene, whose shutdown
      // releases the audio pool and would truncate the click it just started.
      onClick: (): void => {
        const next = !(this.registry.get('muted') === true);
        this.registry.set('muted', next);
        this.scene.restart();
      },
    });
    if (muted) {
      const label = makeText(this, 0, 176, 'muted', 22, '#c24848', true);
      this.layout.attach(label, { kind: 'left', inset: 92 });
    }
  }

  private startGame(): void {
    const levelId = resumeLevelId();
    this.scene.start(SCENES.game, { levelId });
  }

  /**
   * Five letter tiles across the bottom margin. Their x follows the live stage
   * (evenly spaced between the stage edges) while the float tween only touches y,
   * so a resize mid-animation does not fight the tween.
   */
  private addFloatingTiles(): void {
    const units = ['W', 'B', 'L', 'O', 'C'];
    const y = ISLAND_CENTRE_Y + 720 / 2 - 68;

    const tiles = units.map((unit, index) => {
      const tile = this.add.image(0, y, ATLAS_KEY, 'tile_w1').setScale(0.78).setAlpha(0.92);
      tile.setDepth(1);
      const label = makeText(this, 0, y - 6, unit, 48, '#3a2a00', true);
      label.setDepth(2);
      this.tweens.add({
        targets: [tile, label],
        y: y - 8,
        duration: 1400 + index * 130,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      });
      return { tile, label, index };
    });

    const place = (stage: StageMetrics): void => {
      const span = Math.min(stage.width, 1280);
      const step = span / (units.length + 1);
      tiles.forEach(({ tile, label, index }) => {
        const x = stage.left + (stage.width - span) / 2 + step * (index + 1);
        tile.x = x;
        label.x = x;
      });
    };

    place(this.layout.metrics);
    // Frames must not be re-created: only x is written, on objects that exist.
    this.layout.onStageChange(place);
  }
}
