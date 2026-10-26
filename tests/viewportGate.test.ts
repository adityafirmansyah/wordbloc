import { describe, expect, it } from 'vitest';
import { MIN_VIEWPORT_SCALE, viewportFit } from '../src/game/theme';
import {
  NOTICE_COPY,
  NOTICE_ELEMENT_ID,
  applyViewportNotice,
  gateCurrentViewport,
  noticeFor,
} from '../src/ui/viewportGate';

/**
 * Regression guard for review finding B3, re-pinned for the full-bleed stage.
 *
 * Old model: Scale.FIT over a fixed 1280x720 stage, s = min(vw/1280, vh/720),
 * letterboxed on any non-16:9 viewport. New model (Scale.RESIZE): the canvas is
 * the viewport and the camera maps the design island onto it, so the effective
 * scale is still `min(vw/1280, vh/720)` but nothing is letterboxed. Design sizes
 * are tuned so a tile is exactly 64 CSS px at scale 0.5. On a portrait phone the
 * scale falls to 0.28-0.32 and the same tile renders at 36-41 CSS px — no fixed
 * design size satisfies the spec floor there, so the app must not present the
 * stage: it asks the player to rotate or enlarge the window instead.
 */

const PORTRAIT = [
  [414, 896],
  [375, 667],
  [360, 640],
  [390, 844],
] as const;

const LANDSCAPE = [
  [640, 360],
  [844, 390],
  [1280, 720],
  [1920, 1080],
  [932, 430], // iPhone 14 Plus landscape — full-bleed phone stage
  [1180, 820], // iPad Air landscape — full-bleed narrow stage
  [768, 1024], // portrait tablet, but scale = 0.6 >= 0.5 -> playable
] as const;

describe('viewportFit', () => {
  it('is playable at every viewport that reaches the 0.5 scale floor', () => {
    for (const [w, h] of LANDSCAPE) {
      expect(viewportFit(w, h).notice, `${w}x${h}`).toBe('none');
    }
  });

  it('asks a portrait phone to rotate', () => {
    for (const [w, h] of PORTRAIT) {
      const fit = viewportFit(w, h);
      expect(fit.notice, `${w}x${h}`).toBe('rotate');
      expect(fit.scale).toBeLessThan(MIN_VIEWPORT_SCALE);
    }
  });

  it('asks a too-small landscape window to grow instead of rotating', () => {
    expect(viewportFit(400, 300).notice).toBe('too-small');
    expect(viewportFit(500, 320).notice).toBe('too-small');
  });

  it('treats exactly 640x360 as playable (boundary is inclusive)', () => {
    const fit = viewportFit(640, 360);
    expect(fit.scale).toBe(MIN_VIEWPORT_SCALE);
    expect(fit.notice).toBe('none');
  });

  it('reports the stage scale it used (vh-driven when wide, vw-driven when narrow)', () => {
    expect(viewportFit(1280, 720).scale).toBe(1);
    expect(viewportFit(640, 360).scale).toBe(0.5);
    // 2560x720: wider than 16:9, so the stage grows sideways and the scale is
    // driven by height alone — the full-bleed model keeps it at 1, not < 1.
    expect(viewportFit(2560, 720).scale).toBe(1);
    // 1180x820: narrower than 16:9, so the stage grows vertically and the scale
    // is driven by width alone.
    expect(viewportFit(1180, 820).scale).toBeCloseTo(1180 / 1280, 6);
  });

  it('degrades safely on a zero-size viewport instead of dividing by zero', () => {
    const fit = viewportFit(0, 0);
    expect(Number.isFinite(fit.scale)).toBe(true);
    // A zero-area viewport is never playable; which hint it shows is irrelevant.
    expect(fit.notice).not.toBe('none');
  });
});

describe('notice copy', () => {
  it('gives null when the stage is playable', () => {
    expect(noticeFor(1280, 720)).toBeNull();
  });

  it('returns readable, non-empty copy for each blocking state', () => {
    expect(noticeFor(375, 667)).toEqual(NOTICE_COPY.rotate);
    expect(noticeFor(400, 300)).toEqual(NOTICE_COPY['too-small']);
    for (const copy of Object.values(NOTICE_COPY)) {
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(20);
    }
  });
});

/** Minimal DOM double — jsdom is available but this keeps the test hermetic. */
function makeDoc(): Document {
  document.body.innerHTML = `
    <div id="game"></div>
    <div id="${NOTICE_ELEMENT_ID}" aria-hidden="true">
      <h1 data-notice-title></h1>
      <p data-notice-body></p>
    </div>
  `;
  document.documentElement.className = '';
  return document;
}

describe('applyViewportNotice (DOM wiring)', () => {
  it('hides the overlay and unblocks the canvas when playable', () => {
    const doc = makeDoc();
    const playable = applyViewportNotice(doc, 'none');
    expect(playable).toBe(true);
    const box = doc.getElementById(NOTICE_ELEMENT_ID);
    expect(box?.classList.contains('visible')).toBe(false);
    expect(box?.getAttribute('aria-hidden')).toBe('true');
    expect(doc.documentElement.classList.contains('viewport-blocked')).toBe(false);
  });

  it('shows the overlay with rotate copy and blocks the canvas', () => {
    const doc = makeDoc();
    const playable = applyViewportNotice(doc, 'rotate');
    expect(playable).toBe(false);
    const box = doc.getElementById(NOTICE_ELEMENT_ID);
    expect(box?.classList.contains('visible')).toBe(true);
    expect(box?.getAttribute('aria-hidden')).toBe('false');
    expect(box?.querySelector('[data-notice-title]')?.textContent).toBe(NOTICE_COPY.rotate.title);
    expect(box?.querySelector('[data-notice-body]')?.textContent).toBe(NOTICE_COPY.rotate.body);
    expect(doc.documentElement.classList.contains('viewport-blocked')).toBe(true);
  });

  it('switches copy between rotate and too-small', () => {
    const doc = makeDoc();
    applyViewportNotice(doc, 'rotate');
    applyViewportNotice(doc, 'too-small');
    const box = doc.getElementById(NOTICE_ELEMENT_ID);
    expect(box?.querySelector('[data-notice-title]')?.textContent).toBe(
      NOTICE_COPY['too-small'].title,
    );
  });

  it('does not throw when the overlay is absent from the DOM', () => {
    document.body.innerHTML = '<div id="game"></div>';
    expect(() => applyViewportNotice(document, 'rotate')).not.toThrow();
    expect(applyViewportNotice(document, 'rotate')).toBe(false);
  });
});

describe('gateCurrentViewport', () => {
  it('blocks a portrait phone and allows landscape', () => {
    makeDoc();
    expect(gateCurrentViewport({ innerWidth: 375, innerHeight: 667, document } as never)).toBe(
      false,
    );
    expect(gateCurrentViewport({ innerWidth: 1280, innerHeight: 720, document } as never)).toBe(
      true,
    );
  });
});
