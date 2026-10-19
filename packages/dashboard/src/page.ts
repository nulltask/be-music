/** The signed-in account as the Leaderboard's `GET /api/v0/me` reports it. */
export interface DashboardAccount {
  handle: string;
  displayName: string;
  anonymous: boolean;
}

export type Locale = 'ja' | 'en';

/** The other services of the dashboard's environment: `be-music.app` → `play.be-music.app`, and so on. */
export function serviceLinks(hostname: string): { play: string; leaderboard: string } {
  const site = hostname.toLowerCase();
  return { play: `https://play.${site}/`, leaderboard: `https://leaderboard.${site}/leaderboard` };
}

/** Japanese when the browser prefers it, English otherwise. */
export function pickLocale(acceptLanguage: string | null): Locale {
  const first = (acceptLanguage ?? '').split(',')[0]?.trim().toLowerCase() ?? '';
  return first.startsWith('ja') ? 'ja' : 'en';
}

const TEXT = {
  ja: {
    title: 'be-music',
    signedIn: (name: string, handle: string) => `${name}（@${handle}）でログイン中です。`,
    anonymous: (handle: string) =>
      `匿名アカウント @${handle} でログイン中です。パスキーを作ると、ほかの端末でも使えます。`,
    signedOut: 'ログインしていません。ログインは Leaderboard の右上から行えます。',
    play: 'プレイする',
    leaderboard: 'ランキングを見る',
    note: 'このページは仮のダッシュボードです。',
  },
  en: {
    title: 'be-music',
    signedIn: (name: string, handle: string) => `Signed in as ${name} (@${handle}).`,
    anonymous: (handle: string) => `Signed in anonymously as @${handle}. Create a passkey to use it on other devices.`,
    signedOut: 'Not signed in. Sign in from the top right of the Leaderboard.',
    play: 'Play',
    leaderboard: 'Leaderboard',
    note: 'This is a temporary dashboard.',
  },
} as const;

export function escapeHtml(value: string): string {
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
}): string {
  const t = TEXT[input.locale];
  const links = serviceLinks(input.hostname);
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
<style>
:root{color-scheme:light dark;--bg:#fafaf9;--fg:#1c1917;--muted:#57534e;--line:#e7e5e4;--card:#fff;--accent:#2563eb;--accent-fg:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--fg:#f5f5f4;--muted:#a8a29e;--line:#292524;--card:#1c1917;--accent:#60a5fa;--accent-fg:#0c0a09}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.7 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif}
main{max-width:640px;margin:0 auto;padding:48px 16px}
h1{font-size:1.75rem;margin:0 0 .5em}
.status{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.links{display:flex;gap:12px;flex-wrap:wrap;margin:24px 0}
.links a{background:var(--accent);color:var(--accent-fg);text-decoration:none;border-radius:8px;padding:10px 18px;font-weight:600}
.note{color:var(--muted);font-size:.875rem}
</style>
</head>
<body>
<main>
<h1>${t.title}</h1>
<p class="status" data-state="${input.account === undefined ? 'signed-out' : input.account.anonymous ? 'anonymous' : 'signed-in'}">${escapeHtml(status)}</p>
<nav class="links">
<a href="${links.play}">${t.play}</a>
<a href="${links.leaderboard}">${t.leaderboard}</a>
</nav>
<p class="note">${t.note}</p>
</main>
</body>
</html>
`;
}
