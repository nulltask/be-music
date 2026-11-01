/**
 * Fullscreen helpers for the player shell. Wraps the unprefixed Fullscreen API plus Safari's
 * `webkit*` aliases so a double-click on the Pixi canvas can toggle the page into (and out
 * of) fullscreen without the rest of the player having to know about vendor prefixes.
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

/**
 * The play surface (`#main`). Fullscreen covers this element: it holds the stage and the Debug Menu, and the site
 * header and the site footer sit outside it. A missing surface falls back to the document element.
 */
export function playerFullscreenElement(doc: {
  querySelector(selector: string): FullscreenElementLike | null;
  documentElement: FullscreenElementLike;
} = document): FullscreenElementLike {
  return doc.querySelector('#main') ?? doc.documentElement;
}

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
 * True when the player should consume Escape so the active scene (quit play / dismiss
 * result / close a select folder) does not also fire while leaving fullscreen. With the
 * Escape key locked ({@link FullscreenEscapeLock}) a short Esc press belongs to the page
 * and the browser leaves fullscreen on a long press instead, so nothing is consumed.
 */
export function shouldCaptureFullscreenEscape(
  event: Pick<KeyboardEvent, 'key' | 'code'>,
  doc: FullscreenDocumentLike = document,
  escapeLocked = false,
): boolean {
  if (escapeLocked) return false;
  return (event.key === 'Escape' || event.code === 'Escape') && getFullscreenElement(doc) !== null;
}

/** The slice of the Keyboard Lock API (`navigator.keyboard`, Chromium only) the player uses. */
export type KeyboardLockLike = {
  lock?: (keyCodes?: string[]) => Promise<void>;
  unlock?: () => void;
};

export type KeyboardLockNavigatorLike = { keyboard?: KeyboardLockLike };

/**
 * Locks the Escape key while the player is fullscreen, where the browser supports Keyboard Lock
 * (Chrome / Edge). A short Esc press then reaches the page — quitting the play as it does
 * windowed — and the browser leaves fullscreen only on a long press, showing its own hint.
 * Safari and Firefox have no `navigator.keyboard.lock`, so this is a no-op there and Esc
 * keeps leaving fullscreen first.
 */
export class FullscreenEscapeLock {
  private locked = false;
  /** Bumped on every sync so a lock that resolves after fullscreen was left is not recorded. */
  private generation = 0;
  private readonly nav: KeyboardLockNavigatorLike | undefined;
  private readonly onLockError: (error: unknown) => void;

  constructor(nav: KeyboardLockNavigatorLike | undefined, onLockError: (error: unknown) => void = () => {}) {
    this.nav = nav;
    this.onLockError = onLockError;
  }

  /** Whether Escape is currently locked (the lock request resolved and fullscreen has not been left since). */
  isLocked(): boolean {
    return this.locked;
  }

  /** Locks Escape when `fullscreen` is true, unlocks it otherwise. Lock failures are reported, never thrown. */
  async sync(fullscreen: boolean): Promise<void> {
    const keyboard = this.nav?.keyboard;
    const generation = ++this.generation;
    if (!fullscreen) {
      this.locked = false;
      keyboard?.unlock?.();
      return;
    }
    if (keyboard?.lock === undefined) return;
    try {
      await keyboard.lock(['Escape']);
      if (generation === this.generation) this.locked = true;
    } catch (error) {
      if (generation === this.generation) this.locked = false;
      this.onLockError(error);
    }
  }
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
