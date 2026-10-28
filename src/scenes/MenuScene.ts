import Phaser from 'phaser';
import { resumeLevelId } from '../game/progress';
import { wordbook } from '../game/wordbook';
import { AudioManager, type SfxKey } from '../game/audio';
import {
  ATLAS_KEY,
  BANDS,
  FRAMES,
  ISLAND_CENTRE_X,
  PORTRAIT_BANDS,
  PORTRAIT_ISLAND_CENTRE_X,
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
    // on the content island on any viewport aspect ratio.
    this.layout = new StageLayout(this, { hills: true });
    const isPortrait = this.layout.metrics.isPortrait;

    // Title block: letter tiles spelling WORDBLOC would be noisy; use wordmark art.
    const initialCenterX = isPortrait ? PORTRAIT_ISLAND_CENTRE_X : ISLAND_CENTRE_X;
    const initialWordmarkY = isPortrait ? 260 : 150;
    const initialSubtitleY = isPortrait ? 350 : 226;
    const initialWordmarkSize = isPortrait ? 92 : 104;

    const wordmark = makeText(
      this,
      initialCenterX,
      initialWordmarkY,
      'WORDBLOC',
      initialWordmarkSize,
      '#21324a',
      true,
    );
    wordmark.setShadow(0, 6, 'rgba(0,0,0,0.18)', 0);
    wordmark.setDepth(5);

    const subtitle = makeText(
      this,
      initialCenterX,
      initialSubtitleY,
      'Build words, open worlds.',
      isPortrait ? 32 : 34,
      '#54708c',
    );

    // Decorative floating tiles along the bottom edge, spread across the LIVE
    // stage so a wide or tall screen stays decorated out to its edges.
    this.addFloatingTiles();

    const book = wordbook();

    const playBtn = makeButton(this, {
      x: initialCenterX,
      y: isPortrait ? 530 : 354,
      label: 'Play',
      onClick: () => this.startGame(),
      variant: 'primary',
      sfx: this.clickSfx,
    });

    const wordbookBtn = makeButton(this, {
      x: initialCenterX,
      y: isPortrait ? 690 : 514,
      label: `Wordbook (${book.count()})`,
      onClick: () => this.scene.start(SCENES.wordbook),
      variant: 'alt',
      sfx: this.clickSfx,
    });

    const stars = this.add.container(0, isPortrait ? 80 : 92, [
      this.add.image(0, 0, ATLAS_KEY, FRAMES.star).setScale(0.72),
      makeText(this, 56, 4, `${book.count()}`, 40, '#21324a', true),
    ]);
    stars.setDepth(6);
    this.layout.attach(stars, { kind: 'right', inset: isPortrait ? 100 : 156 });

    // Sound toggle (phonics audio on/off), pinned inside the live left edge.
    const muted = this.registry.get('muted') === true;
    const speaker = makeEdgeIconButton(this, this.layout, {
      edge: 'left',
      inset: isPortrait ? 80 : 92,
      y: isPortrait ? PORTRAIT_BANDS.headerCenterY : BANDS.headerCenterY,
      frame: FRAMES.speaker,
      onClick: (): void => {
        const next = !(this.registry.get('muted') === true);
        this.registry.set('muted', next);
        this.scene.restart();
      },
    });

    let mutedLabel: Phaser.GameObjects.Text | null = null;
    if (muted) {
      mutedLabel = makeText(this, 0, isPortrait ? 158 : 176, 'muted', 22, '#c24848', true);
      this.layout.attach(mutedLabel, { kind: 'left', inset: isPortrait ? 80 : 92 });
    }

    // Adaptive orientation layout handler
    this.layout.onStageChange((stage: StageMetrics) => {
      const portrait = stage.isPortrait;
      const cx = stage.centreX;

      wordmark.setPosition(cx, portrait ? 260 : 150);
      wordmark.setFontSize(portrait ? 92 : 104);
      subtitle.setPosition(cx, portrait ? 350 : 226);
      subtitle.setFontSize(portrait ? 32 : 34);

      playBtn.setPosition(cx, portrait ? 530 : 354);
      wordbookBtn.setPosition(cx, portrait ? 690 : 514);

      this.layout.setAnchorY(stars, portrait ? 80 : 92);
      this.layout.setAnchorY(
        speaker,
        portrait ? PORTRAIT_BANDS.headerCenterY : BANDS.headerCenterY,
      );
      if (mutedLabel) {
        this.layout.setAnchorY(mutedLabel, portrait ? 158 : 176);
      }
    });
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
    const getBaseY = (stage: StageMetrics): number =>
      stage.isPortrait ? stage.centreY + 400 : stage.centreY + 360 - 68;

    let currentBaseY = getBaseY(this.layout.metrics);

    const tiles = units.map((unit, index) => {
      const tile = this.add
        .image(0, currentBaseY, ATLAS_KEY, 'tile_w1')
        .setScale(0.78)
        .setAlpha(0.92);
      tile.setDepth(1);
      const label = makeText(this, 0, currentBaseY - 6, unit, 48, '#3a2a00', true);
      label.setDepth(2);
      let tween = this.tweens.add({
        targets: [tile, label],
        y: currentBaseY - 8,
        duration: 1400 + index * 130,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      });
      return {
        tile,
        label,
        index,
        setBaseY: (newY: number): void => {
          tween.remove();
          tile.y = newY;
          label.y = newY - 6;
          tween = this.tweens.add({
            targets: [tile, label],
            y: newY - 8,
            duration: 1400 + index * 130,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.InOut',
          });
        },
      };
    });

    const place = (stage: StageMetrics): void => {
      const targetBaseY = getBaseY(stage);
      if (Math.abs(targetBaseY - currentBaseY) > 1) {
        currentBaseY = targetBaseY;
        tiles.forEach((t) => t.setBaseY(currentBaseY));
      }

      const span = Math.min(stage.width, stage.isPortrait ? 680 : 1280);
      const step = span / (units.length + 1);
      tiles.forEach(({ tile, label, index }) => {
        const x = stage.left + (stage.width - span) / 2 + step * (index + 1);
        tile.x = x;
        label.x = x;
      });
    };

    place(this.layout.metrics);
    // Frames must not be re-created: only x and y are updated on existing objects.
    this.layout.onStageChange(place);
  }
}
