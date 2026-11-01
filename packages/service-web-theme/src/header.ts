import { LOCALE_NAMES, LOCALES, withLocale, type Locale } from './locale.ts';

/** Who is signed in, when the page has a session. */
export interface ServiceHeaderAccount {
  handle: string;
  displayName: string;
  anonymous: boolean;
  /** Absolute or same-origin URL of the profile image. */
  avatarURL?: string;
}

/** Lucide icons, the same markup `lucide-static` gives the Leaderboard (`Icon` in app-leaderboard). */
const PLAY_ICON =
  '<svg class="lucide lucide-play" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/></svg>';
const SETTINGS_ICON =
  '<svg class="lucide lucide-settings" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/></svg>';
const MAXIMIZE_ICON =
  '<svg class="lucide lucide-maximize" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
const MINIMIZE_ICON =
  '<svg class="lucide lucide-minimize" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>';
const LANGUAGES_ICON =
  '<svg class="lucide lucide-languages" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>';
const CHECK_ICON =
  '<svg class="lucide lucide-check" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const CHEVRON_ICON =
  '<svg class="lucide lucide-chevron-down" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

/** The frame of the language menu. It sits in the header's row, so it turns wrapping back on. */
const HEADER_MENU_CLASS =
  'bg-popover text-popover-foreground max-w-[calc(100vw-2rem)] rounded-lg border p-1 text-sm whitespace-normal [word-break:auto-phrase] shadow-md';

const TEXT = {
  en: {
    nav: 'Site',
    signIn: 'Sign in',
    play: 'Play',
    playTitle: 'Play in the browser',
    settings: 'Settings',
    settingsTitle: 'Debug Menu',
    fullscreen: 'Full screen',
    fullscreenExit: 'Exit full screen',
    guest: 'guest',
    language: 'Language',
    languageAria: (name: string) => `Language: ${name}`,
    accountOf: (handle: string) => `Account of @${handle}`,
  },
  ja: {
    nav: 'サイト',
    signIn: 'ログイン',
    play: 'プレイ',
    playTitle: 'ブラウザでプレイ',
    settings: '設定',
    settingsTitle: 'デバッグメニュー',
    fullscreen: 'フルスクリーン',
    fullscreenExit: 'フルスクリーン解除',
    guest: 'ゲスト',
    language: '言語',
    languageAria: (name: string) => `言語: ${name}`,
    accountOf: (handle: string) => `@${handle} のアカウント`,
  },
} as const;

function escapeHTML(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** The Leaderboard's icon wrapper: the svg stays 16px, and `className` colours it. */
function headerIcon(svg: string, className = ''): string {
  const classes =
    className === '' ? 'inline-flex shrink-0 [&>svg]:size-4' : `inline-flex shrink-0 [&>svg]:size-4 ${className}`;
  return `<span class="${classes}" aria-hidden="true">${svg}</span>`;
}

/** The skip link every service page puts before the shared header. */
export function serviceSkipLink(locale: Locale): string {
  return `<a class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground" href="#main">${locale === 'ja' ? '本文へ移動' : 'Skip to content'}</a>`;
}

/**
 * The header shared by Dashboard, Accounts, Leaderboard and Play. The trailing cluster follows the Leaderboard's: the
 * account (avatar and @handle, or Sign in), then Play, then the language menu, in that order. Play can put a fullscreen
 * button between Play's slot and the language menu. `title` is the fixed brand (`Be-Music Dashboard`), not translated,
 * with one Beta badge beside it. The account control links to `accountHref` (these pages have no account menu).
 * `settings` replaces the Play link with a Settings button (`data-service-header="settings"`); the page wires the
 * click. Play's button toggles its Debug Menu, and `settingsOpen` sets `aria-expanded`. The two are never both shown.
 * `fullscreen` adds a button beside Settings (`data-service-header="fullscreen"`). Only Play sets it; the page toggles
 * fullscreen from the click.
 */
export function renderServiceHeader(input: {
  locale: Locale;
  title: string;
  homeHref: string;
  playHref?: string;
  /** Settings button in the Play slot. `playHref` is ignored. */
  settings?: boolean;
  /** The Settings button's menu is open. */
  settingsOpen?: boolean;
  /** Fullscreen toggle beside Settings. The page handles the click. */
  fullscreen?: boolean;
  /** The page is fullscreen, so the button offers to leave. */
  fullscreenActive?: boolean;
  accountHref: string;
  account?: ServiceHeaderAccount;
  requestURL: string;
}): string {
  const t = TEXT[input.locale];
  const play =
    input.settings === true
      ? `<button type="button" class="btn" data-size="sm" data-service-header="settings" title="${escapeHTML(t.settingsTitle)}" aria-label="${escapeHTML(t.settings)}" aria-expanded="${input.settingsOpen === true ? 'true' : 'false'}">${headerIcon(SETTINGS_ICON)}<span class="hidden md:inline">${t.settings}</span></button>`
      : input.playHref === undefined
        ? ''
        : `<a class="btn" data-size="sm" href="${escapeHTML(input.playHref)}" title="${escapeHTML(t.playTitle)}" aria-label="${escapeHTML(t.play)}">${headerIcon(PLAY_ICON)}<span class="hidden md:inline">${t.play}</span></a>`;
  const fullscreen = input.fullscreen === true ? renderFullscreenButton(t, input.fullscreenActive === true) : '';
  const account = renderAccount(input.account, input.accountHref, t);
  const languages = LOCALES.map((locale) => {
    const current = locale === input.locale;
    return `<a class="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5" href="${escapeHTML(withLocale(input.requestURL, locale))}" lang="${locale}" hreflang="${locale}"${current ? ' aria-current="true"' : ''}><span${current ? '' : ' class="invisible"'}>${headerIcon(CHECK_ICON)}</span>${LOCALE_NAMES[locale]}</a>`;
  }).join('');
  const languageMenu = `<div class="relative"><button type="button" class="btn" data-size="sm" data-variant="ghost" popovertarget="language-menu" aria-label="${escapeHTML(t.languageAria(LOCALE_NAMES[input.locale]))}" title="${escapeHTML(t.language)}" style="anchor-name:--language-menu">${headerIcon(LANGUAGES_ICON, 'text-muted-foreground')}</button><div id="language-menu" popover="auto" class="${HEADER_MENU_CLASS} w-44" style="position-anchor:--language-menu;inset:auto;margin:6px 0;position-area:block-end span-inline-start;position-try-fallbacks:flip-inline,--header-menu-span">${languages}</div></div>`;
  return `<header class="bg-background/90 sticky top-0 z-40 border-b backdrop-blur"><div class="mx-auto flex max-w-5xl items-center gap-x-3 px-4 py-2.5 sm:gap-x-6"><div class="flex shrink-0 items-center gap-1"><a class="font-semibold tracking-tight whitespace-nowrap no-underline" href="${escapeHTML(input.homeHref)}">${escapeHTML(input.title)}</a><span class="badge" data-variant="outline">Beta</span></div><nav class="ms-auto flex items-center gap-1 whitespace-nowrap sm:gap-2" aria-label="${t.nav}">${account}${play}${fullscreen}${languageMenu}</nav></div></header>`;
}

function renderFullscreenButton(t: (typeof TEXT)[Locale], active: boolean): string {
  const label = active ? t.fullscreenExit : t.fullscreen;
  const icon = active ? MINIMIZE_ICON : MAXIMIZE_ICON;
  return `<button type="button" class="btn" data-size="sm" data-service-header="fullscreen" title="${escapeHTML(label)}" aria-label="${escapeHTML(label)}" aria-pressed="${active ? 'true' : 'false'}">${headerIcon(icon)}<span class="hidden md:inline">${label}</span></button>`;
}

function renderAccount(
  account: ServiceHeaderAccount | undefined,
  accountHref: string,
  t: (typeof TEXT)[Locale],
): string {
  const href = escapeHTML(accountHref);
  if (account === undefined) {
    return `<a class="btn" data-size="sm" data-variant="ghost" data-service-header="account" href="${href}">${t.signIn}</a>`;
  }
  const avatar =
    account.avatarURL === undefined
      ? ''
      : `<img class="bg-muted ring-foreground/10 inline-block shrink-0 rounded-full ring-1" src="${escapeHTML(account.avatarURL)}" width="24" height="24" alt="" loading="lazy" decoding="async">`;
  const handle = account.handle === '' ? '' : `@${escapeHTML(account.handle)}`;
  const visible = handle === '' ? escapeHTML(account.displayName) : handle;
  const label = account.handle === '' ? account.displayName : t.accountOf(account.handle);
  const title = account.anonymous ? `${account.displayName} (${t.guest})` : account.displayName;
  return `<a class="btn" data-size="sm" data-variant="ghost" data-service-header="account" href="${href}" title="${escapeHTML(title)}" aria-label="${escapeHTML(label)}">${avatar}<span class="hidden max-w-[12ch] truncate sm:inline">${visible}</span>${headerIcon(CHEVRON_ICON, 'text-muted-foreground')}</a>`;
}
