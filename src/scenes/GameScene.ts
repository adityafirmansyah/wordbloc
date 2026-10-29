import Phaser from 'phaser';
import { AudioManager, audioKeysForLevel, type SfxKey } from '../game/audio';
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
  PORTRAIT_BANDS,
  SCENES,
  TILE_CORNER_SLICE,
  TILE_HEIGHT,
  anchorX,
  artHaloColor,
  chunkFrameFor,
  slotDoneFrameFor,
  slotFrameFor,
  tileFontSize,
  tileFrameFor,
  tileWidth,
  withinDropZone,
  type StageMetrics,
} from '../game/theme';
import { computeSceneLayout } from '../game/gameLayout';
import type { Level, Mechanic } from '../game/levelTypes';
import { makeArtView } from '../ui/artView';
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
  bg: Phaser.GameObjects.NineSlice;
  ghost: Phaser.GameObjects.Text | null;
  filledBy: TileView | null;
}

interface TileView {
  item: TrayItem;
  container: Phaser.GameObjects.Container;
  width: number;
  height: number;
  label: Phaser.GameObjects.Text;
  bg: Phaser.GameObjects.NineSlice;
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
  /** True once the level's word has actually been heard from its MP3. */
  private introWordSpoken = false;

  // Tracked game objects for responsive re-layout on orientation change
  private backButton!: Phaser.GameObjects.Container;
  private soundButton!: Phaser.GameObjects.Container;
  private tierLabel!: Phaser.GameObjects.Text;
  private levelLabel!: Phaser.GameObjects.Text;
  private haloGraphics!: Phaser.GameObjects.Graphics;
  private artInitial!: Phaser.GameObjects.Text;
  private artImage!: Phaser.GameObjects.Image;
  private mechanicText!: Phaser.GameObjects.Text;
  private hintText: Phaser.GameObjects.Text | null = null;

  constructor() {
    super(SCENES.game);
  }

  init(data: GameSceneData): void {
    this.requestedLevelId = data.levelId ?? 'lvl_0001';
  }

  create(): void {
    this.audio = new AudioManager();
    this.audio.setEnabled(this.registry.get('muted') !== true);
    this.audio.preloadSfx();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.release());

    this.layout = new StageLayout(this);

    this.slots = [];
    this.tiles = [];
    this.hoverSlot = null;
    this.dragging = null;
    this.solved = false;
    this.wrongDrops = 0;
    this.introWordSpoken = false;
    this.board = null;

    const entry = manifestEntryById(this.requestedLevelId) ?? levelManifest().levels[0];
    if (!entry) {
      throw new Error('WordBloc GameScene: the level manifest is empty.');
    }
    this.registry.set('currentLevelId', entry.id);

    this.drawLoading(entry.display);
    void this.loadRequestedLevel(entry.id);

    this.layout.onStageChange((stage: StageMetrics) => {
      this.repositionBoard(stage);
    });
  }

  /**
   * Pulls the puzzle chunk and draws the board when it arrives.
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

    const upcoming = nextLevelManifest(id);
    if (upcoming) void preloadLevel(upcoming.id);
  }

  private showLoadFailure(error: unknown): void {
    console.error('WordBloc: level failed to load.', error);
    this.clearLoading();

    const cx = this.layout.metrics.centreX;
    const detail = error instanceof Error ? error.message : String(error);
    makeText(this, cx, 372, 'Could not load this level.', 34, '#c24848', true);
    this.add
      .text(cx, 416, detail, {
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
      inset: this.layout.metrics.isPortrait ? 80 : 92,
      y: this.layout.metrics.isPortrait ? PORTRAIT_BANDS.trayCenterY : BANDS.trayCenterY,
      frame: FRAMES.home,
      size: 132,
      sfx: this.clickSfx,
      onClick: () => this.scene.start(SCENES.menu),
    });
  }

  // -------------------------------------------------------------- loading card

  private drawLoading(display: string): void {
    this.board = this.add.container(0, 0);
    const isPortrait = this.layout.metrics.isPortrait;
    const cx = this.layout.metrics.centreX;
    const cy = isPortrait ? 520 : 360;

    const card = this.add.image(cx, cy, ATLAS_KEY, FRAMES.panel);
    card.setDisplaySize(520, 180);
    this.board.add(card);
    this.board.add(makeText(this, cx, cy - 28, 'Loading…', 40, '#21324a', true));
    this.board.add(makeText(this, cx, cy + 26, display, 30, '#7f95ab'));

    const home = makeEdgeIconButton(this, this.layout, {
      edge: 'left',
      inset: isPortrait ? 80 : 92,
      y: isPortrait ? PORTRAIT_BANDS.headerCenterY : BANDS.headerCenterY,
      frame: FRAMES.home,
      size: 132,
      sfx: this.clickSfx,
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

    this.audio.preload(audioKeysForLevel(this.level));

    this.drawHeader();
    this.drawArt();
    this.drawHint();
    this.buildSlots();
    this.buildTray();

    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);

    this.input.once(Phaser.Input.Events.POINTER_DOWN, () => this.unlockAudio());

    this.introWordSpoken = false;
    this.time.delayedCall(400, () => void this.speakIntroWord());
  }

  private unlockAudio(): void {
    void this.audio.unlock().then(() => {
      if (!this.scene.isActive()) return;
      if (!this.introWordSpoken) void this.speakIntroWord();
    });
  }

  private clickSfx = (key: SfxKey): void => {
    void this.audio.playSfx(key).catch(() => undefined);
  };

  private speakIntroWord(): Promise<void> {
    if (!this.level || this.introWordSpoken) return Promise.resolve();
    return this.audio.playWord(this.level.audio_word).then((result) => {
      if (result.outcome === 'file') this.introWordSpoken = true;
    });
  }

  // ---------------------------------------------------------------- chrome

  private drawHeader(): void {
    const isPortrait = this.layout.metrics.isPortrait;
    const cx = this.layout.metrics.centreX;
    const bands = isPortrait ? PORTRAIT_BANDS : BANDS;
    const inset = isPortrait ? 80 : 92;

    this.backButton = makeEdgeIconButton(this, this.layout, {
      edge: 'left',
      inset,
      y: bands.headerCenterY,
      frame: FRAMES.home,
      size: isPortrait ? 116 : 132,
      sfx: this.clickSfx,
      onClick: () => this.scene.start(SCENES.menu),
    });
    this.backButton.setDepth(20);

    const muted = this.registry.get('muted') === true;
    this.soundButton = makeEdgeIconButton(this, this.layout, {
      edge: 'right',
      inset,
      y: bands.headerCenterY,
      frame: muted ? FRAMES.lock : FRAMES.speaker,
      size: isPortrait ? 116 : 132,
      onClick: () => this.toggleMute(this.soundButton),
    });
    this.soundButton.setDepth(20);

    this.mutedLabel = makeText(this, 0, 158, 'muted', 20, '#c24848', true);
    this.layout.attach(this.mutedLabel, { kind: 'right', inset });
    this.mutedLabel.setDepth(20);
    this.mutedLabel.setVisible(muted);

    const tierLabel = `Tier ${this.level.tier}`;
    this.tierLabel = makeText(this, cx, bands.headerCenterY - 14, tierLabel, 30, '#54708c', true);
    this.levelLabel = makeText(
      this,
      cx,
      bands.headerCenterY + 26,
      `Level ${manifestIndexOf(this.level.id) + 1} of ${this.registry.get('levelCount') ?? manifestCount()}`,
      24,
      '#7f95ab',
    );
  }

  private toggleMute(button: Phaser.GameObjects.Container): void {
    const next = !(this.registry.get('muted') === true);
    this.registry.set('muted', next);
    this.audio.setEnabled(!next);
    if (!next) void this.audio.playSfx('sfx/click');
    const icon = button.getAt(1);
    if (icon instanceof Phaser.GameObjects.Image) {
      icon.setFrame(next ? FRAMES.lock : FRAMES.speaker);
    }
    this.mutedLabel.setVisible(next);
  }

  private paintHalo(x: number, y: number, radius: number): void {
    this.haloGraphics.clear();
    this.haloGraphics.fillStyle(artHaloColor(this.level.category), 1);
    this.haloGraphics.fillCircle(x, y, radius);
    this.haloGraphics.lineStyle(6, 0xffffff, 0.85);
    this.haloGraphics.strokeCircle(x, y, radius);
  }

  private drawArt(): void {
    const isPortrait = this.layout.metrics.isPortrait;
    const cx = this.layout.metrics.centreX;
    const sceneLayout = computeSceneLayout(this.level, isPortrait, cx);
    const { width } = sceneLayout.artSize;
    const imageKey = this.level.image;

    this.haloGraphics = this.add.graphics().setDepth(1);
    this.paintHalo(cx, sceneLayout.artCenterY, sceneLayout.artHaloRadius);

    this.artInitial = this.add
      .text(cx, sceneLayout.artCenterY, this.level.display.charAt(0).toUpperCase(), {
        fontFamily: FONT_FAMILY,
        fontSize: isPortrait ? '130px' : sceneLayout.isMultiRowLandscape ? '60px' : '88px',
        color: '#21324a',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(2);

    const { image, ready } = makeArtView(this, {
      x: cx,
      y: sceneLayout.artCenterY,
      size: width,
      imageKey,
      placeholderFrame: FRAMES.card,
    });
    image.setDepth(3);
    image.setVisible(false);
    this.artImage = image;

    void ready.then((ok) => {
      if (!this.scene.isActive()) return;
      if (ok) {
        this.artImage.setVisible(true);
        this.artInitial.setVisible(false);
      } else {
        console.warn(`WordBloc: illustration "${imageKey}" unavailable; drawing the initial.`);
      }
    });
  }

  private drawHint(): void {
    const isPortrait = this.layout.metrics.isPortrait;
    const cx = this.layout.metrics.centreX;
    const sceneLayout = computeSceneLayout(this.level, isPortrait, cx);
    if (this.level.hint) {
      this.hintText = makeText(this, cx, sceneLayout.hintY, this.level.hint, 28, '#54708c');
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
    const isPortrait = this.layout.metrics.isPortrait;
    const cx = this.layout.metrics.centreX;
    const sceneLayout = computeSceneLayout(this.level, isPortrait, cx);
    const units = targetUnits(this.level);
    const positions = sceneLayout.slotPositions;

    units.forEach((target, index) => {
      const pos = positions[index] ?? { x: cx, y: sceneLayout.artCenterY, width: 128 };
      const { x, y, width } = pos;

      const bg = this.add.nineslice(
        x,
        y,
        ATLAS_KEY,
        slotFrameFor(target.unit),
        width,
        TILE_HEIGHT,
        TILE_CORNER_SLICE,
        TILE_CORNER_SLICE,
        TILE_CORNER_SLICE,
        TILE_CORNER_SLICE,
      );
      bg.setDepth(5);

      let ghost: Phaser.GameObjects.Text | null = null;
      if (this.level.ghost_letters) {
        ghost = this.add
          .text(x, y - 4, target.unit, {
            fontFamily: FONT_FAMILY,
            fontSize: `${tileFontSize(target.unit)}px`,
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
    });

    this.mechanicText = makeText(
      this,
      cx,
      sceneLayout.mechanicY,
      this.mechanicLabel(this.level.mechanic),
      26,
      '#7f95ab',
    );
  }

  // ----------------------------------------------------------------- tray

  private buildTray(): void {
    const isPortrait = this.layout.metrics.isPortrait;
    const cx = this.layout.metrics.centreX;
    const items = buildTray(this.level);
    const isChunk = this.level.mechanic !== 'letter_drag';
    const sceneLayout = computeSceneLayout(this.level, isPortrait, cx);
    const positions = sceneLayout.trayPositions;

    items.forEach((item, index) => {
      const pos = positions[index] ?? { x: cx, y: BANDS.trayCenterY };
      const width = tileWidth(item.unit);
      const { x, y } = pos;

      const frame = isChunk ? chunkFrameFor(item.unit) : tileFrameFor(item.unit);
      const bg = this.add.nineslice(
        0,
        0,
        ATLAS_KEY,
        frame,
        width,
        TILE_HEIGHT,
        TILE_CORNER_SLICE,
        TILE_CORNER_SLICE,
        TILE_CORNER_SLICE,
        TILE_CORNER_SLICE,
      );
      const label = this.add
        .text(0, -4, item.unit, {
          fontFamily: FONT_FAMILY,
          fontSize: `${tileFontSize(item.unit)}px`,
          color: isChunk ? '#13351b' : '#3a2a00',
          fontStyle: 'bold',
        })
        .setOrigin(0.5);

      const container = this.add.container(x, y, [bg, label]);
      container.setSize(width, TILE_HEIGHT);
      container.setDepth(10);
      container.setInteractive(
        new Phaser.Geom.Rectangle(0, 0, width, TILE_HEIGHT),
        Phaser.Geom.Rectangle.Contains,
      );
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
      container.on(
        Phaser.Input.Events.DRAG,
        (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) =>
          this.updateDrag(view, dragX, dragY),
      );

      this.tiles.push(view);
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

    const over = this.slotUnder(tile);
    if (over !== this.hoverSlot) {
      this.hoverSlot = over;
      this.slots.forEach((slot) => {
        slot.bg.setScale(1);
        slot.bg.setFrame(slot.filledBy ? slotDoneFrameFor(slot.unit) : slotFrameFor(slot.unit));
        slot.bg.setSize(slot.width, slot.height);
        slot.bg.setDisplaySize(slot.width, slot.height);
      });
      if (over) {
        over.bg.setFrame(slotDoneFrameFor(over.unit));
        over.bg.setSize(over.width, over.height);
        over.bg.setDisplaySize(over.width, over.height);
        over.bg.setScale(1.06);
      }
    }
  }

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
      slot.bg.setSize(slot.width, slot.height);
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
      this.wrongDrops += 1;
      this.bounceHome(tile);
      return;
    }

    slot.filledBy = tile;
    tile.placedSlot = slot;
    this.filled[slot.index] = slot.unit;

    tile.container.disableInteractive();
    tile.container.setDepth(8);

    void this.audio.playSfx('sfx/snap');

    this.tweens.add({
      targets: tile.container,
      x: slot.x,
      y: slot.y,
      scale: 1,
      duration: 160,
      ease: 'Back.Out',
      onComplete: () => {
        slot.bg.setFrame(slotDoneFrameFor(slot.unit));
        slot.bg.setSize(slot.width, slot.height);
        slot.bg.setDisplaySize(slot.width, slot.height);
        slot.ghost?.setVisible(false);
      },
    });

    const phonemeKey = targetUnits(this.level)[slot.index]?.phoneme ?? '';
    void this.audio.playPhoneme(phonemeKey);
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
        slot.bg.setSize(slot.width, slot.height);
        slot.bg.setDisplaySize(slot.width, slot.height);
      },
    });
  }

  private bounceHome(tile: TileView): void {
    this.tweens.killTweensOf(tile.container);
    void this.audio.playSfx('sfx/bounce');
    this.tweens.add({
      targets: tile.container,
      x: tile.home.x,
      y: tile.home.y,
      scale: 1,
      duration: 340,
      ease: 'Back.Out',
      onComplete: () => {
        tile.container.setDepth(10);
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

  // ---------------------------------------------------------------- responsive repositioning

  private repositionBoard(stage: StageMetrics): void {
    if (!this.level || this.slots.length === 0) return;
    const isPortrait = stage.isPortrait;
    const cx = stage.centreX;
    const sceneLayout = computeSceneLayout(this.level, isPortrait, cx);
    const inset = isPortrait ? 80 : 92;

    this.layout.setAnchorY(this.backButton, sceneLayout.headerCenterY);
    this.layout.setAnchorY(this.soundButton, sceneLayout.headerCenterY);

    if (this.mutedLabel) {
      this.mutedLabel.x = anchorX(stage, { kind: 'right', inset });
    }

    if (this.tierLabel) {
      this.tierLabel.setPosition(cx, sceneLayout.headerCenterY - 14);
    }
    if (this.levelLabel) {
      this.levelLabel.setPosition(cx, sceneLayout.headerCenterY + 26);
    }

    if (this.haloGraphics) {
      this.paintHalo(cx, sceneLayout.artCenterY, sceneLayout.artHaloRadius);
    }
    if (this.artInitial) {
      this.artInitial.setPosition(cx, sceneLayout.artCenterY);
      this.artInitial.setFontSize(
        isPortrait ? '130px' : sceneLayout.isMultiRowLandscape ? '60px' : '88px',
      );
    }
    if (this.artImage) {
      this.artImage.setPosition(cx, sceneLayout.artCenterY);
      this.artImage.setDisplaySize(sceneLayout.artSize.width, sceneLayout.artSize.height);
    }

    if (this.mechanicText) {
      this.mechanicText.setPosition(cx, sceneLayout.mechanicY);
    }
    if (this.hintText) {
      this.hintText.setPosition(cx, sceneLayout.hintY);
    }

    // Reposition slots
    const slotPositions = sceneLayout.slotPositions;
    this.slots.forEach((slot, index) => {
      const pos = slotPositions[index];
      if (!pos) return;
      slot.x = pos.x;
      slot.y = pos.y;
      slot.bg.setPosition(slot.x, slot.y);
      slot.ghost?.setPosition(slot.x, slot.y - 4);
      if (slot.filledBy) {
        slot.filledBy.container.setPosition(slot.x, slot.y);
      }
    });

    // Reposition tray tiles
    const trayPositions = sceneLayout.trayPositions;
    this.tiles.forEach((tile, index) => {
      const pos = trayPositions[index];
      if (!pos) return;
      tile.home = pos;
      if (!tile.placedSlot && this.dragging !== tile) {
        tile.container.setPosition(tile.home.x, tile.home.y);
      }
    });
  }

  // ---------------------------------------------------------------- solved

  private onSolved(): void {
    if (this.solved) return;
    this.solved = true;

    void this.audio.playSfx('sfx/chime');
    this.audio.playWord(this.level.audio_word);

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
