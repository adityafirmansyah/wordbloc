import Phaser from 'phaser';
import { AudioManager } from '../game/audio';
import { allLevels, levelById } from '../game/levels';
import { wordbook, type WordbookEntry } from '../game/wordbook';
import {
  ATLAS_KEY,
  COLORS,
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  FRAMES,
  SCENES,
  WORDBOOK,
  WORDBOOK_GRID_BOTTOM,
  WORDBOOK_PER_PAGE,
  wordbookColumnX,
  wordbookRowY,
} from '../game/theme';
import { makeButton, makeIconButton, makeText } from '../ui/kit';

/**
 * Wordbook: every completed word, persisted in localStorage.
 * Each card replays the word audio. Locked (uncompleted) levels stay hidden so
 * the page lists only what the kid actually unlocked.
 *
 * Layout rule (see WORDBOOK in theme.ts): three rows of cards, pager arrows
 * OUTSIDE the card band on the left/right, page caption below the grid, Back in
 * the header. Nothing overlaps and nothing extends past the 720px stage.
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
  }

  private drawBackdrop(): void {
    const strip = this.add.image(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2, ATLAS_KEY, FRAMES.bgStrip);
    strip.setDisplaySize(DESIGN_WIDTH, DESIGN_HEIGHT);
    strip.setDepth(-100);
    // Panel sits strictly between the pager arrows and below the header, so no
    // rounded edge cuts through a control.
    this.add
      .image(WORDBOOK.panel.x, WORDBOOK.panel.y, ATLAS_KEY, FRAMES.panel)
      .setDisplaySize(WORDBOOK.panel.width, WORDBOOK.panel.height);
  }

  private drawHeader(): void {
    // Back sits in the header (it used to sit under the grid, covering row 3 and
    // overflowing the stage by 6px).
    makeButton(this, {
      x: WORDBOOK.backButton.x,
      y: WORDBOOK.backButton.y,
      label: 'Back',
      width: WORDBOOK.backButton.width,
      height: WORDBOOK.backButton.height,
      fontSize: 34,
      variant: 'alt',
      onClick: () => this.scene.start(SCENES.menu),
    });

    makeIconButton(this, {
      x: DESIGN_WIDTH - 92,
      y: 76,
      frame: FRAMES.home,
      size: 132,
      onClick: () => this.scene.start(SCENES.menu),
    });

    makeText(this, DESIGN_WIDTH / 2, 78, 'My Wordbook', 52, '#21324a', true);

    const total = allLevels().length;
    const unlocked = this.entries.length;
    makeText(this, DESIGN_WIDTH / 2, 130, `${unlocked} of ${total} words collected`, 26, '#54708c');

    // Progress pill, between the subtitle and the grid.
    const pillW = 420;
    const pillH = 16;
    const x = DESIGN_WIDTH / 2 - pillW / 2;
    const y = 164;
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

    const start = this.page * WORDBOOK_PER_PAGE;
    const slice = this.entries.slice(start, start + WORDBOOK_PER_PAGE);

    slice.forEach((entry, i) => {
      // Centre each row independently so a partly-filled page still looks balanced.
      const rowStart = Math.floor(i / WORDBOOK.columns) * WORDBOOK.columns;
      const rowLen = Math.min(WORDBOOK.columns, slice.length - rowStart);
      const col = i - rowStart;
      this.drawCard(
        entry,
        wordbookColumnX(col, rowLen),
        wordbookRowY(Math.floor(i / WORDBOOK.columns)),
      );
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
    const { width, height } = WORDBOOK.card;
    const bg = this.add.image(0, 0, ATLAS_KEY, FRAMES.card).setDisplaySize(width, height);
    const word = this.add
      .text(0, -20, entry.word, {
        fontFamily: '"Trebuchet MS", "Segoe UI", Verdana, sans-serif',
        fontSize: entry.word.length > 8 ? '30px' : '38px',
        color: '#21324a',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const level = levelById(entry.levelId);
    const meta = this.add
      .text(0, 22, `Tier ${entry.tier}${level ? ` · ${level.category}` : ''}`, {
        fontFamily: '"Trebuchet MS", "Segoe UI", Verdana, sans-serif',
        fontSize: '19px',
        color: '#7f95ab',
      })
      .setOrigin(0.5);

    const speakerBg = this.add.circle(width / 2 - 34, -height / 2 + 30, 24, 0xeef6fd);
    const speaker = this.add.image(width / 2 - 34, -height / 2 + 30, ATLAS_KEY, FRAMES.speaker);
    speaker.setScale(0.36);

    const card = this.add.container(x, y, [bg, word, meta, speakerBg, speaker]);
    card.setSize(width, height);
    // Whole card is a >=292x128 design px target (>=146x64 CSS at s=0.5).
    // Rect starts at 0,0: Phaser adds displayOrigin before the Contains test.
    card.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, width, height),
      Phaser.Geom.Rectangle.Contains,
    );
    card.on(Phaser.Input.Events.POINTER_DOWN, () => {
      this.tweens.add({ targets: card, scale: 0.96, duration: 80, yoyo: true });
    });
    card.on(Phaser.Input.Events.POINTER_UP, () => {
      // Replay the word audio (phonics contract: whole word here, not phonemes).
      this.audio.playWord(entry.audioWord);
      this.tweens.add({ targets: speaker, scale: 0.5, duration: 110, yoyo: true });
    });

    this.gridLayer.add(card);
  }

  private pages(): number {
    return Math.max(1, Math.ceil(this.entries.length / WORDBOOK_PER_PAGE));
  }

  private drawPager(): void {
    const pages = this.pages();

    // Side arrows: OUTSIDE the card band horizontally (cards span 186..1094),
    // vertically centred on the grid so they never sit over a card.
    this.prevButton = makeIconButton(this, {
      x: WORDBOOK.pagerX.left,
      y: WORDBOOK.pagerY,
      frame: FRAMES.arrowLeft,
      size: WORDBOOK.pagerButtonSize,
      onClick: () => this.goToPage(this.page - 1),
    });

    this.nextButton = makeIconButton(this, {
      x: WORDBOOK.pagerX.right,
      y: WORDBOOK.pagerY,
      frame: FRAMES.arrowRight,
      size: WORDBOOK.pagerButtonSize,
      onClick: () => this.goToPage(this.page + 1),
    });

    // Caption below the grid (grid ends at WORDBOOK_GRID_BOTTOM = 594).
    this.pagerText = makeText(
      this,
      DESIGN_WIDTH / 2,
      WORDBOOK.pagerCaptionY,
      this.entries.length > 0 ? `Page ${this.page + 1} / ${pages}` : '',
      26,
      '#7f95ab',
    );

    const paging = pages > 1;
    this.prevButton.setVisible(paging);
    this.nextButton.setVisible(paging);
    this.refreshPagerButtons(pages);
  }

  private refreshPagerButtons(pages: number): void {
    this.prevButton.setAlpha(this.page === 0 ? 0.35 : 1);
    this.nextButton.setAlpha(this.page >= pages - 1 ? 0.35 : 1);
  }

  private goToPage(page: number): void {
    const pages = this.pages();
    if (page < 0 || page >= pages) return;
    this.page = page;
    this.renderPage();
    this.pagerText.setText(`Page ${this.page + 1} / ${pages}`);
    this.refreshPagerButtons(pages);
  }

  /** Bottom edge of the grid, exported for the layout regression test. */
  static gridBottom(): number {
    return WORDBOOK_GRID_BOTTOM;
  }
}
