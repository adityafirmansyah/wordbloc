import Phaser from 'phaser';
import { AudioManager } from '../game/audio';
import { imageKeyFor } from '../game/assets';
import { manifestCount, manifestEntryById, preloadLevel } from '../game/levels';
import { wordbook, type WordbookEntry } from '../game/wordbook';
import {
  ATLAS_KEY,
  COLORS,
  FONT_FAMILY,
  FRAMES,
  ISLAND_CENTRE_X,
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
} from '../game/theme';
import { makeArtView } from '../ui/artView';
import { makeButton, makeEdgeIconButton, makeText } from '../ui/kit';
import { StageLayout } from '../ui/stage';

/**
 * Wordbook: every completed word, persisted in localStorage.
 * Each card replays the word audio. Locked (uncompleted) levels stay hidden so
 * the page lists only what the kid actually unlocked.
 *
 * Layout rule (see WORDBOOK in theme.ts): three rows of cards, pager arrows
 * OUTSIDE the card band on the left/right, page caption below the grid, Back in
 * the header. Nothing overlaps and nothing extends past the 720px island.
 *
 * On a full-bleed stage the centred parts (title, panel, grid) stay centred on
 * the island; the pager arrows and Back hug the LIVE stage edges instead of a
 * hardcoded 1280 so they are always inside the frame (and reachable with a thumb
 * on a wide phone screen).
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

  constructor() {
    super(SCENES.wordbook);
  }

  create(): void {
    this.audio = new AudioManager();
    this.audio.setEnabled(this.registry.get('muted') !== true);
    // A replayed word must stop when the kid leaves the Wordbook.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.release());
    // Autoplay policy: only a gesture can start the audio context, and this scene
    // is entered by tapping a button — the first tap on a card unlocks it.
    this.input.once(Phaser.Input.Events.POINTER_DOWN, () => void this.audio.unlock());
    this.entries = wordbook().entries();
    this.page = 0;

    this.drawBackdrop();
    this.drawHeader();
    this.drawGrid();
    this.drawPager();
  }

  private drawBackdrop(): void {
    // Full-bleed gradient (camera-zoomed over the whole stage) + a centred 980px
    // content panel: sky to every edge, content island in the middle.
    this.layout = new StageLayout(this, { backdrop: true });
    this.add
      .image(ISLAND_CENTRE_X, WORDBOOK.panel.y, ATLAS_KEY, FRAMES.panel)
      .setDisplaySize(WORDBOOK.panel.width, WORDBOOK.panel.height)
      .setDepth(0);
  }

  private drawHeader(): void {
    // Back sits in the header (it used to sit under the grid, covering row 3 and
    // overflowing the stage by 6px), pinned inside the live stage's left edge.
    const back = makeButton(this, {
      x: 0,
      y: WORDBOOK.backButtonY,
      label: 'Back',
      width: WORDBOOK.backButtonWidth,
      height: WORDBOOK.backButtonHeight,
      fontSize: 34,
      variant: 'alt',
      onClick: () => this.scene.start(SCENES.menu),
    });
    this.layout.attach(back, { kind: 'left', inset: WORDBOOK.backInset });

    makeEdgeIconButton(this, this.layout, {
      edge: 'right',
      inset: 92,
      y: WORDBOOK.backButtonY,
      frame: FRAMES.home,
      size: 132,
      onClick: () => this.scene.start(SCENES.menu),
    });

    makeText(this, ISLAND_CENTRE_X, 78, 'My Wordbook', 52, '#21324a', true);

    const total = manifestCount();
    const unlocked = this.entries.length;
    makeText(this, ISLAND_CENTRE_X, 130, `${unlocked} of ${total} words collected`, 26, '#54708c');

    // Progress pill, between the subtitle and the grid.
    const pillW = 420;
    const pillH = 16;
    const x = ISLAND_CENTRE_X - pillW / 2;
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
      .text(ISLAND_CENTRE_X, 380, 'No words yet.\nPlay a level to fill your wordbook!', {
        fontFamily: FONT_FAMILY,
        fontSize: '38px',
        color: '#7f95ab',
        align: 'center',
        lineSpacing: 12,
      })
      .setOrigin(0.5);
  }

  /**
   * One unlocked word: real sticker thumbnail + word + tier/category + replay.
   *
   * The thumbnail is the point of this screen — a kid who built "butterfly"
   * recognises the picture before reading the word. It loads asynchronously and
   * the card is tappable from the first frame: the art well shows the UI atlas
   * card frame until (or unless) the WebP arrives.
   */
  private drawCard(entry: WordbookEntry, x: number, y: number): void {
    const { width, height } = WORDBOOK.card;
    const bg = this.add.image(0, 0, ATLAS_KEY, FRAMES.card).setDisplaySize(width, height);

    // Art well: a rounded white plate so the transparent sticker sits on a panel
    // rather than directly on the card's own tint.
    const wellX = wordbookThumbX();
    const well = this.add
      .image(wellX, 0, ATLAS_KEY, FRAMES.panel)
      .setDisplaySize(WORDBOOK_THUMB.size, WORDBOOK_THUMB.size);
    well.setTint(0xf2f8fc);

    // `image` ref: the manifest row carries only category/display (schema 2 is
    // frozen), so the derive rule is the documented contract — proven against
    // every level file by `tests/assets.test.ts`.
    const imageKey = imageKeyFor(entry.category, entry.display);
    const thumb = makeArtView(this, {
      x: wellX,
      y: 0,
      size: WORDBOOK_THUMB.size - 8,
      imageKey,
      placeholderFrame: FRAMES.dot,
    });
    // Until the sticker lands, hide it: the well alone reads as "art pending",
    // whereas the dot placeholder looked like a deliberate lock badge.
    thumb.image.setVisible(false);

    const wordX = wordbookWordX();
    const word = this.add
      .text(wordX, WORDBOOK_CARD_TEXT.wordY, entry.display, {
        fontFamily: FONT_FAMILY,
        fontSize: entry.display.length > 8 ? '24px' : entry.display.length > 5 ? '28px' : '32px',
        color: '#21324a',
        fontStyle: 'bold',
        align: 'center',
        // Wrapped to the text column: the column's right edge is derived from the
        // speaker circle, so a long word can never grow into the replay button.
        wordWrap: { width: wordbookTextWidth(), useAdvancedWrap: true },
      })
      .setOrigin(0.5);

    // Manifest only: the card's tier/category metadata must not download a puzzle.
    const manifestEntry = manifestEntryById(entry.levelId);
    const metaLabel = `Tier ${entry.tier}${manifestEntry ? ` · ${manifestEntry.category}` : ''}`;
    const meta = this.add
      .text(wordbookTextRight(), WORDBOOK_CARD_TEXT.metaY, metaLabel, {
        fontFamily: FONT_FAMILY,
        fontSize: '15px',
        color: '#7f95ab',
      })
      // Right-aligned to the column edge: a longer category grows LEFT, away from
      // the speaker that sits just beyond that edge.
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
    // Whole card is a >=292x128 design px target (>=146x64 CSS at scale 0.5).
    // Rect starts at 0,0: Phaser adds displayOrigin before the Contains test.
    card.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, width, height),
      Phaser.Geom.Rectangle.Contains,
    );
    card.on(Phaser.Input.Events.POINTER_DOWN, () => {
      this.tweens.add({ targets: card, scale: 0.96, duration: 80, yoyo: true });
      // Warm this word's puzzle chunk as soon as the kid shows interest, so a
      // replay of the level starts instantly without blocking the card tap.
      if (manifestEntry) void preloadLevel(manifestEntry.id);
    });
    card.on(Phaser.Input.Events.POINTER_UP, () => {
      // Replay the recorded word (phonics contract: whole word here, not phonemes).
      void this.audio.playWord(entry.audioWord);
      this.tweens.add({ targets: speaker, scale: 0.46, duration: 110, yoyo: true });
    });

    this.gridLayer.add(card);

    // Reveal the thumbnail only once the card is in the layer: the page can be
    // re-rendered (or the scene left) while the WebP is still in flight.
    void thumb.ready.then((ok) => {
      if (ok && card.active) thumb.image.setVisible(true);
    });
  }

  private pages(): number {
    return Math.max(1, Math.ceil(this.entries.length / WORDBOOK_PER_PAGE));
  }

  private drawPager(): void {
    const pages = this.pages();

    // Side arrows: OUTSIDE the card band horizontally (cards span the island
    // middle) and vertically centred on the grid, so they never sit over a card.
    // Anchored to the live stage edges, they stay inside the frame on any aspect.
    this.prevButton = makeEdgeIconButton(this, this.layout, {
      edge: 'left',
      inset: WORDBOOK.pagerInset,
      y: WORDBOOK.pagerY,
      frame: FRAMES.arrowLeft,
      size: WORDBOOK.pagerButtonSize,
      onClick: () => this.goToPage(this.page - 1),
    });

    this.nextButton = makeEdgeIconButton(this, this.layout, {
      edge: 'right',
      inset: WORDBOOK.pagerInset,
      y: WORDBOOK.pagerY,
      frame: FRAMES.arrowRight,
      size: WORDBOOK.pagerButtonSize,
      onClick: () => this.goToPage(this.page + 1),
    });

    // Caption below the grid (grid ends at WORDBOOK_GRID_BOTTOM).
    this.pagerText = makeText(
      this,
      ISLAND_CENTRE_X,
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
