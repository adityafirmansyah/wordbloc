import { DESIGN_HEIGHT, DESIGN_WIDTH, viewportFit, type ViewportNotice } from '../game/theme';

/**
 * Viewport gate — makes the "Touch targets >= 64x64 CSS px" constraint true across
 * the WHOLE viewport domain instead of only in landscape.
 *
 * Scale.FIT renders the fixed 1280x720 design space at `s = min(vw/1280, vh/720)`.
 * Design sizes are chosen so a tile is 64 CSS px at s = 0.5 (a 640x360 landscape
 * phone). On a portrait phone s is ~0.28-0.32, which renders the same tile at
 * 36-41 CSS px — no fixed design size can satisfy the floor there, so the honest
 * fix is to not present the playable stage at all: rotate, or enlarge the window.
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
    body: 'Make the window bigger (or use a larger screen) so the letter tiles stay big enough to tap.',
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

/** Design constants re-exported so the gate and the tests agree on one source. */
export const GATE_DESIGN = { width: DESIGN_WIDTH, height: DESIGN_HEIGHT } as const;
