import Phaser from 'phaser';
import {
  loadLevel,
  manifestCount,
  manifestEntryById,
  nextLevelManifest,
  preloadLevel,
} from '../game/levels';
import { wordbook } from '../game/wordbook';
import { AudioManager } from '../game/audio';
import { ATLAS_KEY, COLORS, DESIGN_HEIGHT, DESIGN_WIDTH, FRAMES, SCENES } from '../game/theme';
import { makeButton, makeText } from '../ui/kit';
import type { Level, LevelManifestEntry } from '../game/levelTypes';

interface RewardData {
  levelId?: string;
}

/** Star award + word replay + Next. Persists the completion to the wordbook. */
export class RewardScene extends Phaser.Scene {
  private levelId = 'lvl_0001';
  private audio!: AudioManager;
  /** Bumped per start so a level load that lands after navigation cannot draw. */
  private loadToken = 0;

  constructor() {
    super(SCENES.reward);
  }

  init(data: RewardData): void {
    this.levelId = data.levelId ?? 'lvl_0001';
  }

  create(): void {
    this.audio = new AudioManager(this);
    this.audio.setEnabled(this.registry.get('muted') !== true);

    // The manifest row is instant; it carries the word/audio the screen needs.
    const entry = manifestEntryById(this.levelId);
    if (!entry) {
      throw new Error(`WordBloc RewardScene: unknown level "${this.levelId}".`);
    }

    // Chrome first, so the screen never flashes empty while the level file loads.
    this.drawBackdrop();

    // Preload the next level while the kid is looking at the star, so "Next"
    // paints immediately instead of showing the loading card.
    const upcoming = nextLevelManifest(entry.id);
    if (upcoming) void preloadLevel(upcoming.id);

    void this.loadAndDraw(entry);
  }

  /**
   * Loads the just-finished level's file so completion is recorded from the
   * validated data (never from a partly-loaded guess). If the file cannot be
   * read, the manifest row still lets the screen render and record the word.
   */
  private async loadAndDraw(entry: LevelManifestEntry): Promise<void> {
    const token = (this.loadToken += 1);
    let level: Level | null = null;
    try {
      level = await loadLevel(entry.id);
    } catch (error) {
      console.error('WordBloc: reward could not load its level file.', error);
    }
    if (token !== this.loadToken || !this.scene.isActive()) return;

    // Persist BEFORE drawing, so the Wordbook count shown here is already correct.
    const isNew = wordbook().record({
      levelId: entry.id,
      word: entry.word,
      display: entry.display,
      tier: entry.tier,
      category: entry.category,
      audioWord: level?.audio_word ?? `words/${entry.display}`,
      meaningId: entry.meaning_id,
    });

    this.drawStar(isNew);
    this.drawCopy(entry.display);
    this.drawActions();
    this.confetti();

    // Replay the finished word shortly after arrival.
    const audioKey = level?.audio_word ?? `words/${entry.display}`;
    this.time.delayedCall(300, () => this.audio.playWord(audioKey));
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

    const total = manifestCount();
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
    const upcoming = nextLevelManifest(this.levelId);

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
