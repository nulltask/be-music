import { renderServiceHeader, serviceSkipLink, type ServiceHeaderAccount } from '@be-music/service-web-theme';
import {
  enterTouchFullscreen,
  getFullscreenElement,
  toggleFullscreen,
  type FullscreenDocumentLike,
  type FullscreenElementLike,
} from './fullscreen.ts';
import { onPlayerLangChange, playerLang, setPlayerLang, type PlayerLang } from './player-copy.ts';
import { leaderboardLink } from './service-links.ts';

/** The signed-in account the header shows. There is no avatar on the player session. */
export interface PlayerHeaderAccount {
  handle: string;
  displayName: string;
  anonymous: boolean;
}

export interface PlayerHeaderActions {
  /** Opens the existing Debug Menu when it is closed, and closes it when it is open. `null` clears a binding. */
  toggleDebugMenu?: (() => void) | null;
  /** Opens the player's sign-in dialog. `null` clears a binding. */
  openSignIn?: (() => void) | null;
  /** Switches the player language in place, the same path as Help. */
  selectLanguage?: (lang: PlayerLang) => void;
}

const actions: {
  toggleDebugMenu?: () => void;
  openSignIn?: () => void;
  selectLanguage: (lang: PlayerLang) => void;
} = {
  selectLanguage: (lang) => setPlayerLang(lang),
};

let account: PlayerHeaderAccount | undefined;
let host: HTMLElement | undefined;
/** An odd number of Settings clicks arrived before the menu existed, so the first bind should open it. */
let pendingMenu = false;
let pendingSignIn = false;
/** Whether the Debug Menu pane is expanded. The gear's `aria-expanded` follows it. */
let settingsOpen = false;

/** The document the header's fullscreen button reads. A phone fullscreens `documentElement`; a desktop, `.shell`. */
export interface PlayerHeaderFullscreenDocument extends FullscreenDocumentLike {
  documentElement: FullscreenElementLike & { classList: { contains(token: string): boolean } };
  querySelector(selector: string): FullscreenElementLike | null;
}

/**
 * The element the header toggles, matching the stage: the shell on a desktop, the document element on a phone
 * (`html.phone`, the same target as the phone's first tap).
 */
export function playerHeaderFullscreenTarget(doc: PlayerHeaderFullscreenDocument): FullscreenElementLike {
  if (doc.documentElement.classList.contains('phone')) return doc.documentElement;
  return doc.querySelector('.shell') ?? doc.documentElement;
}

/**
 * Enters or leaves fullscreen with the player's existing helpers. A phone that is still windowed uses
 * {@link enterTouchFullscreen} (document element, then landscape). Anything else uses {@link toggleFullscreen}.
 */
export async function togglePlayerHeaderFullscreen(
  doc: PlayerHeaderFullscreenDocument,
  screenLike?: { orientation?: { lock?: (orientation: string) => Promise<void> } },
): Promise<void> {
  const target = playerHeaderFullscreenTarget(doc);
  const enteringOnPhone = doc.documentElement.classList.contains('phone') && getFullscreenElement(doc) === null;
  if (enteringOnPhone) {
    if (screenLike === undefined) await enterTouchFullscreen(target, doc);
    else await enterTouchFullscreen(target, doc, screenLike);
    return;
  }
  await toggleFullscreen(target, doc);
}

/**
 * The shared header for Play: it spans the viewport, Settings sits where other services put the Play link, and
 * fullscreen sits beside Settings.
 */
export function playerServiceHeaderHTML(input: {
  locale: PlayerLang;
  hostname: string;
  requestURL: string;
  account?: PlayerHeaderAccount;
  /** The page is fullscreen, so the button offers to leave. */
  fullscreenActive?: boolean;
  /** The Debug Menu is open, so the gear is expanded. */
  settingsOpen?: boolean;
}): string {
  const signedIn: ServiceHeaderAccount | undefined =
    input.account === undefined
      ? undefined
      : {
          handle: input.account.handle,
          displayName: input.account.displayName,
          anonymous: input.account.anonymous,
        };
  const accountHref =
    input.account === undefined
      ? '#sign-in'
      : leaderboardLink(`/players/${encodeURIComponent(input.account.handle)}`, input.hostname);
  const html = `${serviceSkipLink(input.locale)}${renderServiceHeader({
    locale: input.locale,
    title: 'Be-Music Play',
    homeHref: '/',
    settings: true,
    settingsOpen: input.settingsOpen === true,
    fullscreen: true,
    fullscreenActive: input.fullscreenActive === true,
    spanViewport: true,
    accountHref,
    account: signedIn,
    requestURL: input.requestURL,
  })}`;
  // A signed-in account opens its Leaderboard page in a new tab, so the loaded library stays.
  if (input.account === undefined) return html;
  return html.replace(
    'data-service-header="account" href="',
    'data-service-header="account" target="_blank" rel="noopener" href="',
  );
}

/** What a click in the header should do. `sign-in` only while signed out. */
export function classifyPlayerHeaderClick(
  target: { closest(selector: string): { lang?: string } | null },
  signedOut: boolean,
): 'settings' | 'fullscreen' | 'sign-in' | PlayerLang | undefined {
  if (target.closest('[data-service-header="fullscreen"]') !== null) return 'fullscreen';
  if (target.closest('[data-service-header="settings"]') !== null) return 'settings';
  const language = target.closest('#language-menu a');
  if (language?.lang === 'en' || language?.lang === 'ja') return language.lang;
  if (signedOut && target.closest('[data-service-header="account"]') !== null) return 'sign-in';
  return undefined;
}

/** Remembers who is signed in and repaints the header. */
export function setPlayerHeaderAccount(next: PlayerHeaderAccount | undefined): void {
  account = next;
  paint();
}

/** The gear's `aria-expanded` follows the existing Debug Menu pane. */
export function setPlayerHeaderSettingsOpen(open: boolean): void {
  if (settingsOpen === open) return;
  settingsOpen = open;
  paint();
}

/**
 * Wires Settings, Sign in and the language menu. Settings and Sign in can arrive after the menu and the dialogs exist;
 * a click before that waits. A second Settings click before the menu exists cancels the first. Fullscreen calls
 * {@link togglePlayerHeaderFullscreen} itself.
 */
export function bindPlayerHeader(next: PlayerHeaderActions): void {
  if (next.toggleDebugMenu === null) {
    actions.toggleDebugMenu = undefined;
    pendingMenu = false;
  } else if (next.toggleDebugMenu !== undefined) {
    actions.toggleDebugMenu = next.toggleDebugMenu;
    if (pendingMenu) {
      pendingMenu = false;
      next.toggleDebugMenu();
    }
  }
  if (next.openSignIn === null) {
    actions.openSignIn = undefined;
    pendingSignIn = false;
  } else if (next.openSignIn !== undefined) {
    actions.openSignIn = next.openSignIn;
    if (pendingSignIn) {
      pendingSignIn = false;
      next.openSignIn();
    }
  }
  if (next.selectLanguage !== undefined) actions.selectLanguage = next.selectLanguage;
}

/** Paints the header and keeps it on the player's language. Clicks stay on this element across repaints. */
export function mountPlayerHeader(root: HTMLElement): void {
  host = root;
  root.addEventListener('click', onClick);
  onPlayerLangChange(() => paint());
  document.addEventListener('fullscreenchange', paint);
  document.addEventListener('webkitfullscreenchange', paint);
  paint();
}

function paint(): void {
  const root = host;
  if (root === undefined) return;
  const hostname = typeof location === 'undefined' ? 'localhost' : location.hostname;
  const requestURL = typeof location === 'undefined' ? '/' : `${location.pathname}${location.search}`;
  root.innerHTML = playerServiceHeaderHTML({
    locale: playerLang(),
    hostname,
    requestURL,
    account,
    fullscreenActive: getFullscreenElement(document) !== null,
    settingsOpen,
  });
}

function onClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const kind = classifyPlayerHeaderClick(
    {
      closest: (selector) => {
        const match = target.closest(selector);
        return match === null ? null : { lang: match instanceof HTMLAnchorElement ? match.lang : undefined };
      },
    },
    account === undefined,
  );
  if (kind === undefined) return;
  event.preventDefault();
  runPlayerHeaderAction(kind);
}

export function runPlayerHeaderAction(kind: 'settings' | 'fullscreen' | 'sign-in' | PlayerLang): void {
  if (kind === 'fullscreen') {
    if (typeof document !== 'undefined') void togglePlayerHeaderFullscreen(document);
    return;
  }
  if (kind === 'settings') {
    if (actions.toggleDebugMenu !== undefined) actions.toggleDebugMenu();
    else pendingMenu = !pendingMenu;
    return;
  }
  if (kind === 'sign-in') {
    if (actions.openSignIn !== undefined) actions.openSignIn();
    else pendingSignIn = true;
    return;
  }
  actions.selectLanguage(kind);
}
