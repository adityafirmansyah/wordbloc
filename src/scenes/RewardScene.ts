import Phaser from 'phaser';
import { levelById, nextLevel, allLevels } from '../game/levels';
import { wordbook } from '../game/wordbook';
import { AudioManager } from '../game/audio';
import { ATLAS_KEY, COLORS, DESIGN_HEIGHT, DESIGN_WIDTH, FRAMES, SCENES } from '../game/theme';
import { makeButton, makeText } from '../ui/kit';

interface RewardData {
  levelId?: string;
}

/** Star award + word replay + Next. Persists the completion to the wordbook. */
export class RewardScene extends Phaser.Scene {
  private levelId = 'lvl_0001';
  private audio!: AudioManager;

  constructor() {
    super(SCENES.reward);
  }

  init(data: RewardData): void {
    this.levelId = data.levelId ?? 'lvl_0001';
  }

  create(): void {
    this.audio = new AudioManager(this);
    this.audio.setEnabled(this.registry.get('muted') !== true);

    const level = levelById(this.levelId);
    if (!level) {
      throw new Error(`WordBloc RewardScene: unknown level "${this.levelId}".`);
    }

    // Persist BEFORE drawing, so the Wordbook count shown here is already correct.
    const isNew = wordbook().record({
      levelId: level.id,
      word: level.word,
      display: level.display,
      tier: level.tier,
      category: level.category,
      audioWord: level.audio_word,
      meaningId: level.meaning_id,
    });

    this.drawBackdrop();
    this.drawStar(isNew);
    this.drawCopy(level.display);
    this.drawActions();
    this.confetti();

    // Replay the finished word shortly after arrival.
    this.time.delayedCall(300, () => this.audio.playWord(level.audio_word));
  }

  private drawBackdrop(): void {
    const strip = this.add.image(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2, ATLAS_KEY, FRAMES.bgStrip);
    strip.setDisplaySize(DESIGN_WIDTH, DESIGN_HEIGHT);
    strip.setDepth(-100);
    this.add.image(DESIGN_WIDTH / 2, 300, ATLAS_KEY, FRAMES.panel).setDisplaySize(800, 420);
  }

  private drawStar(isNew: boolean): void {
    const star = this.add.image(DESIGN_WIDTH / 2, 186, ATLAS_KEY, FRAMES.star).setScale(0.2);
    this.tweens.add({
      targets: star,
      scale: 2.1,
      angle: 360,
      duration: 620,
      ease: 'Back.Out',
      onComplete: () => {
        this.tweens.add({ targets: star, scale: 1.95, duration: 900, yoyo: true, repeat: -1 });
      },
    });
    this.add
      .text(DESIGN_WIDTH / 2, 196, isNew ? '+1' : '', {
        fontFamily: '"Trebuchet MS", sans-serif',
        fontSize: '46px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(5);
  }

  private drawCopy(display: string): void {
    makeText(this, DESIGN_WIDTH / 2, 296, 'Nice work!', 62, '#21324a', true);
    makeText(this, DESIGN_WIDTH / 2, 366, `You built "${display}"`, 38, '#54708c');

    const total = allLevels().length;
    makeText(
      this,
      DESIGN_WIDTH / 2,
      424,
      `${wordbook().count()} of ${total} words in your Wordbook`,
      26,
      '#7f95ab',
    );
  }

  private drawActions(): void {
    const upcoming = nextLevel(this.levelId);

    if (upcoming) {
      makeButton(this, {
        x: DESIGN_WIDTH / 2,
        y: 528,
        label: 'Next',
        onClick: () => this.scene.start(SCENES.game, { levelId: upcoming.id }),
        variant: 'primary',
      });
    } else {
      makeText(this, DESIGN_WIDTH / 2, 528, 'You finished every level!', 32, '#54708c', true);
    }

    makeButton(this, {
      x: DESIGN_WIDTH / 2 - 250,
      y: 654,
      label: 'Replay',
      width: 300,
      height: 128,
      fontSize: 34,
      variant: 'alt',
      onClick: () => this.scene.start(SCENES.game, { levelId: this.levelId }),
    });

    makeButton(this, {
      x: DESIGN_WIDTH / 2 + 250,
      y: 654,
      label: 'Wordbook',
      width: 300,
      height: 128,
      fontSize: 34,
      variant: 'alt',
      onClick: () => this.scene.start(SCENES.wordbook),
    });
  }

  private confetti(): void {
    for (let i = 0; i < 40; i += 1) {
      const dot = this.add.image(
        Phaser.Math.Between(40, DESIGN_WIDTH - 40),
        Phaser.Math.Between(-120, -10),
        ATLAS_KEY,
        FRAMES.dot,
      );
      dot.setDepth(900);
      dot.setTint(COLORS.confetti[i % COLORS.confetti.length] ?? 0xffffff);
      dot.setScale(Phaser.Math.FloatBetween(0.5, 1.2));
      this.tweens.add({
        targets: dot,
        y: DESIGN_HEIGHT + 40,
        x: dot.x + Phaser.Math.Between(-120, 120),
        angle: Phaser.Math.Between(-400, 400),
        duration: Phaser.Math.Between(1400, 2600),
        delay: Phaser.Math.Between(0, 500),
        ease: 'Quad.In',
        onComplete: () => dot.destroy(),
      });
    }
  }
}
