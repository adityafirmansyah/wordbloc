import Phaser from 'phaser';
import {
  ATLAS_KEY,
  COLORS,
  FRAMES,
  ISLAND_CENTRE_X,
  ISLAND_CENTRE_Y,
  anchorX,
  stageMetrics,
  type StageAnchor,
  type StageMetrics,
} from '../game/theme';
import { createCoalescer, type Coalescer } from './frameCoalesce';

/**
 * Stage binding — the bridge between the live viewport and the 1280x720 design
 * space (see the STAGE MODEL note at the top of `src/game/theme.ts`).
 *
 * Phaser runs in `Scale.RESIZE`, so the canvas is always exactly the size of the
 * viewport (no letterbox, ever). Everything else is done by the main camera:
 * zooming it by `stage.scale` and centring it on the content island makes the
 * visible world exactly `stage.width x stage.height`, with the island in the
 * middle and sky filling the remaining margins.
 *
 * Two things therefore need to react to a resize:
 *   1. the camera (zoom + centre) and the full-bleed backdrop, and
 *   2. any object anchored to a stage EDGE (header buttons, pager arrows,
 *      floating decorations, confetti bounds) — centred content needs nothing,
 *      because the camera keeps the island under the viewport centre.
 *
 * `StageLayout` owns both: scenes `attach()` edge-anchored objects once and the
 * layout re-positions them on every resize. Resize work is coalesced to one pass
 * per animation frame (`src/ui/frameCoalesce.ts`, pinned by
 * `tests/frameCoalesce.test.ts`) and only ever moves/resizes existing game
 * objects — the UI atlas built in BootScene is never rebuilt by a resize.
 */

interface AnchorEntry {
  target: { x: number; y: number; active?: boolean; scene?: unknown };
  anchor: StageAnchor;
  y: number;
}

/** Full-bleed background: vertical gradient stretched over the whole stage. */
export class StageBackdrop {
  private readonly strip: Phaser.GameObjects.Image;
  private readonly decor: Phaser.GameObjects.Graphics | null;

  constructor(scene: Phaser.Scene, hills: boolean) {
    this.strip = scene.add.image(ISLAND_CENTRE_X, ISLAND_CENTRE_Y, ATLAS_KEY, FRAMES.bgStrip);
    this.strip.setDepth(-100);
    this.decor = hills ? scene.add.graphics().setDepth(-90) : null;
  }

  /** Stretch the gradient over the live stage and repaint the decoration. */
  layout(stage: StageMetrics): void {
    this.strip.setPosition(stage.centreX, stage.centreY);
    this.strip.setDisplaySize(stage.width, stage.height);

    const decor = this.decor;
    if (!decor) return;

    // Decorations are placed as fractions of the live stage, so a wide phone gets
    // hills/clouds across the whole screen instead of only the island middle.
    const { left, right, top, bottom, width } = stage;
    decor.clear();
    decor.fillStyle(COLORS.hill, 0.55);
    decor.fillEllipse(left + width * 0.22, bottom + 60, 760, 340);
    decor.fillEllipse(left + width * 0.78, bottom + 90, 900, 380);
    decor.fillStyle(0xffffff, 0.5);
    decor.fillEllipse(left + width * 0.14, top + 150, 260, 96);
    decor.fillEllipse(left + width * 0.26, top + 126, 200, 76);
    decor.fillEllipse(left + width * 0.8, top + 180, 300, 104);
    decor.fillEllipse(right - width * 0.08, top + 140, 220, 80);
  }

  destroy(): void {
    this.strip.destroy();
    this.decor?.destroy();
  }
}

/**
 * Per-scene stage binding. Create it FIRST in `create()`, then ask it for
 * `metrics` (live stage geometry) and `attach()` anything that hugs an edge.
 */
export class StageLayout {
  private readonly scene: Phaser.Scene;
  private readonly backdrop: StageBackdrop | null;
  private readonly anchored: AnchorEntry[] = [];
  private readonly listeners: ((stage: StageMetrics) => void)[] = [];
  private stage: StageMetrics;
  /** Collapses a resize burst into one layout pass (see onResize). */
  private readonly coalescer: Coalescer;
  private disposed = false;

  constructor(scene: Phaser.Scene, opts: { backdrop?: boolean; hills?: boolean } = {}) {
    this.scene = scene;
    this.stage = readStage(scene);
    this.backdrop = opts.backdrop === false ? null : new StageBackdrop(scene, opts.hills ?? false);
    this.coalescer = createCoalescer(() => {
      this.stage = readStage(this.scene);
      this.refresh();
    });

    this.applyCamera();
    this.backdrop?.layout(this.stage);

    scene.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.dispose, this);
    scene.events.once(Phaser.Scenes.Events.DESTROY, this.dispose, this);
  }

  /** Live stage geometry (world px + scale). */
  get metrics(): StageMetrics {
    return this.stage;
  }

  /** Keep `target` at `anchor` horizontally, at its current y. */
  attach<T extends { x: number; y: number; active?: boolean }>(
    target: T,
    anchor: StageAnchor = { kind: 'centre' },
  ): T {
    this.anchored.push({ target, anchor, y: target.y });
    target.x = anchorX(this.stage, anchor);
    return target;
  }

  /** Run `cb` on every stage change (after the built-in re-anchoring). */
  onStageChange(cb: (stage: StageMetrics) => void): void {
    this.listeners.push(cb);
  }

  /** Re-apply the current stage to the camera, backdrop and anchored objects. */
  refresh(): void {
    if (this.disposed) return;
    this.applyCamera();
    this.backdrop?.layout(this.stage);

    for (let i = this.anchored.length - 1; i >= 0; i -= 1) {
      const entry = this.anchored[i];
      if (!entry) continue;
      const target = entry.target as { active?: boolean; destroy?: unknown };
      if (target.active === false || typeof target.destroy !== 'function') {
        this.anchored.splice(i, 1);
        continue;
      }
      entry.target.x = anchorX(this.stage, entry.anchor);
      entry.target.y = entry.y;
    }

    for (const cb of this.listeners) cb(this.stage);
  }

  private applyCamera(): void {
    const cam = this.scene.cameras.main;
    // A zero-area viewport cannot be zoomed; 1 keeps the camera usable meanwhile.
    cam.setZoom(this.stage.scale > 0 ? this.stage.scale : 1);
    cam.centerOn(ISLAND_CENTRE_X, ISLAND_CENTRE_Y);
  }

  /**
   * Phaser emits RESIZE once per DOM resize event (dozens per drag on desktop, a
   * burst per orientation change). `createCoalescer` collapses a burst into ONE
   * layout pass on the next animation frame: all work is `setPosition` /
   * `setDisplaySize` / camera zoom on objects that already exist, so no texture
   * is ever re-created by a resize.
   */
  private onResize(): void {
    this.stage = readStage(this.scene);
    this.coalescer.schedule();
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.anchored.length = 0;
    this.listeners.length = 0;
    this.backdrop?.destroy();
  }
}

/** Stage geometry for a scene's current viewport. */
export function readStage(scene: Phaser.Scene): StageMetrics {
  const { width, height } = scene.scale.gameSize;
  return stageMetrics(width, height);
}
