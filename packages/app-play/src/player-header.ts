import { renderServiceHeader, serviceSkipLink, type ServiceHeaderAccount } from '@be-music/service-web-theme';
import { onPlayerLangChange, playerLang, setPlayerLang, type PlayerLang } from './player-copy.ts';
import { leaderboardLink } from './service-links.ts';

/** The signed-in account the header shows. There is no avatar on the player session. */
export interface PlayerHeaderAccount {
  handle: string;
  displayName: string;
  anonymous: boolean;
}

export interface PlayerHeaderActions {
  /** Unfolds the existing Debug Menu. `null` clears a binding. */
  openDebugMenu?: (() => void) | null;
  /** Opens the player's sign-in dialog. `null` clears a binding. */
  openSignIn?: (() => void) | null;
  /** Switches the player language in place, the same path as Help. */
  selectLanguage?: (lang: PlayerLang) => void;
}

const actions: {
  openDebugMenu?: () => void;
  openSignIn?: () => void;
  selectLanguage: (lang: PlayerLang) => void;
} = {
  selectLanguage: (lang) => setPlayerLang(lang),
};

let account: PlayerHeaderAccount | undefined;
let host: HTMLElement | undefined;
let pendingMenu = false;
let pendingSignIn = false;

/** The shared header for Play: Settings sits where other services put the Play link. */
export function playerServiceHeaderHTML(input: {
  locale: PlayerLang;
  hostname: string;
  requestURL: string;
  account?: PlayerHeaderAccount;
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
): 'settings' | 'sign-in' | PlayerLang | undefined {
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

/**
 * Wires Settings, Sign in and the language menu. Settings and Sign in can arrive after the menu and the dialogs exist;
 * a click before that waits for them.
 */
export function bindPlayerHeader(next: PlayerHeaderActions): void {
  if (next.openDebugMenu === null) {
    actions.openDebugMenu = undefined;
    pendingMenu = false;
  } else if (next.openDebugMenu !== undefined) {
    actions.openDebugMenu = next.openDebugMenu;
    if (pendingMenu) {
      pendingMenu = false;
      next.openDebugMenu();
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
  paint();
}

function paint(): void {
  const root = host;
  if (root === undefined) return;
  const hostname = typeof location === 'undefined' ? 'localhost' : location.hostname;
  const requestURL = typeof location === 'undefined' ? '/' : `${location.pathname}${location.search}`;
  root.innerHTML = playerServiceHeaderHTML({ locale: playerLang(), hostname, requestURL, account });
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

export function runPlayerHeaderAction(kind: 'settings' | 'sign-in' | PlayerLang): void {
  if (kind === 'settings') {
    if (actions.openDebugMenu !== undefined) actions.openDebugMenu();
    else pendingMenu = true;
    return;
  }
  if (kind === 'sign-in') {
    if (actions.openSignIn !== undefined) actions.openSignIn();
    else pendingSignIn = true;
    return;
  }
  actions.selectLanguage(kind);
}
