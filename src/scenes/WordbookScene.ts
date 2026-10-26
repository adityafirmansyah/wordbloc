import Phaser from 'phaser';
import { AudioManager } from '../game/audio';
import { allLevels, levelById } from '../game/levels';
import { wordbook, type WordbookEntry } from '../game/wordbook';
import { ATLAS_KEY, COLORS, DESIGN_HEIGHT, DESIGN_WIDTH, FRAMES, SCENES } from '../game/theme';
import { makeButton, makeIconButton, makeText } from '../ui/kit';

const COLUMNS = 4;
const ROWS = 3;
const PER_PAGE = COLUMNS * ROWS;
const GRID_TOP = 244;
const GRID_LEFT_CENTER = DESIGN_WIDTH / 2;
const CARD_W = 268;
const CARD_H = 128;
const GAP_X = 18;
const GAP_Y = 14;

/**
 * Wordbook: every completed word, persisted in localStorage.
 * Each card replays the word audio. Locked (uncompleted) levels stay hidden so
 * the page lists only what the kid actually unlocked.
 */
export class WordbookScene extends Phaser.Scene {
  private audio!: AudioManager;
  private page = 0;
  private entries: WordbookEntry[] = [];
  private gridLayer!: Phaser.GameObjects.Container;
  private pagerText!: Phaser.GameObjects.Text;
  private prevButton!: Phaser.GameObjects.Container;
  private nextButton!: Phaser.GameObjects.Container;

  constructor() {
    super(SCENES.wordbook);
  }

  create(): void {
    this.audio = new AudioManager(this);
    this.audio.setEnabled(this.registry.get('muted') !== true);
    this.entries = wordbook().entries();
    this.page = 0;

    this.drawBackdrop();
    this.drawHeader();
    this.drawGrid();
    this.drawPager();

    makeButton(this, {
      x: DESIGN_WIDTH / 2,
      y: DESIGN_HEIGHT - 58,
      label: 'Back',
      width: 300,
      height: 128,
      fontSize: 34,
      variant: 'alt',
      onClick: () => this.scene.start(SCENES.menu),
    });
  }

  private drawBackdrop(): void {
    const strip = this.add.image(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2, ATLAS_KEY, FRAMES.bgStrip);
    strip.setDisplaySize(DESIGN_WIDTH, DESIGN_HEIGHT);
    strip.setDepth(-100);
    this.add
      .image(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2 + 8, ATLAS_KEY, FRAMES.panel)
      .setDisplaySize(1216, 620);
  }

  private drawHeader(): void {
    makeIconButton(this, {
      x: 96,
      y: 96,
      frame: FRAMES.home,
      size: 132,
      onClick: () => this.scene.start(SCENES.menu),
    });

    makeText(this, DESIGN_WIDTH / 2, 88, 'My Wordbook', 56, '#21324a', true);

    const total = allLevels().length;
    const unlocked = this.entries.length;
    makeText(this, DESIGN_WIDTH / 2, 142, `${unlocked} of ${total} words collected`, 28, '#54708c');

    // Progress pill.
    const pillW = 420;
    const pillH = 16;
    const x = DESIGN_WIDTH / 2 - pillW / 2;
    const y = 172;
    const track = this.add.graphics();
    track.fillStyle(0xdfeaf3, 1);
    track.fillRoundedRect(x, y, pillW, pillH, pillH / 2);
    if (unlocked > 0) {
      track.fillStyle(COLORS.slotDoneEdge, 1);
      track.fillRoundedRect(x, y, (pillW * unlocked) / total, pillH, pillH / 2);
    }
  }

  private drawGrid(): void {
    this.gridLayer = this.add.container(0, 0);
    this.renderPage();
  }

  private renderPage(): void {
    this.gridLayer.removeAll(true);

    if (this.entries.length === 0) {
      this.drawEmptyState();
      return;
    }

    const start = this.page * PER_PAGE;
    const slice = this.entries.slice(start, start + PER_PAGE);

    slice.forEach((entry, i) => {
      // Centre each row independently so a partly-filled page still looks balanced.
      const rowStart = Math.floor(i / COLUMNS) * COLUMNS;
      const rowLen = Math.min(COLUMNS, slice.length - rowStart);
      const col = i - rowStart;
      const x = GRID_LEFT_CENTER + (col - (rowLen - 1) / 2) * (CARD_W + GAP_X);
      const y = GRID_TOP + Math.floor(i / COLUMNS) * (CARD_H + GAP_Y) + CARD_H / 2;
      this.drawCard(entry, x, y);
    });
  }

  private drawEmptyState(): void {
    this.add
      .text(DESIGN_WIDTH / 2, 380, 'No words yet.\nPlay a level to fill your wordbook!', {
        fontFamily: '"Trebuchet MS", "Segoe UI", Verdana, sans-serif',
        fontSize: '38px',
        color: '#7f95ab',
        align: 'center',
        lineSpacing: 12,
      })
      .setOrigin(0.5);
  }

  private drawCard(entry: WordbookEntry, x: number, y: number): void {
    const bg = this.add.image(0, 0, ATLAS_KEY, FRAMES.card).setDisplaySize(CARD_W, CARD_H);
    const word = this.add
      .text(0, -26, entry.word, {
        fontFamily: '"Trebuchet MS", "Segoe UI", Verdana, sans-serif',
        fontSize: entry.word.length > 8 ? '30px' : '38px',
        color: '#21324a',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const level = levelById(entry.levelId);
    const meta = this.add
      .text(0, 14, `Tier ${entry.tier}${level ? ` · ${level.category}` : ''}`, {
        fontFamily: '"Trebuchet MS", "Segoe UI", Verdana, sans-serif',
        fontSize: '19px',
        color: '#7f95ab',
      })
      .setOrigin(0.5);

    const speakerBg = this.add.circle(96, 34, 26, 0xeef6fd);
    const speaker = this.add.image(96, 34, ATLAS_KEY, FRAMES.speaker).setScale(0.4);

    const card = this.add.container(x, y, [bg, word, meta, speakerBg, speaker]);
    card.setSize(CARD_W, CARD_H);
    // Whole card is a >=268x128 design px target (>=134x64 CSS at s=0.5).
    card.setInteractive(
      new Phaser.Geom.Rectangle(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H),
      Phaser.Geom.Rectangle.Contains,
    );
    card.on(Phaser.Input.Events.POINTER_DOWN, () => {
      bg.setFrame(FRAMES.card);
      this.tweens.add({ targets: card, scale: 0.96, duration: 80, yoyo: true });
    });
    card.on(Phaser.Input.Events.POINTER_UP, () => {
      // Replay the word audio (phonics contract: whole word here, not phonemes).
      this.audio.playWord(entry.audioWord);
      this.tweens.add({ targets: speaker, scale: 0.52, duration: 110, yoyo: true });
    });

    this.gridLayer.add(card);
  }

  private drawPager(): void {
    const pages = Math.max(1, Math.ceil(this.entries.length / PER_PAGE));
    if (pages <= 1) {
      this.pagerText = makeText(
        this,
        DESIGN_WIDTH / 2,
        DESIGN_HEIGHT - 140,
        this.entries.length > 0 ? `Page 1 / 1` : '',
        24,
        '#7f95ab',
      );
      return;
    }

    this.prevButton = makeIconButton(this, {
      x: DESIGN_WIDTH / 2 - 190,
      y: DESIGN_HEIGHT - 140,
      frame: FRAMES.arrowLeft,
      size: 132,
      onClick: () => this.goToPage(this.page - 1),
    });

    this.nextButton = makeIconButton(this, {
      x: DESIGN_WIDTH / 2 + 190,
      y: DESIGN_HEIGHT - 140,
      frame: FRAMES.arrowRight,
      size: 132,
      onClick: () => this.goToPage(this.page + 1),
    });

    this.pagerText = makeText(
      this,
      DESIGN_WIDTH / 2,
      DESIGN_HEIGHT - 140,
      `Page ${this.page + 1} / ${pages}`,
      24,
      '#7f95ab',
    );
    this.refreshPagerButtons(pages);
  }

  private refreshPagerButtons(pages: number): void {
    if (!this.prevButton || !this.nextButton) return;
    this.prevButton.setAlpha(this.page === 0 ? 0.35 : 1);
    this.nextButton.setAlpha(this.page >= pages - 1 ? 0.35 : 1);
  }

  private goToPage(page: number): void {
    const pages = Math.max(1, Math.ceil(this.entries.length / PER_PAGE));
    if (page < 0 || page >= pages) return;
    this.page = page;
    this.renderPage();
    this.pagerText.setText(`Page ${this.page + 1} / ${pages}`);
    this.refreshPagerButtons(pages);
  }
}
