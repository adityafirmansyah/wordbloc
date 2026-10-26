import Phaser from 'phaser';
import { resumeLevelId } from '../game/progress';
import { wordbook } from '../game/wordbook';
import { ATLAS_KEY, DESIGN_HEIGHT, DESIGN_WIDTH, FRAMES, SCENES } from '../game/theme';
import { drawBackdrop, makeButton, makeIconButton, makeText } from '../ui/kit';

/** Title screen: Play, Wordbook, and a small progress readout. */
export class MenuScene extends Phaser.Scene {
  constructor() {
    super(SCENES.menu);
  }

  create(): void {
    drawBackdrop(this);

    // Title block: letter tiles spelling WORDBLOC would be noisy; use wordmark art.
    const wordmark = makeText(this, DESIGN_WIDTH / 2, 150, 'WORDBLOC', 104, '#21324a', true);
    wordmark.setShadow(0, 6, 'rgba(0,0,0,0.18)', 0);
    wordmark.setDepth(5);

    makeText(this, DESIGN_WIDTH / 2, 226, 'Build words, open worlds.', 34, '#54708c');

    // Decorative floating tiles along the bottom edge.
    this.addFloatingTiles();

    const book = wordbook();

    makeButton(this, {
      x: DESIGN_WIDTH / 2,
      y: 354,
      label: 'Play',
      onClick: () => this.startGame(),
      variant: 'primary',
    });

    makeButton(this, {
      x: DESIGN_WIDTH / 2,
      y: 514,
      label: `Wordbook (${book.count()})`,
      onClick: () => this.scene.start(SCENES.wordbook),
      variant: 'alt',
    });

    const stars = this.add.container(1124, 92, [
      this.add.image(0, 0, ATLAS_KEY, FRAMES.star).setScale(0.72),
      makeText(this, 56, 4, `${book.count()}`, 40, '#21324a', true),
    ]);
    stars.setDepth(6);

    // Sound toggle (phonics audio on/off).
    const muted = this.registry.get('muted') === true;
    makeIconButton(this, {
      x: 92,
      y: 92,
      frame: FRAMES.speaker,
      size: 132,
      onClick: (): void => {
        const next = !(this.registry.get('muted') === true);
        this.registry.set('muted', next);
        this.scene.restart();
      },
    });
    if (muted) {
      makeText(this, 92, 176, 'muted', 22, '#c24848', true);
    }
  }

  private startGame(): void {
    const levelId = resumeLevelId();
    this.scene.start(SCENES.game, { levelId });
  }

  private addFloatingTiles(): void {
    const units = ['W', 'B', 'L', 'O', 'C'];
    units.forEach((unit, index) => {
      const x = 150 + index * 240;
      // Sit in the bottom margin, clear of the button stack (which ends at y=578)
      // and fully inside the 720px design height.
      const y = DESIGN_HEIGHT - 68;
      const tile = this.add.image(x, y, ATLAS_KEY, `tile_w1`).setScale(0.78).setAlpha(0.92);
      tile.setDepth(1);
      const label = makeText(this, x, y - 6, unit, 48, '#3a2a00', true);
      label.setDepth(2);
      this.tweens.add({
        targets: [tile, label],
        y: y - 8,
        duration: 1400 + index * 130,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      });
    });
  }
}
