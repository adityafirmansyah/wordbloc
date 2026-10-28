/**
 * Fullscreen helper — the one action that can grow a phone viewport without the
 * player buying a bigger phone.
 *
 * WHY THIS EXISTS
 * ---------------
 * The viewport gate blocks below scale 0.36 (`vh < 260` CSS px). On a phone that
 * is almost entirely browser chrome: Chrome on Android spends ~94 CSS px on the
 * status bar + URL omnibox + gesture bar, so a 393-px-tall phone exposes ~299 CSS
 * px in landscape. Entering fullscreen removes that chrome, the viewport grows back
 * to ~393 CSS px and a window that was just under the floor becomes playable.
 *
 * So the "Window too small" notice is not a dead end: where the Fullscreen API
 * exists it offers a button that performs exactly the enlargement it asks for.
 *
 * Everything here is DOM-only and feature-detected — an unsupported browser (iOS
 * Safari on iPhone refuses element fullscreen) gets no button and the notice stays
 * as it was, so this can never be the reason a player is stuck.
 */

/** Element-level fullscreen with the vendor prefixes Safari/older Chrome used. */
interface LegacyFullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
}

interface LegacyFullscreenDocument extends Document {
  webkitFullscreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  msExitFullscreen?: () => Promise<void> | void;
}

/** True when this document can put an element into fullscreen. */
export function fullscreenSupported(doc: Document): boolean {
  const el = doc.documentElement as LegacyFullscreenElement | null;
  if (!el) return false;
  return (
    typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function'
  );
}

/** True while an element is displayed fullscreen (any vendor prefix). */
export function isFullscreen(doc: Document): boolean {
  const legacy = doc as LegacyFullscreenDocument;
  return Boolean(
    legacy.fullscreenElement ?? legacy.webkitFullscreenElement ?? legacy.msFullscreenElement,
  );
}

/**
 * Puts `el` into fullscreen. Resolves to true when it worked.
 *
 * Browsers reject `requestFullscreen()` outside a user gesture and on a document
 * that is not allowed to (an iframe without `allowfullscreen`, kiosk policy), so the
 * rejection is caught and reported as `false` rather than surfacing as an unhandled
 * promise rejection — a failed fullscreen must leave the game exactly as playable as
 * it already was.
 */
export async function requestFullscreen(el: LegacyFullscreenElement): Promise<boolean> {
  try {
    if (typeof el.requestFullscreen === 'function') {
      await el.requestFullscreen();
      return true;
    }
    if (typeof el.webkitRequestFullscreen === 'function') {
      await el.webkitRequestFullscreen();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Leaves fullscreen. Resolves to true when it worked; never throws. */
export async function exitFullscreen(doc: Document): Promise<boolean> {
  const legacy = doc as LegacyFullscreenDocument;
  try {
    if (typeof legacy.exitFullscreen === 'function') {
      await legacy.exitFullscreen();
      return true;
    }
    if (typeof legacy.webkitExitFullscreen === 'function') {
      await legacy.webkitExitFullscreen();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Enters fullscreen on the whole page, or leaves it if already there. */
export async function toggleFullscreen(doc: Document): Promise<boolean> {
  if (isFullscreen(doc)) return exitFullscreen(doc);
  const el = doc.documentElement as LegacyFullscreenElement | null;
  if (!el) return false;
  return requestFullscreen(el);
}
