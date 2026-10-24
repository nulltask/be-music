import { LOCALE_NAMES, LOCALES, withLocale, type Locale } from './locale.ts';

/** Who is signed in, when the page has a session. */
export interface ServiceHeaderAccount {
  handle: string;
  displayName: string;
  anonymous: boolean;
  /** Absolute or same-origin URL of the profile image. */
  avatarURL?: string;
}

const PLAY_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/></svg>';
const LANGUAGES_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>';
const CHECK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

const TEXT = {
  en: {
    nav: 'Site',
    signIn: 'Sign in',
    play: 'Play',
    playTitle: 'Play in the browser',
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

/**
 * The header shared by every service page except Play. It follows the Leaderboard: an avatar and name, a Play button
 * with its icon, and a language menu. `title` is the fixed brand (`Be-Music Dashboard`), not translated.
 */
/** The skip link every service page puts before the shared header. */
export function serviceSkipLink(locale: Locale): string {
  return `<a class="skip-link" href="#main">${locale === 'ja' ? '本文へ移動' : 'Skip to content'}</a>`;
}

export function renderServiceHeader(input: {
  locale: Locale;
  title: string;
  homeHref: string;
  playHref?: string;
  accountHref: string;
  account?: ServiceHeaderAccount;
  requestURL: string;
}): string {
  const t = TEXT[input.locale];
  const play =
    input.playHref === undefined
      ? ''
      : `<a class="button" href="${escapeHTML(input.playHref)}" title="${escapeHTML(t.playTitle)}" aria-label="${escapeHTML(t.playTitle)}"><span class="btn-icon" aria-hidden="true">${PLAY_ICON}</span><span>${t.play}</span></a>`;
  const avatar =
    input.account?.avatarURL === undefined
      ? ''
      : `<img src="${escapeHTML(input.account.avatarURL)}" width="24" height="24" alt="" loading="lazy" decoding="async">`;
  const account =
    input.account === undefined
      ? `<a class="button secondary" href="${escapeHTML(input.accountHref)}">${t.signIn}</a>`
      : `<a class="account-chip" href="${escapeHTML(input.accountHref)}" title="${escapeHTML(input.account.displayName)}" aria-label="${escapeHTML(input.account.handle === '' ? input.account.displayName : t.accountOf(input.account.handle))}">${avatar}<span class="name">${escapeHTML(input.account.displayName)}</span>${input.account.handle === '' ? '' : `<span class="handle">@${escapeHTML(input.account.handle)}</span>`}${input.account.anonymous ? `<span class="guest">(${t.guest})</span>` : ''}</a>`;
  const languages = LOCALES.map((locale) => {
    const current = locale === input.locale;
    return `<a href="${escapeHTML(withLocale(input.requestURL, locale))}" lang="${locale}" hreflang="${locale}"${current ? ' aria-current="true"' : ''}><span class="mark${current ? '' : ' is-hidden'}" aria-hidden="true">${CHECK_ICON}</span>${LOCALE_NAMES[locale]}</a>`;
  }).join('');
  const languageMenu = `<div class="lang-menu"><button type="button" class="button ghost icon-button" popovertarget="language-menu" aria-label="${escapeHTML(t.languageAria(LOCALE_NAMES[input.locale]))}" title="${escapeHTML(t.language)}" style="anchor-name:--language-menu"><span class="btn-icon" aria-hidden="true">${LANGUAGES_ICON}</span></button><div id="language-menu" popover="auto" class="lang-popover" style="position-anchor:--language-menu;inset:auto;margin:6px 0;position-area:block-end span-inline-end">${languages}</div></div>`;
  return `<header class="site-header"><div class="header-inner"><a class="brand" href="${escapeHTML(input.homeHref)}">${escapeHTML(input.title)}</a><nav class="header-nav" aria-label="${t.nav}">${play}${account}${languageMenu}</nav></div></header>`;
}
