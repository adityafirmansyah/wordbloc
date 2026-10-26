import Phaser from 'phaser';
import { ATLAS_KEY, BANDS, BUTTON_SIZE, FONT_FAMILY, FRAMES } from '../game/theme';
import type { StageLayout } from './stage';

export interface ButtonOptions {
  x: number;
  y: number;
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'alt';
  width?: number;
  height?: number;
  fontSize?: number;
}

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
}

/** Square icon button (>=128x128 design px => 64x64 CSS at scale 0.5). */
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
  },
): Phaser.GameObjects.Container {
  const button = makeIconButton(scene, {
    x: 0,
    y: opts.y,
    frame: opts.frame,
    onClick: opts.onClick,
    size: opts.size,
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
