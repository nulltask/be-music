/**
 * Fullscreen helpers for the demo shell. Wraps the unprefixed Fullscreen API plus Safari's
 * `webkit*` aliases so a double-click on the Pixi canvas can toggle the page into (and out
 * of) fullscreen without the rest of the demo having to know about vendor prefixes.
 */

export type FullscreenDocumentLike = {
  fullscreenElement?: Element | null;
  webkitFullscreenElement?: Element | null;
  exitFullscreen?: () => Promise<void>;
  webkitExitFullscreen?: () => Promise<void>;
};

export type FullscreenElementLike = {
  requestFullscreen?: () => Promise<void>;
  webkitRequestFullscreen?: () => Promise<void>;
};

export function getFullscreenElement(doc: FullscreenDocumentLike = document): Element | null {
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export async function requestFullscreen(element: FullscreenElementLike): Promise<void> {
  const request = element.requestFullscreen ?? element.webkitRequestFullscreen;
  if (request === undefined) return;
  await request.call(element);
}

export async function exitFullscreen(doc: FullscreenDocumentLike = document): Promise<void> {
  const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
  if (exit === undefined) return;
  await exit.call(doc);
}

/**
 * Enter fullscreen on `element` when the document is windowed; leave fullscreen when it
 * already is. Failures (unsupported element, missing user gesture) are swallowed so a
 * double-click on an iOS Safari page that rejects element fullscreen stays a no-op.
 */
export async function toggleFullscreen(
  element: FullscreenElementLike,
  doc: FullscreenDocumentLike = document,
): Promise<void> {
  try {
    if (getFullscreenElement(doc) !== null) {
      await exitFullscreen(doc);
    } else {
      await requestFullscreen(element);
    }
  } catch {
    // NotAllowedError / TypeError — the click is a no-op.
  }
}

/**
 * True when the demo should consume Escape so the active scene (quit play / dismiss
 * result / close a select folder) does not also fire while leaving fullscreen.
 */
export function shouldCaptureFullscreenEscape(
  event: Pick<KeyboardEvent, 'key' | 'code'>,
  doc: FullscreenDocumentLike = document,
): boolean {
  return (event.key === 'Escape' || event.code === 'Escape') && getFullscreenElement(doc) !== null;
}

type OrientationLike = { orientation?: { lock?: (orientation: string) => Promise<void> } };

/**
 * Enter fullscreen on `element` (unless something already is) and ask for landscape, for a phone's first tap. Either
 * step may be unsupported (iPhone Safari has neither) or refused; both failures leave the page as it was.
 */
export async function enterTouchFullscreen(
  element: FullscreenElementLike,
  doc: FullscreenDocumentLike = document,
  screenLike: OrientationLike = globalThis.screen as OrientationLike,
): Promise<void> {
  try {
    if (getFullscreenElement(doc) === null) await requestFullscreen(element);
    await screenLike?.orientation?.lock?.('landscape');
  } catch {
    // NotSupportedError / NotAllowedError / SecurityError — stay as we are.
  }
}
