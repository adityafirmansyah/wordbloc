import { describe, expect, it } from 'vitest';
import { MIN_VIEWPORT_SCALE, viewportFit } from '../src/game/theme';
import { fullscreenSupported, isFullscreen, toggleFullscreen } from '../src/ui/fullscreen';
import {
  FULLSCREEN_BUTTON_ID,
  NOTICE_COPY,
  NOTICE_ELEMENT_ID,
  applyViewportNotice,
  gateCurrentViewport,
  noticeFor,
  wireViewportGate,
} from '../src/ui/viewportGate';

/**
 * Regression guard for review finding B3 (touch targets) — and the OWNER DEFECT
 * this branch fixes: every real phone in landscape was blocked by the gate.
 *
 * Old model: Scale.FIT over a fixed 1280x720 stage, s = min(vw/1280, vh/720),
 * letterboxed on any non-16:9 viewport. New model (Scale.RESIZE): the canvas is the
 * viewport and the camera maps the design island onto it, so the effective scale is
 * still `min(vw/1280, vh/720)` but nothing is letterboxed.
 *
 * The gate's floor used to be 0.5, i.e. `innerHeight >= 360` CSS px. That is fine
 * for a desktop window and impossible for a phone: Chrome/Safari spend ~94 CSS px
 * on browser chrome, so a 393-CSS-px-tall phone exposes ~299 CSS px in landscape and
 * a 360-px phone ~265. The floor is now 0.36 (vh >= 260 CSS px), where a letter
 * tile is still 46 CSS px — above the 44 CSS px WCAG 2.5.5 floor.
 *
 * The real-phone viewports below are the ones the owner reported, measured with the
 * browser toolbar visible.
 */

/** Real phone landscape viewports WITH browser chrome subtracted. */
const MOBILE_LANDSCAPE = [
  [851, 299], // FHD+ Android (2340x1080 @ DPR 2.75) in Chrome, toolbar visible
  [800, 275], // budget Android (1600x720 @ DPR 2) in Chrome, toolbar visible
  [932, 320], // iPhone Pro Max landscape in Safari, toolbar visible
  [780, 265], // 360-CSS-px phone in landscape, toolbar visible — the worst real case
] as const;

const PORTRAIT = [
  [414, 896],
  [375, 667],
  [360, 640],
  [390, 844],
  [412, 892], // Pixel-class portrait phone
] as const;

const LANDSCAPE = [
  [640, 360],
  [844, 390],
  [1280, 720],
  [1920, 1080],
  [932, 430], // iPhone 14 Plus landscape — full-bleed phone stage
  [1180, 820], // iPad Air landscape — full-bleed narrow stage
  [768, 1024], // portrait tablet, but scale = 0.6 >= floor -> playable
  ...MOBILE_LANDSCAPE,
] as const;

describe('viewportFit', () => {
  it('is playable at every viewport that reaches the scale floor', () => {
    for (const [w, h] of LANDSCAPE) {
      expect(viewportFit(w, h).notice, `${w}x${h}`).toBe('none');
    }
  });

  it('accepts every REAL mobile phone in landscape with the toolbar visible', () => {
    // The owner defect: each of these used to be 'too-small' under the 0.5 floor.
    for (const [w, h] of MOBILE_LANDSCAPE) {
      const fit = viewportFit(w, h);
      expect(fit.notice, `${w}x${h}`).toBe('none');
      expect(fit.scale, `${w}x${h}`).toBeGreaterThanOrEqual(MIN_VIEWPORT_SCALE);
    }
    // ...and the old floor is what excluded them: prove the canary both ways.
    for (const [w, h] of MOBILE_LANDSCAPE) {
      expect(h / 720, `${w}x${h} under the old 0.5 floor`).toBeLessThan(0.5);
    }
  });

  it('the reported phone viewport (851x299) renders a legible stage, not merely a gate pass', () => {
    const fit = viewportFit(851, 299);
    expect(fit.notice).toBe('none');
    expect(fit.scale).toBeCloseTo(299 / 720, 6);
    // 46 CSS px letter tiles / 52 CSS px slots at that scale.
    expect(128 * fit.scale).toBeGreaterThanOrEqual(44);
    expect(144 * fit.scale).toBeGreaterThanOrEqual(44);
  });

  it('accepts portrait phones as playable without rotating', () => {
    for (const [w, h] of PORTRAIT) {
      const fit = viewportFit(w, h);
      expect(fit.notice, `${w}x${h}`).toBe('none');
      expect(fit.scale, `${w}x${h}`).toBeGreaterThanOrEqual(MIN_VIEWPORT_SCALE);
    }
  });

  it('asks a too-small landscape window to grow instead of rotating', () => {
    expect(viewportFit(400, 300).notice).toBe('too-small');
    expect(viewportFit(300, 200).notice).toBe('too-small');
    // 260 CSS px is the documented floor: one pixel below it is gated.
    expect(viewportFit(500, 259).notice).toBe('too-small');
    expect(viewportFit(500, 260).notice).toBe('none');
  });

  it('treats exactly the floor (259.2 CSS px) as playable (boundary is inclusive)', () => {
    const fit = viewportFit(932, MIN_VIEWPORT_SCALE * 720);
    expect(fit.scale).toBeCloseTo(MIN_VIEWPORT_SCALE, 9);
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
    expect(noticeFor(200, 200)).toEqual(NOTICE_COPY['too-small']);
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
      <button id="${FULLSCREEN_BUTTON_ID}" hidden>Go fullscreen</button>
    </div>
  `;
  document.documentElement.className = '';
  return document;
}

/** Pretend this document supports the Fullscreen API (jsdom does not implement it). */
function stubFullscreenSupport(supported: boolean): void {
  const el = document.documentElement as HTMLElement & {
    requestFullscreen?: () => Promise<void>;
  };
  if (supported) {
    el.requestFullscreen = (): Promise<void> => Promise.resolve();
  } else {
    delete el.requestFullscreen;
  }
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
  it('allows both portrait and landscape phones as playable', () => {
    makeDoc();
    expect(gateCurrentViewport({ innerWidth: 375, innerHeight: 667, document } as never)).toBe(
      true,
    );
    expect(gateCurrentViewport({ innerWidth: 1280, innerHeight: 720, document } as never)).toBe(
      true,
    );
  });

  it('blocks a genuinely too-small window in both dimensions', () => {
    makeDoc();
    expect(gateCurrentViewport({ innerWidth: 200, innerHeight: 200, document } as never)).toBe(
      false,
    );
  });

  it('allows the owner phone viewport (851x299) — the defect this branch fixes', () => {
    makeDoc();
    expect(gateCurrentViewport({ innerWidth: 851, innerHeight: 299, document } as never)).toBe(
      true,
    );
    // ...and it would have been blocked by the old 0.5 floor.
    expect(299 / 720).toBeLessThan(0.5);
  });
});

describe('fullscreen affordance (the one action a phone gate can offer)', () => {
  it('is hidden when leaving fullscreen would not help (portrait)', () => {
    stubFullscreenSupport(true);
    const doc = makeDoc();
    applyViewportNotice(doc, 'rotate');
    const button = doc.getElementById(FULLSCREEN_BUTTON_ID) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    expect(button?.hidden).toBe(true);
  });

  it('is offered on too-small where the Fullscreen API exists', () => {
    stubFullscreenSupport(true);
    const doc = makeDoc();
    applyViewportNotice(doc, 'too-small');
    const button = doc.getElementById(FULLSCREEN_BUTTON_ID) as HTMLButtonElement | null;
    expect(button?.hidden).toBe(false);
  });

  it('is hidden on too-small where the API is missing (iPhone Safari)', () => {
    stubFullscreenSupport(false);
    const doc = makeDoc();
    applyViewportNotice(doc, 'too-small');
    const button = doc.getElementById(FULLSCREEN_BUTTON_ID) as HTMLButtonElement | null;
    expect(button?.hidden).toBe(true);
  });

  it('is hidden again once the viewport becomes playable', () => {
    stubFullscreenSupport(true);
    const doc = makeDoc();
    applyViewportNotice(doc, 'too-small');
    applyViewportNotice(doc, 'none');
    const button = doc.getElementById(FULLSCREEN_BUTTON_ID) as HTMLButtonElement | null;
    expect(button?.hidden).toBe(true);
  });

  it('reports support from requestFullscreen / webkitRequestFullscreen only', () => {
    stubFullscreenSupport(false);
    expect(fullscreenSupported(document)).toBe(false);
    stubFullscreenSupport(true);
    expect(fullscreenSupported(document)).toBe(true);
    expect(isFullscreen(document)).toBe(false);
  });

  it('never rejects: a browser that refuses fullscreen resolves to false', async () => {
    const el = document.documentElement as HTMLElement & {
      requestFullscreen?: () => Promise<void>;
    };
    el.requestFullscreen = (): Promise<void> => Promise.reject(new Error('not allowed'));
    await expect(toggleFullscreen(document)).resolves.toBe(false);
    stubFullscreenSupport(false);
  });
});

describe('wireViewportGate (boot wiring)', () => {
  it('gates immediately, re-gates on resize and unbinds cleanly', () => {
    stubFullscreenSupport(true);
    makeDoc();

    const win = window as unknown as Window & { innerWidth: number; innerHeight: number };
    const originalWidth = win.innerWidth;
    const originalHeight = win.innerHeight;

    // jsdom's window starts at 1024x768 (playable), so boot into a tiny window.
    Object.defineProperty(win, 'innerWidth', { value: 200, configurable: true });
    Object.defineProperty(win, 'innerHeight', { value: 200, configurable: true });

    const wire = wireViewportGate(window);
    // Booted at a tiny window -> blocked, notice visible, aria-hidden false.
    const box = document.getElementById(NOTICE_ELEMENT_ID);
    expect(box?.classList.contains('visible')).toBe(true);
    expect(box?.getAttribute('aria-hidden')).toBe('false');

    // A desktop-sized resize re-gates to playable.
    Object.defineProperty(win, 'innerWidth', { value: 1280, configurable: true });
    Object.defineProperty(win, 'innerHeight', { value: 720, configurable: true });
    window.dispatchEvent(new Event('resize'));
    expect(box?.classList.contains('visible')).toBe(false);
    expect(document.documentElement.classList.contains('viewport-blocked')).toBe(false);

    // Dispose unbinds: a further resize must not touch the DOM.
    wire.dispose();
    Object.defineProperty(win, 'innerWidth', { value: 200, configurable: true });
    Object.defineProperty(win, 'innerHeight', { value: 200, configurable: true });
    window.dispatchEvent(new Event('resize'));
    expect(box?.classList.contains('visible')).toBe(false);

    Object.defineProperty(win, 'innerWidth', { value: originalWidth, configurable: true });
    Object.defineProperty(win, 'innerHeight', { value: originalHeight, configurable: true });
  });
});
