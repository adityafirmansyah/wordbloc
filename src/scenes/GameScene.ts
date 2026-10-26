import Phaser from 'phaser';
import { AudioManager } from '../game/audio';
import {
  levelManifest,
  loadLevel,
  manifestCount,
  manifestEntryById,
  manifestIndexOf,
  nextLevelManifest,
  preloadLevel,
} from '../game/levels';
import {
  buildTray,
  isPuzzleComplete,
  resolveDrop,
  targetUnits,
  type TrayItem,
} from '../game/puzzle';
import {
  ATLAS_KEY,
  BANDS,
  COLORS,
  FONT_FAMILY,
  FRAMES,
  ISLAND_CENTRE_X,
  SCENES,
  SLOT_GAP,
  TILE_HEIGHT,
  TRAY_GAP,
  TRAY_MAX_WIDTH,
  TRAY_ROW_GAP,
  chunkFrameFor,
  slotDoneFrameFor,
  slotFrameFor,
  tileFrameFor,
  tileWidth,
  withinDropZone,
} from '../game/theme';
import type { Level, Mechanic } from '../game/levelTypes';
import { makeEdgeIconButton, makeText } from '../ui/kit';
import { StageLayout } from '../ui/stage';

interface GameSceneData {
  levelId?: string;
}

interface SlotView {
  index: number;
  unit: string;
  x: number;
  y: number;
  width: number;
  height: number;
  bg: Phaser.GameObjects.Image;
  ghost: Phaser.GameObjects.Text | null;
  filledBy: TileView | null;
}

interface TileView {
  item: TrayItem;
  container: Phaser.GameObjects.Container;
  width: number;
  height: number;
  label: Phaser.GameObjects.Text;
  bg: Phaser.GameObjects.Image;
  home: { x: number; y: number };
  placedSlot: SlotView | null;
}

const DRAG_DEPTH = 1000;

/**
 * The core word-building loop.
 *
 * Drag a tile onto a slot:
 *   - correct  -> magnetic snap, phoneme audio, slot locks, tile is consumed
 *   - wrong    -> tween back to its tray home, NO buzzer, NO penalty, no life loss
 *
 * pointer events only (`scene.input`), so mouse + touch + pen behave identically.
 */
export class GameScene extends Phaser.Scene {
  private level!: Level;
  private audio!: AudioManager;
  private layout!: StageLayout;

  /** Level id requested by the previous scene; resolved asynchronously in create(). */
  private requestedLevelId = 'lvl_0001';
  /** Bumped per load so a superseded/short-circuited load cannot draw. */
  private loadToken = 0;
  private board: Phaser.GameObjects.Container | null = null;

  private slots: SlotView[] = [];
  private tiles: TileView[] = [];
  private filled: (string | null)[] = [];

  /** Slot the dragged tile is currently overlapping (highlighted). */
  private hoverSlot: SlotView | null = null;
  private dragging: TileView | null = null;
  private mutedLabel!: Phaser.GameObjects.Text;
  private solved = false;
  private wrongDrops = 0;

  constructor() {
    super(SCENES.game);
  }

  init(data: GameSceneData): void {
    // No level data is touched here: init() is synchronous and the puzzle file is
    // a lazily-imported chunk, so the id is only recorded and resolved in create().
    this.requestedLevelId = data.levelId ?? 'lvl_0001';
  }

  create(): void {
    this.audio = new AudioManager(this);
    this.audio.setEnabled(this.registry.get('muted') !== true);

    // Full-bleed stage (camera zoom + centred content island). Everything below
    // anchors to the island centre; only the header controls and decorations hug
    // the live stage edges.
    this.layout = new StageLayout(this);

    this.slots = [];
    this.tiles = [];
    this.hoverSlot = null;
    this.dragging = null;
    this.solved = false;
    this.wrongDrops = 0;
    this.board = null;

    // Unknown ids fall back to the first manifest entry, exactly as before, but
    // without needing any level file in memory to decide.
    const entry = manifestEntryById(this.requestedLevelId) ?? levelManifest().levels[0];
    if (!entry) {
      throw new Error('WordBloc GameScene: the level manifest is empty.');
    }
    this.registry.set('currentLevelId', entry.id);

    this.drawLoading(entry.display);
    void this.loadRequestedLevel(entry.id);
  }

  /**
   * Pulls the puzzle chunk and draws the board when it arrives.
   *
   * The scene stays responsive while the chunk loads (a short "Loading <word>"
   * card covers the stage), and a load that resolves after the player has already
   * navigated away is discarded via the token check.
   */
  private async loadRequestedLevel(id: string): Promise<void> {
    const token = (this.loadToken += 1);
    let level: Level;
    try {
      level = await loadLevel(id);
    } catch (error) {
      if (token !== this.loadToken || !this.scene.isActive()) return;
      this.showLoadFailure(error);
      return;
    }
    if (token !== this.loadToken || !this.scene.isActive()) return;

    this.level = level;
    this.clearLoading();
    this.drawBoard();

    // Warm the next level while this one is being played, so "Next" is instant.
    const upcoming = nextLevelManifest(id);
    if (upcoming) void preloadLevel(upcoming.id);
  }

  private showLoadFailure(error: unknown): void {
    console.error('WordBloc: level failed to load.', error);
    // Drop the loading card first, or its "Loading…" text sits under the error.
    this.clearLoading();

    // Keep the diagnostic detail but wrap it: a raw Vite import error carries a
    // full asset URL and used to run 300+px off each side of the stage.
    const detail = error instanceof Error ? error.message : String(error);
    makeText(this, ISLAND_CENTRE_X, 372, 'Could not load this level.', 34, '#c24848', true);
    this.add
      .text(ISLAND_CENTRE_X, 416, detail, {
        fontFamily: FONT_FAMILY,
        fontSize: '22px',
        color: '#54708c',
        align: 'center',
        wordWrap: { width: 1000, useAdvancedWrap: true },
        lineSpacing: 6,
      })
      .setOrigin(0.5, 0)
      .setDepth(5);

    makeEdgeIconButton(this, this.layout, {
      edge: 'left',
      inset: 92,
      y: BANDS.trayCenterY,
      frame: FRAMES.home,
      size: 132,
      onClick: () => this.scene.start(SCENES.menu),
    });
  }

  // -------------------------------------------------------------- loading card

  private drawLoading(display: string): void {
    this.board = this.add.container(0, 0);

    const card = this.add.image(ISLAND_CENTRE_X, 360, ATLAS_KEY, FRAMES.panel);
    card.setDisplaySize(520, 180);
    this.board.add(card);
    this.board.add(makeText(this, ISLAND_CENTRE_X, 332, 'Loading…', 40, '#21324a', true));
    this.board.add(makeText(this, ISLAND_CENTRE_X, 386, display, 30, '#7f95ab'));

    // Escape hatch while the chunk is in flight: without it a stalled download
    // would trap the player on a card with no controls at all.
    const home = makeEdgeIconButton(this, this.layout, {
      edge: 'left',
      inset: 92,
      y: BANDS.headerCenterY,
      frame: FRAMES.home,
      size: 132,
      onClick: () => this.scene.start(SCENES.menu),
    });
    home.setDepth(20);
    this.board.add(home);
  }

  private clearLoading(): void {
    this.board?.destroy(true);
    this.board = null;
  }

  private drawBoard(): void {
    this.filled = targetUnits(this.level).map(() => null);

    this.drawHeader();
    this.drawArt();
    this.drawHint();
    this.buildSlots();
    this.buildTray();

    // Drag wiring (pointer covers mouse, touch and pen). Movement is handled by
    // each tile's DRAG event, so no global pointer-move listener is needed.
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);

    // Phrase the word once the scene settles (audio may be blocked pre-gesture).
    this.time.delayedCall(400, () => this.audio.playWord(this.level.audio_word));
  }

  // ---------------------------------------------------------------- chrome

  private drawHeader(): void {
    // Header controls hug the LIVE stage edges: on a 2.17:1 phone stage a fixed
    // x=92 would sit ~340px inside the frame in world space and drift out of it.
    const back = makeEdgeIconButton(this, this.layout, {
      edge: 'left',
      inset: 92,
      y: BANDS.headerCenterY,
      frame: FRAMES.home,
      size: 132,
      onClick: () => this.scene.start(SCENES.menu),
    });
    back.setDepth(20);

    const muted = this.registry.get('muted') === true;
    const sound = makeEdgeIconButton(this, this.layout, {
      edge: 'right',
      inset: 92,
      y: BANDS.headerCenterY,
      frame: muted ? FRAMES.lock : FRAMES.speaker,
      size: 132,
      onClick: () => this.toggleMute(sound),
    });
    sound.setDepth(20);
    this.mutedLabel = makeText(this, 0, 158, 'muted', 20, '#c24848', true);
    this.layout.attach(this.mutedLabel, { kind: 'right', inset: 92 });
    this.mutedLabel.setDepth(20);
    this.mutedLabel.setVisible(muted);

    const tierLabel = `Tier ${this.level.tier}`;
    makeText(this, ISLAND_CENTRE_X, BANDS.headerCenterY - 14, tierLabel, 30, '#54708c', true);
    makeText(
      this,
      ISLAND_CENTRE_X,
      BANDS.headerCenterY + 26,
      `Level ${manifestIndexOf(this.level.id) + 1} of ${this.registry.get('levelCount') ?? manifestCount()}`,
      24,
      '#7f95ab',
    );
  }

  /**
   * Mute toggle. Only flips the audio flag — it must NOT restart the scene:
   * a kid who has assembled half a word and then mutes the sound would lose it
   * (measured: filled ['C','A',null] came back [null,null,null]).
   */
  private toggleMute(button: Phaser.GameObjects.Container): void {
    const next = !(this.registry.get('muted') === true);
    this.registry.set('muted', next);
    this.audio.setEnabled(!next);
    const icon = button.getAt(1);
    if (icon instanceof Phaser.GameObjects.Image) {
      icon.setFrame(next ? FRAMES.lock : FRAMES.speaker);
    }
    this.mutedLabel.setVisible(next);
  }

  /** Procedural "illustration" placeholder: a tinted card + category glyph. */
  private drawArt(): void {
    const { width, height } = BANDS.artSize;
    const card = this.add.image(ISLAND_CENTRE_X, BANDS.artCenterY, ATLAS_KEY, FRAMES.card);
    card.setDisplaySize(width, height);
    card.setDepth(1);

    const glyph = this.add.graphics();
    glyph.setDepth(2);
    const palette = [0xffd9c7, 0xc7e9ff, 0xd8ffc7, 0xfff0c7, 0xe6ccff];
    const seed = this.level.id.charCodeAt(this.level.id.length - 1) * 37;
    glyph.fillStyle(palette[seed % palette.length] ?? 0xffd9c7, 1);
    glyph.fillRoundedRect(
      ISLAND_CENTRE_X - width / 2 + 10,
      BANDS.artCenterY - height / 2 + 10,
      width - 20,
      height - 20,
      18,
    );
    glyph.fillStyle(0xffffff, 0.9);
    glyph.fillCircle(ISLAND_CENTRE_X, BANDS.artCenterY, 46);
    this.add
      .text(ISLAND_CENTRE_X, BANDS.artCenterY, this.level.display.charAt(0).toUpperCase(), {
        fontFamily: FONT_FAMILY,
        fontSize: '64px',
        color: '#21324a',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(3);
  }

  private drawHint(): void {
    if (this.level.hint) {
      makeText(this, ISLAND_CENTRE_X, BANDS.hintY, this.level.hint, 28, '#54708c');
    }
  }

  // ---------------------------------------------------------------- slots

  private mechanicLabel(mechanic: Mechanic): string {
    switch (mechanic) {
      case 'letter_drag':
        return 'Drag the letters';
      case 'syllable_tap':
        return 'Drag the chunks';
      case 'compound':
        return 'Join the two words';
      case 'affix':
        return 'Add the prefix or suffix';
      default:
        return 'Drag the tiles';
    }
  }

  private buildSlots(): void {
    const units = targetUnits(this.level);
    const widths = units.map((unit) => tileWidth(unit.unit));
    const total =
      widths.reduce<number>((acc, w) => acc + w, 0) + SLOT_GAP * Math.max(0, units.length - 1);
    // Centred on the content ISLAND, not on a hardcoded 1280: the island is what
    // the camera keeps under the viewport centre at every aspect ratio.
    let cursorX = ISLAND_CENTRE_X - total / 2;

    units.forEach((target, index) => {
      const width = widths[index] ?? 128;
      const x = cursorX + width / 2;
      const y = BANDS.slotsCenterY;

      const bg = this.add.image(x, y, ATLAS_KEY, slotFrameFor(target.unit));
      bg.setDisplaySize(width, TILE_HEIGHT);
      bg.setDepth(5);

      // Ghost letters (T1 only, per the spec's tier table).
      let ghost: Phaser.GameObjects.Text | null = null;
      if (this.level.ghost_letters) {
        ghost = this.add
          .text(x, y - 4, target.unit, {
            fontFamily: FONT_FAMILY,
            fontSize: '58px',
            color: '#b9cfe0',
            fontStyle: 'bold',
          })
          .setOrigin(0.5)
          .setDepth(6);
      }

      const slot: SlotView = {
        index,
        unit: target.unit,
        x,
        y,
        width,
        height: TILE_HEIGHT,
        bg,
        ghost,
        filledBy: null,
      };
      this.slots.push(slot);
      cursorX += width + SLOT_GAP;
    });

    makeText(
      this,
      ISLAND_CENTRE_X,
      BANDS.mechanicY,
      this.mechanicLabel(this.level.mechanic),
      26,
      '#7f95ab',
    );
  }

  // ----------------------------------------------------------------- tray

  private buildTray(): void {
    const items = buildTray(this.level);
    const isChunk = this.level.mechanic !== 'letter_drag';

    // Lay the tray out in centred rows so long trays never overflow.
    const rows: TrayItem[][] = [];
    let row: TrayItem[] = [];
    let rowWidth = 0;
    for (const item of items) {
      const w = tileWidth(item.unit);
      const add = row.length === 0 ? w : w + TRAY_GAP;
      if (rowWidth + add > TRAY_MAX_WIDTH && row.length > 0) {
        rows.push(row);
        row = [item];
        rowWidth = w;
      } else {
        row.push(item);
        rowWidth += add;
      }
    }
    if (row.length > 0) rows.push(row);

    const rowHeight = TILE_HEIGHT + TRAY_ROW_GAP;
    const blockHeight = rows.length * rowHeight - TRAY_ROW_GAP;
    const startY = BANDS.trayCenterY - blockHeight / 2 + TILE_HEIGHT / 2;
    // Never let the tray cross the safe bottom (all seed levels fit in 1-2 rows).
    const lastRowBottom = startY + (rows.length - 1) * rowHeight + TILE_HEIGHT / 2;
    const shift = lastRowBottom > BANDS.safeBottom ? lastRowBottom - BANDS.safeBottom : 0;
    const trayTop = startY - shift;

    rows.forEach((trayRow, rowIndex) => {
      const widths = trayRow.map((item) => tileWidth(item.unit));
      const total =
        widths.reduce<number>((acc, w) => acc + w, 0) + TRAY_GAP * Math.max(0, trayRow.length - 1);
      let cursorX = ISLAND_CENTRE_X - total / 2;
      const y = trayTop + rowIndex * rowHeight;

      trayRow.forEach((item, i) => {
        const width = widths[i] ?? 128;
        const x = cursorX + width / 2;
        const frame = isChunk ? chunkFrameFor(item.unit) : tileFrameFor(item.unit);
        const bg = this.add.image(0, 0, ATLAS_KEY, frame);
        bg.setDisplaySize(width, TILE_HEIGHT);
        const label = this.add
          .text(0, -4, item.unit, {
            fontFamily: FONT_FAMILY,
            fontSize: '58px',
            color: isChunk ? '#13351b' : '#3a2a00',
            fontStyle: 'bold',
          })
          .setOrigin(0.5);

        const container = this.add.container(x, y, [bg, label]);
        container.setSize(width, TILE_HEIGHT);
        container.setDepth(10);
        // Hit rect starts at 0,0 — Phaser adds displayOrigin before Contains,
        // so -w/2 here would shift the touch area left by half a tile.
        container.setInteractive(
          new Phaser.Geom.Rectangle(0, 0, width, TILE_HEIGHT),
          Phaser.Geom.Rectangle.Contains,
        );
        // Dragging is delta-based so the grab point is preserved.
        this.input.setDraggable(container, true);

        const view: TileView = {
          item,
          container,
          width,
          height: TILE_HEIGHT,
          label,
          bg,
          home: { x, y },
          placedSlot: null,
        };

        container.on(Phaser.Input.Events.POINTER_DOWN, () => this.onTileGrab(view));
        container.on(Phaser.Input.Events.DRAG_START, () => this.onTileGrab(view));
        // Phaser's DRAG signature is (pointer, dragX, dragY) where dragX/dragY are
        // the object's new world position (pointer delta applied to its origin).
        container.on(
          Phaser.Input.Events.DRAG,
          (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) =>
            this.updateDrag(view, dragX, dragY),
        );

        this.tiles.push(view);
        cursorX += width + TRAY_GAP;
      });
    });
  }

  // ----------------------------------------------------------------- drag

  private onTileGrab(tile: TileView): void {
    if (this.solved || tile.placedSlot) return;
    if (this.dragging && this.dragging !== tile) return;
    this.dragging = tile;
    tile.container.setDepth(DRAG_DEPTH);
    this.tweens.killTweensOf(tile.container);
    this.tweens.add({
      targets: tile.container,
      scale: 1.08,
      duration: 120,
      ease: 'Back.Out',
    });
  }

  private updateDrag(tile: TileView, dragX: number, dragY: number): void {
    if (this.dragging !== tile) return;
    tile.container.setPosition(dragX, dragY);

    // Magnetic hover: highlight the slot under the tile, if it would accept it.
    const over = this.slotUnder(tile);
    if (over !== this.hoverSlot) {
      this.hoverSlot = over;
      this.slots.forEach((slot) => {
        slot.bg.setScale(1);
        slot.bg.setFrame(slot.filledBy ? slotDoneFrameFor(slot.unit) : slotFrameFor(slot.unit));
        slot.bg.setDisplaySize(slot.width, slot.height);
      });
      if (over) {
        over.bg.setFrame(slotDoneFrameFor(over.unit));
        over.bg.setDisplaySize(over.width, over.height);
        over.bg.setScale(1.06);
      }
    }
  }

  /** The unfilled slot the tile is over and that would accept it. */
  private slotUnder(tile: TileView): SlotView | null {
    const slot = this.slotUnderNearest(tile);
    if (!slot) return null;
    return resolveDrop(this.level, tile.item.unit, slot.index, this.filled).snapTo !== null
      ? slot
      : null;
  }

  private onPointerUp(): void {
    const tile = this.dragging;
    if (!tile) return;
    this.dragging = null;

    this.slots.forEach((slot) => {
      slot.bg.setScale(1);
      slot.bg.setFrame(slot.filledBy ? slotDoneFrameFor(slot.unit) : slotFrameFor(slot.unit));
      slot.bg.setDisplaySize(slot.width, slot.height);
    });
    this.hoverSlot = null;

    const target = this.slotUnderNearest(tile);
    if (target) {
      this.placeTile(tile, target);
    } else {
      this.bounceHome(tile);
    }
  }

  /**
   * Nearest unfilled slot inside the shared drop zone (`withinDropZone`), or null.
   * Hover highlighting and the release decision both call this, so what lights up
   * green is exactly what accepts the tile.
   */
  private slotUnderNearest(tile: TileView): SlotView | null {
    let best: SlotView | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const slot of this.slots) {
      if (slot.filledBy) continue;
      if (!withinDropZone(tile.container, slot)) continue;
      const dist = Math.abs(tile.container.x - slot.x) + Math.abs(tile.container.y - slot.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = slot;
      }
    }
    return best;
  }

  private placeTile(tile: TileView, slot: SlotView): void {
    const result = resolveDrop(this.level, tile.item.unit, slot.index, this.filled);
    if (result.snapTo === null) {
      // Wrong drop: bounce back. No buzzer, no penalty, no life lost.
      this.wrongDrops += 1;
      this.bounceHome(tile);
      return;
    }

    slot.filledBy = tile;
    tile.placedSlot = slot;
    this.filled[slot.index] = slot.unit;

    tile.container.disableInteractive();
    tile.container.setDepth(8);

    // Magnetic snap: pull the tile into the slot centre with a spring feel.
    this.tweens.add({
      targets: tile.container,
      x: slot.x,
      y: slot.y,
      scale: 1,
      duration: 160,
      ease: 'Back.Out',
      onComplete: () => {
        slot.bg.setFrame(slotDoneFrameFor(slot.unit));
        slot.bg.setDisplaySize(slot.width, slot.height);
        slot.ghost?.setVisible(false);
      },
    });

    // PHONICS RULE: placing a tile speaks the PHONEME, never the letter name.
    const phonemeKey = targetUnits(this.level)[slot.index]?.phoneme ?? '';
    this.audio.playPhoneme(phonemeKey);
    this.popTile(slot);

    if (isPuzzleComplete(this.level, this.filled)) {
      this.onSolved();
    }
  }

  private popTile(slot: SlotView): void {
    this.tweens.add({
      targets: slot.bg,
      scaleX: 1.08,
      scaleY: 1.08,
      duration: 90,
      yoyo: true,
      ease: 'Quad.Out',
      onComplete: () => {
        slot.bg.setScale(1);
        slot.bg.setDisplaySize(slot.width, slot.height);
      },
    });
  }

  /** Wrong placement: tween back to the tray home. Silent and penalty-free. */
  private bounceHome(tile: TileView): void {
    this.tweens.killTweensOf(tile.container);
    this.tweens.add({
      targets: tile.container,
      x: tile.home.x,
      y: tile.home.y,
      scale: 1,
      duration: 340,
      ease: 'Back.Out',
      onComplete: () => {
        tile.container.setDepth(10);
        // A gentle wobble reads as "not here" without any error sound.
        this.tweens.add({
          targets: tile.container,
          angle: { from: -4, to: 4 },
          duration: 70,
          yoyo: true,
          repeat: 1,
          onComplete: () => {
            tile.container.setAngle(0);
          },
        });
      },
    });
  }

  // ---------------------------------------------------------------- solved

  private onSolved(): void {
    if (this.solved) return;
    this.solved = true;

    this.audio.playWord(this.level.audio_word);

    // Confetti from the atlas dot frame — no extra assets.
    this.time.delayedCall(120, () => this.confetti());

    this.time.delayedCall(900, () => {
      this.scene.start(SCENES.reward, { levelId: this.level.id });
    });
  }

  private confetti(): void {
    const stage = this.layout.metrics;
    for (let i = 0; i < 34; i += 1) {
      const x = Phaser.Math.Between(stage.left + 80, stage.right - 80);
      const dot = this.add.image(x, stage.top - 20, ATLAS_KEY, FRAMES.dot);
      dot.setDepth(900);
      dot.setTint(COLORS.confetti[i % COLORS.confetti.length] ?? 0xffffff);
      dot.setScale(Phaser.Math.FloatBetween(0.5, 1.1));
      this.tweens.add({
        targets: dot,
        y: stage.bottom + 40,
        x: x + Phaser.Math.Between(-90, 90),
        angle: Phaser.Math.Between(-360, 360),
        duration: Phaser.Math.Between(1100, 2100),
        ease: 'Quad.In',
        onComplete: () => dot.destroy(),
      });
    }
  }
}
