import { LOCALE_NAMES, LOCALES, withLocale, type Locale } from './locale.ts';

/** Who is signed in, when the page has a session. */
export interface ServiceHeaderAccount {
  handle: string;
  displayName: string;
  anonymous: boolean;
  /** Absolute or same-origin URL of the profile image. */
  avatarURL?: string;
}

export interface ServiceHeaderInput {
  locale: Locale;
  title: string;
  homeHref: string;
  playHref?: string;
  /** Help button in front of the Play slot. The page opens its `#help-modal` from the click. */
  help?: boolean;
  /** Install button in front of Help, while the page can be installed. The page handles the click. */
  install?: boolean;
  /** Settings button in the Play slot. `playHref` is ignored. */
  settings?: boolean;
  /** The Settings button's menu is open. */
  settingsOpen?: boolean;
  /** Fullscreen toggle beside Settings. The page handles the click. */
  fullscreen?: boolean;
  /** The page is fullscreen, so the button offers to leave. */
  fullscreenActive?: boolean;
  /** The row fills the viewport. Other services keep the centered `max-w-5xl` column. */
  spanViewport?: boolean;
  accountHref: string;
  account?: ServiceHeaderAccount;
  requestURL: string;
  /** Open a signed-in account in another tab, preserving the current application. */
  accountNewTab?: boolean;
}

/** Lucide icons, the same markup `lucide-static` gives the Leaderboard (`Icon` in app-leaderboard). */
const PLAY_ICON =
  '<svg class="lucide lucide-play" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/></svg>';
const SETTINGS_ICON =
  '<svg class="lucide lucide-settings" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/></svg>';
const HELP_ICON =
  '<svg class="lucide lucide-circle-help" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>';
const INSTALL_ICON =
  '<svg class="lucide lucide-download" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/></svg>';
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
    help: 'Help',
    install: 'Install',
    settings: 'Settings',
    fullscreen: 'Full screen',
    fullscreenExit: 'Exit full screen',
    guest: 'guest',
    languageAria: (name: string) => `Language: ${name}`,
    accountOf: (handle: string) => `Account of @${handle}`,
  },
  ja: {
    nav: 'サイト',
    signIn: 'ログイン',
    play: 'プレイ',
    playTitle: 'ブラウザでプレイ',
    help: 'ヘルプ',
    install: 'インストール',
    settings: '設定',
    fullscreen: 'フルスクリーン',
    fullscreenExit: 'フルスクリーン解除',
    guest: 'ゲスト',
    languageAria: (name: string) => `言語: ${name}`,
    accountOf: (handle: string) => `@${handle} のアカウント`,
  },
} as const;

export interface HeaderAction {
  key: 'install' | 'help' | 'settings' | 'fullscreen' | 'play';
  label: string;
  iconHTML: string;
  href?: string;
  title?: string;
  expanded?: boolean;
  pressed?: boolean;
  dialog?: string;
}

/** Shared presentation decisions for server markup and the Lit client view. */
export function resolveServiceHeader(input: ServiceHeaderInput) {
  const t = TEXT[input.locale];
  const actions: HeaderAction[] = [];
  if (input.install === true) actions.push({ key: 'install', label: t.install, iconHTML: INSTALL_ICON });
  if (input.help === true) actions.push({ key: 'help', label: t.help, iconHTML: HELP_ICON, dialog: 'help-modal' });
  if (input.settings === true)
    actions.push({
      key: 'settings',
      label: t.settings,
      iconHTML: SETTINGS_ICON,
      expanded: input.settingsOpen === true,
    });
  else if (input.playHref !== undefined)
    actions.push({ key: 'play', label: t.play, title: t.playTitle, iconHTML: PLAY_ICON, href: input.playHref });
  if (input.fullscreen === true)
    actions.push({
      key: 'fullscreen',
      label: input.fullscreenActive === true ? t.fullscreenExit : t.fullscreen,
      iconHTML: input.fullscreenActive === true ? MINIMIZE_ICON : MAXIMIZE_ICON,
      pressed: input.fullscreenActive === true,
    });
  const account = input.account;
  return {
    title: input.title,
    homeHref: input.homeHref,
    navLabel: t.nav,
    rowClass:
      input.spanViewport === true
        ? 'flex items-center gap-x-3 px-4 py-2.5 sm:gap-x-6'
        : 'mx-auto flex max-w-5xl items-center gap-x-3 px-4 py-2.5 sm:gap-x-6',
    badgeClass: input.spanViewport === true ? 'badge max-sm:hidden' : 'badge',
    account: {
      signedIn: account !== undefined,
      href: input.accountHref,
      newTab: account !== undefined && input.accountNewTab === true,
      label: account === undefined ? t.signIn : account.handle === '' ? account.displayName : `@${account.handle}`,
      ariaLabel:
        account === undefined ? undefined : account.handle === '' ? account.displayName : t.accountOf(account.handle),
      title:
        account === undefined
          ? undefined
          : account.anonymous
            ? `${account.displayName} (${t.guest})`
            : account.displayName,
      avatarURL: account?.avatarURL,
      iconHTML: CHEVRON_ICON,
    },
    actions,
    language: {
      label: t.languageAria(LOCALE_NAMES[input.locale]),
      iconHTML: LANGUAGES_ICON,
      checkIconHTML: CHECK_ICON,
      menuClass: `${HEADER_MENU_CLASS} w-44`,
      choices: LOCALES.map((locale) => ({
        locale,
        label: LOCALE_NAMES[locale],
        href: withLocale(input.requestURL, locale),
        current: locale === input.locale,
      })),
    },
  };
}
export type ServiceHeaderView = ReturnType<typeof resolveServiceHeader>;
