import Phaser from 'phaser';
import {
  loadLevel,
  manifestCount,
  manifestEntryById,
  nextLevelManifest,
  preloadLevel,
} from '../game/levels';
import { wordbook } from '../game/wordbook';
import { AudioManager, type SfxKey } from '../game/audio';
import { ATLAS_KEY, COLORS, FRAMES, SCENES, type StageMetrics } from '../game/theme';
import { makeButton, makeText } from '../ui/kit';
import { StageLayout } from '../ui/stage';
import type { Level, LevelManifestEntry } from '../game/levelTypes';

interface RewardData {
  levelId?: string;
}

/** Star award + word replay + Next. Persists the completion to the wordbook. */
export class RewardScene extends Phaser.Scene {
  private levelId = 'lvl_0001';
  private audio!: AudioManager;
  private layout!: StageLayout;
  /** Bumped per start so a level load that lands after navigation cannot draw. */
  private loadToken = 0;

  private panel!: Phaser.GameObjects.Image;
  private starObj: Phaser.GameObjects.Image | null = null;
  private plusOneText: Phaser.GameObjects.Text | null = null;
  private niceWorkText: Phaser.GameObjects.Text | null = null;
  private builtWordText: Phaser.GameObjects.Text | null = null;
  private countProgressText: Phaser.GameObjects.Text | null = null;
  private nextBtn: Phaser.GameObjects.Container | Phaser.GameObjects.Text | null = null;
  private replayBtn: Phaser.GameObjects.Container | null = null;
  private wordbookBtn: Phaser.GameObjects.Container | null = null;

  constructor() {
    super(SCENES.reward);
  }

  init(data: RewardData): void {
    this.levelId = data.levelId ?? 'lvl_0001';
  }

  create(): void {
    this.audio = new AudioManager();
    this.audio.setEnabled(this.registry.get('muted') !== true);
    // Star ping decoded ahead of the reveal, so it lands exactly on the scale-up.
    this.audio.preloadSfx();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.release());

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

    this.layout.onStageChange((stage: StageMetrics) => {
      this.repositionElements(stage);
    });
  }

  private repositionElements(stage: StageMetrics): void {
    const isPortrait = stage.isPortrait;
    const cx = stage.centreX;

    if (this.panel) {
      this.panel.setPosition(cx, isPortrait ? 520 : 300);
      this.panel.setDisplaySize(isPortrait ? 660 : 800, isPortrait ? 780 : 420);
    }

    if (this.starObj) {
      this.starObj.setPosition(cx, isPortrait ? 260 : 186);
    }
    if (this.plusOneText) {
      this.plusOneText.setPosition(cx, isPortrait ? 270 : 196);
    }

    if (this.niceWorkText) {
      this.niceWorkText.setPosition(cx, isPortrait ? 390 : 296);
    }
    if (this.builtWordText) {
      this.builtWordText.setPosition(cx, isPortrait ? 460 : 366);
    }
    if (this.countProgressText) {
      this.countProgressText.setPosition(cx, isPortrait ? 520 : 424);
    }

    if (this.nextBtn) {
      this.nextBtn.setPosition(cx, isPortrait ? 640 : 528);
    }
    if (this.replayBtn) {
      this.replayBtn.setPosition(isPortrait ? cx - 160 : cx - 250, isPortrait ? 800 : 654);
    }
    if (this.wordbookBtn) {
      this.wordbookBtn.setPosition(isPortrait ? cx + 160 : cx + 250, isPortrait ? 800 : 654);
    }
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
    this.time.delayedCall(300, () => void this.replayWord(audioKey));
  }

  /** Speaks the finished word. */
  private async replayWord(audioKey: string): Promise<void> {
    const first = await this.audio.playWord(audioKey);
    if (first.outcome !== 'silent' || !this.scene.isActive()) return;
    await this.audio.unlock();
    if (!this.scene.isActive()) return;
    await this.audio.playWord(audioKey);
  }

  private drawBackdrop(): void {
    this.layout = new StageLayout(this, { backdrop: true });
    const isPortrait = this.layout.metrics.isPortrait;
    const cx = this.layout.metrics.centreX;

    this.panel = this.add
      .image(cx, isPortrait ? 520 : 300, ATLAS_KEY, FRAMES.panel)
      .setDisplaySize(isPortrait ? 660 : 800, isPortrait ? 780 : 420)
      .setDepth(0);
  }

  /** Game-juice click for this scene's buttons; reads the live manager. */
  private clickSfx = (key: SfxKey): void => {
    void this.audio.playSfx(key).catch(() => undefined);
  };

  private drawStar(isNew: boolean): void {
    const isPortrait = this.layout.metrics.isPortrait;
    const cx = this.layout.metrics.centreX;
    const starY = isPortrait ? 260 : 186;

    this.starObj = this.add.image(cx, starY, ATLAS_KEY, FRAMES.star).setScale(0.2);
    void this.audio.playSfx('sfx/star');
    this.tweens.add({
      targets: this.starObj,
      scale: 2.1,
      angle: 360,
      duration: 620,
      ease: 'Back.Out',
      onComplete: () => {
        if (this.starObj) {
          this.tweens.add({
            targets: this.starObj,
            scale: 1.95,
            duration: 900,
            yoyo: true,
            repeat: -1,
          });
        }
      },
    });

    this.plusOneText = this.add
      .text(cx, isPortrait ? 270 : 196, isNew ? '+1' : '', {
        fontFamily: '"Trebuchet MS", sans-serif',
        fontSize: '46px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(5);
  }

  private drawCopy(display: string): void {
    const isPortrait = this.layout.metrics.isPortrait;
    const cx = this.layout.metrics.centreX;

    this.niceWorkText = makeText(
      this,
      cx,
      isPortrait ? 390 : 296,
      'Nice work!',
      62,
      '#21324a',
      true,
    );
    this.builtWordText = makeText(
      this,
      cx,
      isPortrait ? 460 : 366,
      `You built "${display}"`,
      38,
      '#54708c',
    );

    const total = manifestCount();
    this.countProgressText = makeText(
      this,
      cx,
      isPortrait ? 520 : 424,
      `${wordbook().count()} of ${total} words in your Wordbook`,
      26,
      '#7f95ab',
    );
  }

  private drawActions(): void {
    const upcoming = nextLevelManifest(this.levelId);
    const isPortrait = this.layout.metrics.isPortrait;
    const cx = this.layout.metrics.centreX;

    if (upcoming) {
      this.nextBtn = makeButton(this, {
        x: cx,
        y: isPortrait ? 640 : 528,
        label: 'Next',
        width: 340,
        height: 128,
        onClick: () => this.scene.start(SCENES.game, { levelId: upcoming.id }),
        variant: 'primary',
        sfx: this.clickSfx,
      });
    } else {
      this.nextBtn = makeText(
        this,
        cx,
        isPortrait ? 640 : 528,
        'You finished every level!',
        32,
        '#54708c',
        true,
      );
    }

    this.replayBtn = makeButton(this, {
      x: isPortrait ? cx - 160 : cx - 250,
      y: isPortrait ? 800 : 654,
      label: 'Replay',
      width: isPortrait ? 280 : 300,
      height: isPortrait ? 120 : 128,
      fontSize: 34,
      variant: 'alt',
      sfx: this.clickSfx,
      onClick: () => this.scene.start(SCENES.game, { levelId: this.levelId }),
    });

    this.wordbookBtn = makeButton(this, {
      x: isPortrait ? cx + 160 : cx + 250,
      y: isPortrait ? 800 : 654,
      label: 'Wordbook',
      width: isPortrait ? 280 : 300,
      height: isPortrait ? 120 : 128,
      fontSize: 34,
      variant: 'alt',
      sfx: this.clickSfx,
      onClick: () => this.scene.start(SCENES.wordbook),
    });
  }

  private confetti(): void {
    const stage: StageMetrics = this.layout.metrics;
    for (let i = 0; i < 40; i += 1) {
      const dot = this.add.image(
        Phaser.Math.Between(stage.left + 40, stage.right - 40),
        Phaser.Math.Between(stage.top - 120, stage.top - 10),
        ATLAS_KEY,
        FRAMES.dot,
      );
      dot.setDepth(900);
      dot.setTint(COLORS.confetti[i % COLORS.confetti.length] ?? 0xffffff);
      dot.setScale(Phaser.Math.FloatBetween(0.5, 1.2));
      this.tweens.add({
        targets: dot,
        y: stage.bottom + 40,
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
