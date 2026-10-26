import {
  DESIGN_HEIGHT,
  MIN_DESIGN_WIDTH,
  MIN_VIEWPORT_SCALE,
  viewportFit,
  type ViewportNotice,
} from '../game/theme';

/**
 * Viewport gate — makes the "Touch targets >= 64x64 CSS px" constraint true across
 * the WHOLE viewport domain instead of only in landscape.
 *
 * Under the full-bleed stage model (Scale.RESIZE + camera-mapped island, see the
 * STAGE MODEL note in `src/game/theme.ts`) the effective scale is
 *
 *     scale = min(vw / 1280, vh / 720)
 *
 * exactly as under the old Scale.FIT — but now the canvas fills the viewport at
 * every aspect instead of letterboxing. Because the scale is still that min, the
 * gate's arithmetic is unchanged in spirit and its boundary can be stated per
 * regime, which is what the notices now say:
 *
 *   - landscape wider than 16:9 (phones): the scale is vh / 720, so the floor is
 *     a HEIGHT floor — vh >= 360 CSS px.
 *   - landscape narrower than 16:9 (tablets, small windows): the scale is vw/1280,
 *     so the floor is a WIDTH floor — vw >= 640 CSS px.
 *   - portrait: the stage cannot honour it at any phone size (a portrait phone
 *     renders a tile at 36-41 CSS px), so the honest fix is to ask for a rotation
 *     rather than serve un-tappable controls.
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
    body: 'Make the window at least 360px tall (or 640px wide on a squarer screen) so the letter tiles stay big enough to tap.',
  },
};

export const NOTICE_ELEMENT_ID = 'viewport-notice';
export const CANVAS_HOST_ID = 'game';

/** Copy for a notice, or null when the stage is playable. */
export function noticeFor(width: number, height: number): NoticeCopy | null {
  const { notice } = viewportFit(width, height);
  return notice === 'none' ? null : NOTICE_COPY[notice];
}

/**
 * Applies the gate to the DOM: shows/hides the overlay and marks the host so the
 * canvas can be hidden behind it. Returns true when the player may play.
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
 * Design constants re-exported so the gate and the tests agree on one source.
 * `width` is the live stage FLOOR (see MIN_DESIGN_WIDTH), not a fixed canvas.
 */
export const GATE_DESIGN = {
  width: MIN_DESIGN_WIDTH,
  height: DESIGN_HEIGHT,
  minScale: MIN_VIEWPORT_SCALE,
} as const;
