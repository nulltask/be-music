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
  return `<!doctype html>
<html lang="${input.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${t.title}</title>
<style>${SERVICE_CSS}
.account-panel{margin-bottom:32px}.account-panel p{font-size:.875rem}.service-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.service-card{display:flex;flex-direction:column;gap:12px;color:var(--fg);text-decoration:none;min-width:0}.service-card p{font-size:.875rem;margin:0;color:var(--muted);flex:1}.service-card .service-open{font-size:.875rem;font-weight:500}.services-heading{margin-bottom:16px}@media(hover:hover){.service-card:hover{background:var(--soft)}}.service-card:focus-visible{outline:3px solid var(--ring);outline-offset:3px}@media(max-width:640px){.service-grid{grid-template-columns:1fr}}
</style>
</head>
<body>
${serviceSkipLink(input.locale)}
${renderServiceHeader({
  locale: input.locale,
  title: 'Be-Music Dashboard',
  homeHref: '/',
  playHref: links.play,
  accountHref: input.account === undefined ? '/api/auth/sign-in' : '/api/auth/manage',
  account: input.account,
  requestURL: input.requestURL ?? '/',
})}
<main class="site-main" id="main">
<div class="page-heading"><h1>${input.locale === 'ja' ? 'ダッシュボード' : 'Dashboard'}</h1><p>${input.locale === 'ja' ? 'アカウントと、それぞれの be-music サービスへ。' : 'Your account and be-music services, in one place.'}</p></div>
<section class="panel account-panel" aria-labelledby="account-heading"><h2 id="account-heading">${input.locale === 'ja' ? 'アカウント' : 'Account'}</h2>
<p class="muted" data-state="${input.account === undefined ? 'signed-out' : input.account.anonymous ? 'anonymous' : 'signed-in'}">${escapeHTML(status)}</p>
<div class="actions"><a class="button" href="${input.account === undefined ? '/api/auth/sign-in' : '/api/auth/manage'}">${input.account === undefined ? (input.locale === 'ja' ? 'ログイン' : 'Sign in') : input.locale === 'ja' ? 'アカウント管理' : 'Manage account'}</a>${input.account === undefined ? '' : `<form method="post" action="/api/auth/sign-out?returnTo=%2F"><button class="button secondary" type="submit">${input.locale === 'ja' ? 'ログアウト' : 'Sign out'}</button></form>`}</div></section>
<section aria-labelledby="services-heading"><h2 class="services-heading" id="services-heading">${input.locale === 'ja' ? 'サービス' : 'Services'}</h2><nav class="service-grid" aria-label="${input.locale === 'ja' ? 'サービス' : 'Services'}">
<a class="panel service-card" href="${escapeHTML(links.play)}"><h3>Play</h3><p>${input.locale === 'ja' ? 'BMS・Bmson の譜面をブラウザでプレイ。' : 'Play BMS and Bmson charts in your browser.'}</p><span class="service-open">${t.play} <span aria-hidden="true">→</span></span></a>
<a class="panel service-card" href="${escapeHTML(links.leaderboard)}"><h3>Leaderboard</h3><p>${input.locale === 'ja' ? 'スコアやプレイヤーの記録をチェック。' : 'Explore scores, rankings and player records.'}</p><span class="service-open">${t.leaderboard} <span aria-hidden="true">→</span></span></a>
</nav></section>
</main>
<footer class="site-footer">be-music${input.showDonateLink ? ` · <a href="${escapeHTML(links.donate)}">${input.locale === 'ja' ? '寄付' : 'Donate'}</a>` : ''}${input.buildInfo ? ' · ' + renderBuildInfo(input.buildInfo) : ''}</footer>
</body>
</html>
`;
}
