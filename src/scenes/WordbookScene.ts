import Phaser from 'phaser';
import { AudioManager, type SfxKey } from '../game/audio';
import { imageKeyFor } from '../game/assets';
import { manifestCount, manifestEntryById, preloadLevel } from '../game/levels';
import { wordbook, type WordbookEntry } from '../game/wordbook';
import {
  ATLAS_KEY,
  COLORS,
  FONT_FAMILY,
  FRAMES,
  PORTRAIT_WORDBOOK,
  PORTRAIT_WORDBOOK_PER_PAGE,
  SCENES,
  WORDBOOK,
  WORDBOOK_GRID_BOTTOM,
  WORDBOOK_PER_PAGE,
  WORDBOOK_THUMB,
  WORDBOOK_SPEAKER,
  WORDBOOK_CARD_TEXT,
  wordbookColumnX,
  wordbookRowY,
  wordbookThumbX,
  wordbookWordX,
  wordbookTextRight,
  wordbookTextWidth,
  type StageMetrics,
} from '../game/theme';
import { makeArtView } from '../ui/artView';
import { makeButton, makeEdgeIconButton, makeText } from '../ui/kit';
import { StageLayout } from '../ui/stage';

/**
 * Wordbook: every completed word, persisted in localStorage.
 * Each card replays the word audio. Locked (uncompleted) levels stay hidden so
 * the page lists only what the kid actually unlocked.
 */
export class WordbookScene extends Phaser.Scene {
  private audio!: AudioManager;
  private layout!: StageLayout;
  private page = 0;
  private entries: WordbookEntry[] = [];
  private gridLayer!: Phaser.GameObjects.Container;
  private pagerText!: Phaser.GameObjects.Text;
  private prevButton!: Phaser.GameObjects.Container;
  private nextButton!: Phaser.GameObjects.Container;
  private panel!: Phaser.GameObjects.Image;

  private titleText!: Phaser.GameObjects.Text;
  private subtitleText!: Phaser.GameObjects.Text;
  private trackGraphics!: Phaser.GameObjects.Graphics;
  private backButton!: Phaser.GameObjects.Container;

  constructor() {
    super(SCENES.wordbook);
  }

  create(): void {
    this.audio = new AudioManager();
    this.audio.setEnabled(this.registry.get('muted') !== true);
    this.audio.preloadSfx();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.release());
    this.input.once(Phaser.Input.Events.POINTER_DOWN, () => void this.audio.unlock());
    this.entries = wordbook().entries();
    this.page = 0;

    this.drawBackdrop();
    this.drawHeader();
    this.drawGrid();
    this.drawPager();

    this.layout.onStageChange((stage: StageMetrics) => {
      this.repositionElements(stage);
    });
  }

  private drawBackdrop(): void {
    this.layout = new StageLayout(this, { backdrop: true });
    const isPortrait = this.layout.metrics.isPortrait;
    const cx = this.layout.metrics.centreX;

    const panelConfig = isPortrait ? PORTRAIT_WORDBOOK.panel : WORDBOOK.panel;
    this.panel = this.add
      .image(cx, panelConfig.y, ATLAS_KEY, FRAMES.panel)
      .setDisplaySize(panelConfig.width, panelConfig.height)
      .setDepth(0);
  }

  /** Game-juice click for this scene's buttons; reads the live manager. */
  private clickSfx = (key: SfxKey): void => {
    void this.audio.playSfx(key).catch(() => undefined);
  };

  private drawHeader(): void {
    const isPortrait = this.layout.metrics.isPortrait;
    const cx = this.layout.metrics.centreX;

    this.backButton = makeButton(this, {
      x: 0,
      y: WORDBOOK.backButtonY,
      label: 'Back',
      width: isPortrait ? PORTRAIT_WORDBOOK.backButtonWidth : WORDBOOK.backButtonWidth,
      height: isPortrait ? PORTRAIT_WORDBOOK.backButtonHeight : WORDBOOK.backButtonHeight,
      fontSize: 34,
      variant: 'alt',
      sfx: this.clickSfx,
      onClick: () => this.scene.start(SCENES.menu),
    });
    this.layout.attach(this.backButton, {
      kind: 'left',
      inset: isPortrait ? PORTRAIT_WORDBOOK.backInset : WORDBOOK.backInset,
    });

    makeEdgeIconButton(this, this.layout, {
      edge: 'right',
      inset: isPortrait ? PORTRAIT_WORDBOOK.backInset : 92,
      y: WORDBOOK.backButtonY,
      frame: FRAMES.home,
      size: isPortrait ? 110 : 132,
      sfx: this.clickSfx,
      onClick: () => this.scene.start(SCENES.menu),
    });

    this.titleText = makeText(
      this,
      cx,
      isPortrait ? 140 : 78,
      'My Wordbook',
      isPortrait ? 46 : 52,
      '#21324a',
      true,
    );

    const total = manifestCount();
    const unlocked = this.entries.length;
    this.subtitleText = makeText(
      this,
      cx,
      isPortrait ? 190 : 130,
      `${unlocked} of ${total} words collected`,
      isPortrait ? 24 : 26,
      '#54708c',
    );

    // Progress pill
    this.trackGraphics = this.add.graphics();
    this.drawProgressPill(cx, isPortrait);
  }

  private drawProgressPill(cx: number, isPortrait: boolean): void {
    const total = manifestCount();
    const unlocked = this.entries.length;
    const pillW = isPortrait ? 380 : 420;
    const pillH = 16;
    const x = cx - pillW / 2;
    const y = isPortrait ? 225 : 164;

    this.trackGraphics.clear();
    this.trackGraphics.fillStyle(0xdfeaf3, 1);
    this.trackGraphics.fillRoundedRect(x, y, pillW, pillH, pillH / 2);
    if (unlocked > 0) {
      this.trackGraphics.fillStyle(COLORS.slotDoneEdge, 1);
      this.trackGraphics.fillRoundedRect(x, y, (pillW * unlocked) / total, pillH, pillH / 2);
    }
  }

  private drawGrid(): void {
    this.gridLayer = this.add.container(0, 0);
    this.renderPage();
  }

  private getPerPage(isPortrait: boolean): number {
    return isPortrait ? PORTRAIT_WORDBOOK_PER_PAGE : WORDBOOK_PER_PAGE;
  }

  private getColumns(isPortrait: boolean): number {
    return isPortrait ? PORTRAIT_WORDBOOK.columns : WORDBOOK.columns;
  }

  private pages(isPortrait = this.layout.metrics.isPortrait): number {
    return Math.max(1, Math.ceil(this.entries.length / this.getPerPage(isPortrait)));
  }

  private renderPage(): void {
    this.gridLayer.removeAll(true);

    if (this.entries.length === 0) {
      this.drawEmptyState();
      return;
    }

    const isPortrait = this.layout.metrics.isPortrait;
    const perPage = this.getPerPage(isPortrait);
    const columns = this.getColumns(isPortrait);

    const start = this.page * perPage;
    const slice = this.entries.slice(start, start + perPage);

    slice.forEach((entry, i) => {
      const rowStart = Math.floor(i / columns) * columns;
      const rowLen = Math.min(columns, slice.length - rowStart);
      const col = i - rowStart;
      const row = Math.floor(i / columns);
      this.drawCard(entry, wordbookColumnX(col, rowLen, isPortrait), wordbookRowY(row, isPortrait));
    });
  }

  private drawEmptyState(): void {
    const isPortrait = this.layout.metrics.isPortrait;
    const cx = this.layout.metrics.centreX;
    const text = this.add
      .text(cx, isPortrait ? 520 : 380, 'No words yet.\nPlay a level to fill your wordbook!', {
        fontFamily: FONT_FAMILY,
        fontSize: isPortrait ? '32px' : '38px',
        color: '#7f95ab',
        align: 'center',
        lineSpacing: 12,
      })
      .setOrigin(0.5);

    // Must live in the grid layer: renderPage() clears it with removeAll(true) on
    // every re-layout (orientation change). A root-level text leaks one copy per
    // rotation, stacking duplicates on top of each other.
    this.gridLayer.add(text);
  }

  private drawCard(entry: WordbookEntry, x: number, y: number): void {
    const { width, height } = WORDBOOK.card;
    const bg = this.add.image(0, 0, ATLAS_KEY, FRAMES.card).setDisplaySize(width, height);

    const wellX = wordbookThumbX();
    const well = this.add
      .image(wellX, 0, ATLAS_KEY, FRAMES.panel)
      .setDisplaySize(WORDBOOK_THUMB.size, WORDBOOK_THUMB.size);
    well.setTint(0xf2f8fc);

    const imageKey = imageKeyFor(entry.category, entry.display);
    const thumb = makeArtView(this, {
      x: wellX,
      y: 0,
      size: WORDBOOK_THUMB.size - 8,
      imageKey,
      placeholderFrame: FRAMES.dot,
    });
    thumb.image.setVisible(false);

    const wordX = wordbookWordX();
    const word = this.add
      .text(wordX, WORDBOOK_CARD_TEXT.wordY, entry.display, {
        fontFamily: FONT_FAMILY,
        fontSize: entry.display.length > 8 ? '24px' : entry.display.length > 5 ? '28px' : '32px',
        color: '#21324a',
        fontStyle: 'bold',
        align: 'center',
        wordWrap: { width: wordbookTextWidth(), useAdvancedWrap: true },
      })
      .setOrigin(0.5);

    const manifestEntry = manifestEntryById(entry.levelId);
    const metaLabel = `Tier ${entry.tier}${manifestEntry ? ` · ${manifestEntry.category}` : ''}`;
    const meta = this.add
      .text(wordbookTextRight(), WORDBOOK_CARD_TEXT.metaY, metaLabel, {
        fontFamily: FONT_FAMILY,
        fontSize: '15px',
        color: '#7f95ab',
      })
      .setOrigin(1, 0.5);

    const speakerBg = this.add.circle(
      WORDBOOK_SPEAKER.x,
      WORDBOOK_SPEAKER.y,
      WORDBOOK_SPEAKER.radius,
      0xeef6fd,
    );
    const speaker = this.add
      .image(WORDBOOK_SPEAKER.x, WORDBOOK_SPEAKER.y, ATLAS_KEY, FRAMES.speaker)
      .setScale(0.32);

    const card = this.add.container(x, y, [bg, well, thumb.image, word, meta, speakerBg, speaker]);
    card.setSize(width, height);
    card.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, width, height),
      Phaser.Geom.Rectangle.Contains,
    );
    card.on(Phaser.Input.Events.POINTER_DOWN, () => {
      this.tweens.add({ targets: card, scale: 0.96, duration: 80, yoyo: true });
      if (manifestEntry) void preloadLevel(manifestEntry.id);
    });
    card.on(Phaser.Input.Events.POINTER_UP, () => {
      void this.audio.playWord(entry.audioWord);
      this.tweens.add({ targets: speaker, scale: 0.46, duration: 110, yoyo: true });
    });

    this.gridLayer.add(card);

    void thumb.ready.then((ok) => {
      if (ok && card.active) thumb.image.setVisible(true);
    });
  }

  private drawPager(): void {
    const isPortrait = this.layout.metrics.isPortrait;
    const cx = this.layout.metrics.centreX;
    const pages = this.pages(isPortrait);

    this.prevButton = makeEdgeIconButton(this, this.layout, {
      edge: 'left',
      inset: isPortrait ? PORTRAIT_WORDBOOK.pagerInset : WORDBOOK.pagerInset,
      y: isPortrait ? PORTRAIT_WORDBOOK.pagerY : WORDBOOK.pagerY,
      frame: FRAMES.arrowLeft,
      size: isPortrait ? PORTRAIT_WORDBOOK.pagerButtonSize : WORDBOOK.pagerButtonSize,
      sfx: this.clickSfx,
      onClick: () => this.goToPage(this.page - 1),
    });

    this.nextButton = makeEdgeIconButton(this, this.layout, {
      edge: 'right',
      inset: isPortrait ? PORTRAIT_WORDBOOK.pagerInset : WORDBOOK.pagerInset,
      y: isPortrait ? PORTRAIT_WORDBOOK.pagerY : WORDBOOK.pagerY,
      frame: FRAMES.arrowRight,
      size: isPortrait ? PORTRAIT_WORDBOOK.pagerButtonSize : WORDBOOK.pagerButtonSize,
      sfx: this.clickSfx,
      onClick: () => this.goToPage(this.page + 1),
    });

    this.pagerText = makeText(
      this,
      cx,
      isPortrait ? PORTRAIT_WORDBOOK.pagerCaptionY : WORDBOOK.pagerCaptionY,
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

  private repositionElements(stage: StageMetrics): void {
    const isPortrait = stage.isPortrait;
    const cx = stage.centreX;

    const panelConfig = isPortrait ? PORTRAIT_WORDBOOK.panel : WORDBOOK.panel;
    this.panel.setPosition(cx, panelConfig.y);
    this.panel.setDisplaySize(panelConfig.width, panelConfig.height);

    this.titleText.setPosition(cx, isPortrait ? 140 : 78);
    this.titleText.setFontSize(isPortrait ? 46 : 52);
    this.subtitleText.setPosition(cx, isPortrait ? 190 : 130);
    this.subtitleText.setFontSize(isPortrait ? 24 : 26);
    this.drawProgressPill(cx, isPortrait);

    this.layout.setAnchorY(
      this.prevButton,
      isPortrait ? PORTRAIT_WORDBOOK.pagerY : WORDBOOK.pagerY,
    );
    this.layout.setAnchorY(
      this.nextButton,
      isPortrait ? PORTRAIT_WORDBOOK.pagerY : WORDBOOK.pagerY,
    );

    const maxPages = this.pages(isPortrait);
    if (this.page >= maxPages) this.page = maxPages - 1;
    if (this.page < 0) this.page = 0;

    this.pagerText.setPosition(
      cx,
      isPortrait ? PORTRAIT_WORDBOOK.pagerCaptionY : WORDBOOK.pagerCaptionY,
    );
    this.pagerText.setText(this.entries.length > 0 ? `Page ${this.page + 1} / ${maxPages}` : '');
    const paging = maxPages > 1;
    this.prevButton.setVisible(paging);
    this.nextButton.setVisible(paging);
    this.refreshPagerButtons(maxPages);

    this.renderPage();
  }

  /** Bottom edge of the grid, exported for the layout regression test. */
  static gridBottom(): number {
    return WORDBOOK_GRID_BOTTOM;
  }
}
