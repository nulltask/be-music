import {
  renderBuildInfo,
  renderServiceHeader,
  resolveLocale,
  SERVICE_CSS,
  serviceSkipLink,
  type BuildInfo,
  type Locale,
} from '@be-music/service-web-theme';

/** The Accounts public profile combined with the local OIDC session's anonymous status. */
export interface DashboardAccount {
  handle: string;
  displayName: string;
  anonymous: boolean;
  avatarURL?: string;
}

export type { Locale };

/** The other services of the dashboard's environment: `be-music.app` → `play.be-music.app`, and so on. */
export function serviceLinks(hostname: string): { play: string; leaderboard: string } {
  const site = hostname.toLowerCase();
  return { play: `https://play.${site}/`, leaderboard: `https://leaderboard.${site}/` };
}

/** Japanese when the browser prefers it, English otherwise. `?lang=` and the language cookie win in `resolveLocale`. */
export function pickLocale(acceptLanguage: string | null): Locale {
  return resolveLocale({ acceptLanguage: acceptLanguage ?? undefined });
}

const FOOTER_CLASS = 'text-muted-foreground mx-auto max-w-5xl border-t px-4 py-4 text-xs';
const LINK_CLASS = 'underline underline-offset-4 hover:text-foreground';

const TEXT = {
  ja: {
    title: 'Be-Music Dashboard',
    signedIn: (name: string, handle: string) => `${name}（@${handle}）でログイン中です。`,
    anonymous: (handle: string) =>
      `匿名アカウント @${handle} でログイン中です。パスキーを作ると、ほかの端末でも使えます。`,
    signedOut: 'ログインしていません。',
    play: 'プレイする',
    leaderboard: 'ランキングを見る',
    note: 'このページは仮のダッシュボードです。',
  },
  en: {
    title: 'Be-Music Dashboard',
    signedIn: (name: string, handle: string) => `Signed in as ${name} (@${handle}).`,
    anonymous: (handle: string) => `Signed in anonymously as @${handle}. Create a passkey to use it on other devices.`,
    signedOut: 'Not signed in.',
    play: 'Play',
    leaderboard: 'Leaderboard',
    note: 'This is a temporary dashboard.',
  },
} as const;

export function escapeHTML(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderDashboard(input: {
  account: DashboardAccount | undefined;
  hostname: string;
  locale: Locale;
  showDonateLink?: boolean;
  buildInfo?: BuildInfo;
  requestURL?: string;
  links?: { play: string; leaderboard: string; donate: string };
}): string {
  const t = TEXT[input.locale];
  const links = input.links ?? { ...serviceLinks(input.hostname), donate: `https://donate.${input.hostname}/` };
  const status =
    input.account === undefined
      ? t.signedOut
      : input.account.anonymous
        ? t.anonymous(input.account.handle)
        : t.signedIn(input.account.displayName, input.account.handle);
  const accountHref = input.account === undefined ? '/api/auth/sign-in' : '/api/auth/manage';
  const accountLabel =
    input.account === undefined
      ? input.locale === 'ja'
        ? 'ログイン'
        : 'Sign in'
      : input.locale === 'ja'
        ? 'アカウント管理'
        : 'Manage account';
  const signOut =
    input.account === undefined
      ? ''
      : `<form method="post" action="/api/auth/sign-out?returnTo=%2F"><button class="btn" data-size="sm" data-variant="outline" type="submit">${input.locale === 'ja' ? 'ログアウト' : 'Sign out'}</button></form>`;
  const serviceCard = (href: string, title: string, description: string, open: string) =>
    `<a class="card hover:bg-accent focus-visible:ring-ring/50 focus-visible:ring-3 gap-3 px-4 no-underline outline-none" data-size="sm" href="${escapeHTML(href)}"><h3 class="font-medium">${title}</h3><p class="text-muted-foreground flex-1">${description}</p><span class="font-medium">${open} <span aria-hidden="true">→</span></span></a>`;
  return `<!doctype html>
<html lang="${input.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${t.title}</title>
<style>${SERVICE_CSS}</style>
</head>
<body class="bg-background text-foreground min-h-svh antialiased">
${serviceSkipLink(input.locale)}
${renderServiceHeader({
  locale: input.locale,
  title: 'Be-Music Dashboard',
  homeHref: '/',
  playHref: links.play,
  accountHref,
  account: input.account,
  requestURL: input.requestURL ?? '/',
})}
<main class="mx-auto max-w-5xl px-4 pt-8 pb-12" id="main">
<div class="mb-6"><h1 class="text-2xl font-semibold tracking-tight">${input.locale === 'ja' ? 'ダッシュボード' : 'Dashboard'}</h1><p class="text-muted-foreground text-sm">${input.locale === 'ja' ? 'アカウントと、それぞれの be-music サービスへ。' : 'Your account and be-music services, in one place.'}</p></div>
<section class="card mb-8" data-size="sm" aria-labelledby="account-heading"><header><h2 id="account-heading">${input.locale === 'ja' ? 'アカウント' : 'Account'}</h2></header>
<section class="grid gap-4"><p class="text-muted-foreground text-sm" data-state="${input.account === undefined ? 'signed-out' : input.account.anonymous ? 'anonymous' : 'signed-in'}">${escapeHTML(status)}</p>
<div class="flex flex-wrap gap-2"><a class="btn no-underline" data-size="sm" href="${accountHref}">${accountLabel}</a>${signOut}</div></section></section>
<section aria-labelledby="services-heading"><h2 class="mb-4 text-lg font-semibold tracking-tight" id="services-heading">${input.locale === 'ja' ? 'サービス' : 'Services'}</h2><nav class="grid gap-4 sm:grid-cols-2" aria-label="${input.locale === 'ja' ? 'サービス' : 'Services'}">
${serviceCard(links.play, 'Play', input.locale === 'ja' ? 'BMS・Bmson の譜面をブラウザでプレイ。' : 'Play BMS and Bmson charts in your browser.', t.play)}
${serviceCard(links.leaderboard, 'Leaderboard', input.locale === 'ja' ? 'スコアやプレイヤーの記録をチェック。' : 'Explore scores, rankings and player records.', t.leaderboard)}
</nav></section>
</main>
<footer class="${FOOTER_CLASS}">be-music${input.showDonateLink ? ` · <a class="${LINK_CLASS}" href="${escapeHTML(links.donate)}">${input.locale === 'ja' ? '寄付' : 'Donate'}</a>` : ''}${input.buildInfo ? ' · ' + renderBuildInfo(input.buildInfo) : ''}</footer>
</body>
</html>
`;
}
