import Phaser from 'phaser';
import { ATLAS_KEY, BANDS, BUTTON_SIZE, FONT_FAMILY, FRAMES } from '../game/theme';
import type { SfxKey } from '../game/audio';
import type { StageLayout } from './stage';

/**
 * Callback a scene hands to its buttons so a press makes a soft bubble click.
 *
 * Passed in explicitly (rather than read from a module singleton) so a button can
 * only ever click through the audio manager of the scene that built it — a
 * released manager leaves the last scene's buttons silent instead of throwing.
 * Buttons built without it stay silent, as they were before SFX existed.
 */
export type SfxPlayer = (key: SfxKey) => void;

export interface ButtonOptions {
  x: number;
  y: number;
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'alt';
  width?: number;
  height?: number;
  fontSize?: number;
  /** Optional game-juice click; omitted by buttons that should stay silent. */
  sfx?: SfxPlayer;
}

/** The clip a button press plays. One place, so the whole kit sounds the same. */
const PRESS_SFX: SfxKey = 'sfx/click';

/** Chunky tappable button backed by atlas frames. >=128x128 design px by default. */
export function makeButton(scene: Phaser.Scene, opts: ButtonOptions): Phaser.GameObjects.Container {
  const width = opts.width ?? BUTTON_SIZE.width;
  const height = opts.height ?? BUTTON_SIZE.height;
  const upFrame = opts.variant === 'alt' ? FRAMES.btnAlt : FRAMES.btn;
  const downFrame = opts.variant === 'alt' ? FRAMES.btnAltDown : FRAMES.btnDown;

  const bg = scene.add.image(0, 0, ATLAS_KEY, upFrame).setDisplaySize(width, height);
  const label = scene.add
    .text(0, -2, opts.label, {
      fontFamily: FONT_FAMILY,
      fontSize: `${opts.fontSize ?? 44}px`,
      color: '#ffffff',
      fontStyle: 'bold',
    })
    .setOrigin(0.5);

  const container = scene.add.container(opts.x, opts.y, [bg, label]);
  container.setSize(width, height);

  // Phaser's hit test normalizes the local point by adding displayOriginX/Y
  // (half the object's size) before calling Contains, so the rectangle must
  // start at 0,0 — NOT at -w/2. Using -w/2 shifts the whole hit area left by
  // half the width, which silently made clicking/tapping grab the wrong object.
  container.setInteractive(
    new Phaser.Geom.Rectangle(0, 0, width, height),
    Phaser.Geom.Rectangle.Contains,
  );

  const press = (): void => {
    bg.setFrame(downFrame);
    bg.setDisplaySize(width, height - 6);
    container.setY(opts.y + 6);
  };
  const release = (): void => {
    bg.setFrame(upFrame);
    bg.setDisplaySize(width, height);
    container.setY(opts.y);
  };

  container.on(Phaser.Input.Events.POINTER_DOWN, press);
  container.on(Phaser.Input.Events.POINTER_OUT, release);
  container.on(Phaser.Input.Events.POINTER_UP, () => {
    release();
    // Click before the action: the action usually starts a scene, whose shutdown
    // releases the audio pool — a click started after it would be cut off.
    opts.sfx?.(PRESS_SFX);
    opts.onClick();
  });

  return container;
}

export interface IconButtonOptions {
  x: number;
  y: number;
  frame: string;
  onClick: () => void;
  size?: number;
  label?: string;
  /** Optional game-juice click; omitted by icon buttons that should stay silent. */
  sfx?: SfxPlayer;
}

/** Square icon button (>=128x128 design px => 64x64 CSS at scale 0.5, 46 at 0.36). */
export function makeIconButton(
  scene: Phaser.Scene,
  opts: IconButtonOptions,
): Phaser.GameObjects.Container {
  const size = opts.size ?? BANDS.headerButton;
  const bg = scene.add.image(0, 0, ATLAS_KEY, FRAMES.btnSq).setDisplaySize(size, size);
  const iconScale = (size * 0.62) / 96;
  const icon = scene.add.image(0, 0, ATLAS_KEY, opts.frame).setScale(iconScale);

  const container = scene.add.container(opts.x, opts.y, [bg, icon]);
  container.setSize(size, size);
  // Rectangle must start at 0,0: Phaser adds displayOrigin before the Contains
  // test (see makeButton in this file for the full explanation).
  container.setInteractive(
    new Phaser.Geom.Rectangle(0, 0, size, size),
    Phaser.Geom.Rectangle.Contains,
  );

  container.on(Phaser.Input.Events.POINTER_DOWN, () => {
    bg.setFrame(FRAMES.btnSqDown);
    bg.setDisplaySize(size, size - 4);
    container.setY(opts.y + 4);
  });
  container.on(Phaser.Input.Events.POINTER_OUT, () => {
    bg.setFrame(FRAMES.btnSq);
    bg.setDisplaySize(size, size);
    container.setY(opts.y);
  });
  container.on(Phaser.Input.Events.POINTER_UP, () => {
    bg.setFrame(FRAMES.btnSq);
    bg.setDisplaySize(size, size);
    container.setY(opts.y);
    // Click before the action: the action usually starts a scene.
    opts.sfx?.(PRESS_SFX);
    opts.onClick();
  });

  return container;
}

export function makeText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  size: number,
  color = '#21324a',
  bold = false,
): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, text, {
      fontFamily: FONT_FAMILY,
      fontSize: `${size}px`,
      color,
      fontStyle: bold ? 'bold' : 'normal',
      align: 'center',
    })
    .setOrigin(0.5);
}

/**
 * Header icon button pinned to a live stage edge (left/right), so it stays inside
 * the frame on a wide phone stage instead of drifting off it.
 */
export function makeEdgeIconButton(
  scene: Phaser.Scene,
  layout: StageLayout,
  opts: {
    edge: 'left' | 'right';
    inset: number;
    y: number;
    frame: string;
    onClick: () => void;
    size?: number;
    sfx?: SfxPlayer;
  },
): Phaser.GameObjects.Container {
  const button = makeIconButton(scene, {
    x: 0,
    y: opts.y,
    frame: opts.frame,
    onClick: opts.onClick,
    size: opts.size,
    sfx: opts.sfx,
  });
  return layout.attach(button, { kind: opts.edge, inset: opts.inset });
}

export function makePanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
): Phaser.GameObjects.Image {
  return scene.add.image(x, y, ATLAS_KEY, FRAMES.panel).setDisplaySize(width, height);
}
