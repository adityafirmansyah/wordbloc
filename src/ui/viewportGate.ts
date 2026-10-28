import {
  DESIGN_HEIGHT,
  MIN_DESIGN_WIDTH,
  MIN_VIEWPORT_SCALE,
  viewportFit,
  type ViewportNotice,
} from '../game/theme';
import { fullscreenSupported, toggleFullscreen } from './fullscreen';

/**
 * Viewport gate — makes the touch-target floor true across the WHOLE viewport
 * domain instead of only on a roomy window.
 *
 * Under the full-bleed stage model (Scale.RESIZE + camera-mapped island, see the
 * STAGE MODEL note in `src/game/theme.ts`) the effective scale is
 *
 *     scale = min(vw / 1280, vh / 720)
 *
 * exactly as under the old Scale.FIT — but now the canvas fills the viewport at
 * every aspect instead of letterboxing. Because the scale is still that min, the
 * gate's arithmetic is unchanged in spirit and its boundary can be stated per
 * regime, which is what the notice now says:
 *
 *   - landscape wider than 16:9 (phones): the scale is vh / 720, so the floor is
 *     a HEIGHT floor — vh >= 260 CSS px (scale 0.36).
 *   - landscape narrower than 16:9 (tablets, small windows): the scale is vw/1280,
 *     so the floor is a WIDTH floor — vw >= 461 CSS px.
 *   - portrait: the stage cannot honour it at any phone size (a portrait phone
 *     renders a tile at 36-41 CSS px), so the honest fix is to ask for a rotation
 *     rather than serve un-tappable controls.
 *
 * The 260 floor is not arbitrary: a 393-CSS-px-tall phone in landscape exposes
 * ~299 CSS px of height once Chrome/Safari has taken its ~94 CSS px of chrome, and
 * the old 360 floor gated every one of those real phones (owner defect). At scale
 * 0.36 a letter tile is 46 CSS px — above the 44 CSS px WCAG 2.5.5 floor — so the
 * game is genuinely playable rather than merely un-gated.
 *
 * This module is DOM-only and Phaser-free so it is unit-testable in jsdom.
 */

export interface NoticeCopy {
  title: string;
  body: string;
}

export const NOTICE_COPY: Readonly<Record<Exclude<ViewportNotice, 'none'>, NoticeCopy>> = {
  rotate: {
    title: 'Turn your device sideways',
    body: 'WordBloc plays best in landscape. Rotate the tablet or phone, then carry on.',
  },
  'too-small': {
    title: 'Window too small',
    body: 'Make the window at least 260px tall so the letter tiles stay big enough to tap.',
  },
};

export const NOTICE_ELEMENT_ID = 'viewport-notice';
export const CANVAS_HOST_ID = 'game';
/** The "Go fullscreen" affordance inside the notice (hidden where unsupported). */
export const FULLSCREEN_BUTTON_ID = 'viewport-notice-fullscreen';

/** Copy for a notice, or null when the stage is playable. */
export function noticeFor(width: number, height: number): NoticeCopy | null {
  const { notice } = viewportFit(width, height);
  return notice === 'none' ? null : NOTICE_COPY[notice];
}

/**
 * Applies the gate to the DOM: shows/hides the overlay and marks the host so the
 * canvas can be hidden behind it. Returns true when the player may play.
 *
 * The fullscreen button is offered whenever the viewport is blocked AND the
 * document can actually go fullscreen: on a phone the bar it hides is ~94 CSS px,
 * which is usually the difference between 'too-small' and playable. Where the API
 * is missing (iPhone Safari) the button stays hidden rather than promising
 * something the browser will not do.
 */
export function applyViewportNotice(doc: Document, notice: ViewportNotice): boolean {
  const box = doc.getElementById(NOTICE_ELEMENT_ID);
  const playable = notice === 'none';

  if (box) {
    box.classList.toggle('visible', !playable);
    box.setAttribute('aria-hidden', playable ? 'true' : 'false');
    if (!playable) {
      const copy = NOTICE_COPY[notice];
      const title = box.querySelector('[data-notice-title]');
      const body = box.querySelector('[data-notice-body]');
      if (title) title.textContent = copy.title;
      if (body) body.textContent = copy.body;
    }
    const fsButton = box.querySelector<HTMLElement>(`#${FULLSCREEN_BUTTON_ID}`);
    if (fsButton) {
      // Only for 'too-small': fullscreen removes browser chrome and therefore GROWS
      // the height, which is exactly that notice's complaint. On a portrait phone it
      // would not help at all — the scale there is driven by WIDTH (393/1280), so
      // fullscreen leaves it just as gated and the rotate hint stays the only advice.
      const show = notice === 'too-small' && fullscreenSupported(doc);
      fsButton.hidden = !show;
    }
  }

  doc.documentElement.classList.toggle('viewport-blocked', !playable);
  return playable;
}

/** Convenience wrapper: measure the window and apply the gate. */
export function gateCurrentViewport(
  win: Pick<Window, 'innerWidth' | 'innerHeight' | 'document'>,
): boolean {
  const notice = viewportFit(win.innerWidth, win.innerHeight).notice;
  return applyViewportNotice(win.document, notice);
}

/**
 * Wires the gate: gates once immediately, then re-gates on resize,
 * orientationchange and fullscreenchange, and owns the notice's fullscreen button.
 *
 * Re-gating on `fullscreenchange` is the load-bearing part: leaving fullscreen puts
 * the URL bar back, so a viewport that only passed BECAUSE of fullscreen must be
 * re-checked (and will show the notice again) instead of silently rendering tiles
 * below the floor. Entering fullscreen also fires `resize`, so the two together make
 * the state change deterministic.
 *
 * Returns a disposer mainly so a test can unbind without leaking listeners.
 */
export function wireViewportGate(
  win: Window,
  doc: Document = win.document,
): { button: HTMLElement | null; dispose: () => void } {
  const button = doc.querySelector<HTMLElement>(`#${FULLSCREEN_BUTTON_ID}`);
  const sync = (): void => {
    gateCurrentViewport(win);
  };

  const onClick = (): void => {
    void toggleFullscreen(doc).then(() => {
      // The viewport size may not have settled when the promise resolves; `resize`
      // and `fullscreenchange` do the real re-gate.
      sync();
    });
  };

  if (button) {
    button.addEventListener('click', onClick);
    button.hidden = !fullscreenSupported(doc);
  }

  doc.addEventListener('fullscreenchange', sync);
  doc.addEventListener('webkitfullscreenchange', sync);
  win.addEventListener('resize', sync);
  win.addEventListener('orientationchange', sync);

  // Gate the current viewport right away — a phone that opens the app already below
  // the floor must see the notice without waiting for a resize.
  sync();

  return {
    button,
    dispose: () => {
      button?.removeEventListener('click', onClick);
      doc.removeEventListener('fullscreenchange', sync);
      doc.removeEventListener('webkitfullscreenchange', sync);
      win.removeEventListener('resize', sync);
      win.removeEventListener('orientationchange', sync);
    },
  };
}

/**
 * Design constants re-exported so the gate and the tests agree on one source.
 * `width` is the live stage FLOOR (see MIN_DESIGN_WIDTH), not a fixed canvas.
 */
export const GATE_DESIGN = {
  width: MIN_DESIGN_WIDTH,
  height: DESIGN_HEIGHT,
  minScale: MIN_VIEWPORT_SCALE,
} as const;
