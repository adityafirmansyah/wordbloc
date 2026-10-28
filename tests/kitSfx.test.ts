import { describe, expect, it, vi } from 'vitest';

/**
 * Button juiciness suite (`src/ui/kit.ts`).
 *
 * Every menu/game/reward/wordbook button takes an optional `sfx` callback and fires
 * it on POINTER_UP. Three things matter, and each one is a defect if it regresses:
 *
 *   1. the cue fires ONCE per press (a button that clicks twice sounds broken);
 *   2. it fires BEFORE `onClick`, because onClick usually starts a scene whose
 *      shutdown releases the audio pool — after the action, the click would be
 *      cut off on every navigating press;
 *   3. a button built without `sfx` stays silent, so no call site is forced to opt
 *      in (and an icon button with no audio manager cannot throw).
 *
 * Phaser is mocked: its module init touches a real canvas, which jsdom lacks. The
 * doubles below mirror only the surface `kit.ts` uses (image/text/container with
 * chainable setters and an event emitter).
 */

vi.mock('phaser', () => {
  class Rectangle {
    constructor(
      public x: number,
      public y: number,
      public width: number,
      public height: number,
    ) {}
    static Contains = (rect: Rectangle, x: number, y: number): boolean =>
      rect.x <= x && rect.x + rect.width >= x && rect.y <= y && rect.y + rect.height >= y;
  }
  return {
    default: {
      Geom: { Rectangle },
      Input: {
        Events: {
          POINTER_DOWN: 'pointerdown',
          POINTER_OUT: 'pointerout',
          POINTER_UP: 'pointerup',
        },
      },
    },
  };
});

interface FakeHandlers {
  [event: string]: Array<() => void>;
}

/** Container double: records listeners so a test can fire a press. */
function makeContainer(x: number, y: number, children: unknown[]) {
  const handlers: FakeHandlers = {};
  const container = {
    x,
    y,
    list: children,
    width: 0,
    height: 0,
    active: true,
    setSize(width: number, height: number) {
      container.width = width;
      container.height = height;
      return container;
    },
    setInteractive() {
      return container;
    },
    setDepth() {
      return container;
    },
    setY(next: number) {
      container.y = next;
      return container;
    },
    getAt(index: number) {
      return children[index];
    },
    on(event: string, fn: () => void) {
      (handlers[event] ??= []).push(fn);
      return container;
    },
    emit(event: string) {
      for (const fn of handlers[event] ?? []) fn();
    },
    handles(event: string) {
      return (handlers[event] ?? []).length;
    },
  };
  return container;
}

function makeImage() {
  const image = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    frame: { name: '' },
    setDisplaySize(width: number, height: number) {
      image.width = width;
      image.height = height;
      return image;
    },
    setScale() {
      return image;
    },
    setFrame(name: string) {
      image.frame.name = name;
      return image;
    },
  };
  return image;
}

function makeText(text: string) {
  return {
    text,
    x: 0,
    y: 0,
    setOrigin() {
      return this;
    },
    setDepth() {
      return this;
    },
    setShadow() {
      return this;
    },
    setVisible() {
      return this;
    },
  };
}

/** Minimal scene double: `add.*` returns the same kind of double kit.ts expects. */
function makeScene() {
  const containers: Array<ReturnType<typeof makeContainer>> = [];
  const scene = {
    add: {
      image: () => makeImage(),
      text: (_x: number, _y: number, text: string) => makeText(text),
      container: (x: number, y: number, children: unknown[]) => {
        const c = makeContainer(x, y, children);
        containers.push(c);
        return c;
      },
    },
  };
  return { scene, containers };
}

const { makeButton, makeIconButton } = await import('../src/ui/kit');
type Scene = Parameters<typeof makeButton>[0];

describe('makeButton — click SFX', () => {
  it('plays exactly one click per press', () => {
    const { scene, containers } = makeScene();
    const sfx = vi.fn();
    makeButton(scene as unknown as Scene, {
      x: 0,
      y: 0,
      label: 'Play',
      onClick: () => undefined,
      sfx,
    });

    const [button] = containers;
    button?.emit('pointerup');
    expect(sfx).toHaveBeenCalledTimes(1);
    expect(sfx).toHaveBeenCalledWith('sfx/click');
  });

  it('fires the click BEFORE the action (so a navigating press is not cut off)', () => {
    const { scene, containers } = makeScene();
    const order: string[] = [];
    makeButton(scene as unknown as Scene, {
      x: 0,
      y: 0,
      label: 'Next',
      onClick: () => order.push('onClick'),
      sfx: () => order.push('sfx'),
    });

    containers[0]?.emit('pointerup');
    // The action usually starts a scene; its shutdown releases the audio pool, so a
    // click started after it would be truncated. Order is the assertion.
    expect(order).toEqual(['sfx', 'onClick']);
  });

  it('does not fire on pointerdown or pointerout, only on release', () => {
    const { scene, containers } = makeScene();
    const sfx = vi.fn();
    makeButton(scene as unknown as Scene, {
      x: 0,
      y: 0,
      label: 'Play',
      onClick: () => undefined,
      sfx,
    });

    containers[0]?.emit('pointerdown');
    containers[0]?.emit('pointerout');
    expect(sfx).not.toHaveBeenCalled();
    containers[0]?.emit('pointerup');
    expect(sfx).toHaveBeenCalledTimes(1);
  });

  it('stays silent when no sfx callback is given (call sites opt in)', () => {
    const { scene, containers } = makeScene();
    const onClick = vi.fn();
    expect(() =>
      makeButton(scene as unknown as Scene, { x: 0, y: 0, label: 'Back', onClick }),
    ).not.toThrow();
    containers[0]?.emit('pointerup');
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('makeIconButton — click SFX', () => {
  it('plays one click per press and still runs the action', () => {
    const { scene, containers } = makeScene();
    const sfx = vi.fn();
    const onClick = vi.fn();
    makeIconButton(scene as unknown as Scene, {
      x: 0,
      y: 0,
      frame: 'home',
      onClick,
      sfx,
    });

    containers[0]?.emit('pointerup');
    expect(sfx).toHaveBeenCalledTimes(1);
    expect(sfx).toHaveBeenCalledWith('sfx/click');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('click precedes the action here too', () => {
    const { scene, containers } = makeScene();
    const order: string[] = [];
    makeIconButton(scene as unknown as Scene, {
      x: 0,
      y: 0,
      frame: 'home',
      onClick: () => order.push('onClick'),
      sfx: () => order.push('sfx'),
    });

    containers[0]?.emit('pointerup');
    expect(order).toEqual(['sfx', 'onClick']);
  });

  it('is silent without an sfx callback', () => {
    const { scene, containers } = makeScene();
    const onClick = vi.fn();
    expect(() =>
      makeIconButton(scene as unknown as Scene, { x: 0, y: 0, frame: 'home', onClick }),
    ).not.toThrow();
    containers[0]?.emit('pointerup');
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
