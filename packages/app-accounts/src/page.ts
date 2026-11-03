import {
  html,
  nothing,
  unsafeHTML,
  renderHTML,
  serviceHeaderTemplate,
  serviceFooterTemplate,
  serviceSkipLinkTemplate,
} from '@be-music/service-web-theme/server';
import { SERVICE_CSS, SERVICE_FOOTER_LINK_CLASS, type BuildInfo, type Locale } from '@be-music/service-web-theme';

const TEXT = {
  en: {
    guest: 'Guest',
    services: 'Services',
    signIn: 'Sign in',
    yourAccount: 'Your account',
    signedIn: (name: string, guest: boolean) => `Signed in as ${name}${guest ? ' (guest)' : ''}.`,
    lead: 'One account for all Be-Music services.',
    continue: 'Continue with this account',
    passkey: 'Sign in with a passkey',
    signInWith: (label: string) => `Sign in with ${label}`,
    linked: (label: string) => `${label} is linked.`,
    link: (label: string) => `Link ${label}`,
    guestStart: 'Start a guest account',
    addPasskey: 'Add a passkey to keep this account',
    signOut: 'Sign out of Accounts',
    profile: 'Profile',
    handle: 'Handle',
    displayName: 'Display name',
    saveProfile: 'Save profile',
    avatar: 'Avatar',
    yourAvatar: 'Your avatar',
    uploadAvatar: 'Upload avatar',
    generatedAvatar: 'Use generated avatar',
    donate: 'Donate',
    footnote:
      'Signing out here ends the Accounts session. Existing app sessions expire within 10 minutes; each app also has its own sign-out.',
    noticeLinked: 'That account is already linked to another Be-Music account.',
    noticeCancelled: 'Linking was cancelled.',
    noticeFailed: 'Could not link that account.',
  },
  ja: {
    guest: 'ゲスト',
    services: 'サービス',
    signIn: 'ログイン',
    yourAccount: 'アカウント',
    signedIn: (name: string, guest: boolean) =>
      guest ? `${name}（ゲスト）でログイン中です。` : `${name} でログイン中です。`,
    lead: 'Be-Music の各サービスで共通のアカウントです。',
    continue: 'このアカウントで続ける',
    passkey: 'パスキーでログイン',
    signInWith: (label: string) => `${label} でログイン`,
    linked: (label: string) => `${label} は連携済みです。`,
    link: (label: string) => `${label} を連携`,
    guestStart: 'ゲストアカウントで始める',
    addPasskey: 'パスキーを追加してこのアカウントを残す',
    signOut: 'Accounts からログアウト',
    profile: 'プロフィール',
    handle: 'ユーザー名',
    displayName: '表示名',
    saveProfile: 'プロフィールを保存',
    avatar: 'アバター',
    yourAvatar: 'あなたのアバター',
    uploadAvatar: 'アバターをアップロード',
    generatedAvatar: '生成したアバターを使う',
    donate: '寄付',
    footnote:
      'ここでログアウトすると Accounts のセッションが終わります。各アプリのセッションは 10 分以内に切れます。アプリごとのログアウトもあります。',
    noticeLinked: 'そのアカウントは別の Be-Music アカウントにすでに連携されています。',
    noticeCancelled: '連携を取り消しました。',
    noticeFailed: 'アカウントを連携できませんでした。',
  },
} as const;

export function accountNotice(code: string | null, locale: Locale = 'en'): string {
  const t = TEXT[locale];
  if (code === 'account_already_linked_to_different_user') return t.noticeLinked;
  if (code === 'access_denied') return t.noticeCancelled;
  if (code) return t.noticeFailed;
  return '';
}

const LINK_CLASS = SERVICE_FOOTER_LINK_CLASS;

const PASSKEY_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg>';
const GOOGLE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z"/></svg>';
const DISCORD_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#5865F2" d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.3 18.3 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5A20.3 20.3 0 0 0 .1 18a19.9 19.9 0 0 0 6 3l1.3-2.1a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3 20.2 20.2 0 0 0-3.6-13.6zM8 15.3c-1.2 0-2.2-1.1-2.2-2.4 0-1.4 1-2.5 2.2-2.5s2.2 1.1 2.2 2.5c0 1.3-1 2.4-2.2 2.4zm8 0c-1.2 0-2.2-1.1-2.2-2.4 0-1.4 1-2.5 2.2-2.5s2.2 1.1 2.2 2.5c0 1.3-1 2.4-2.2 2.4z"/></svg>';

function actionIcon(action: string): string {
  if (action === 'passkey' || action === 'add-passkey') return PASSKEY_ICON;
  if (action === 'google' || action === 'link-google') return GOOGLE_ICON;
  if (action === 'discord' || action === 'link-discord') return DISCORD_ICON;
  return '';
}

function requestHostname(requestURL: string | undefined): string {
  if (requestURL === undefined) return 'localhost';
  try {
    return new URL(requestURL).hostname;
  } catch {
    return 'localhost';
  }
}

export function renderAccountPage(input: {
  signedIn: boolean;
  anonymous: boolean;
  name: string;
  login: boolean;
  discord: boolean;
  google: boolean;
  linkedDiscord?: boolean;
  linkedGoogle?: boolean;
  notice?: string;
  locale?: Locale;
  requestURL?: string;
  profile?: { handle: string; displayName: string; avatarURL: string };
  apps?: Record<string, string>;
  showDonateLink?: boolean;
  buildInfo?: BuildInfo;
}): string {
  const button = (action: string, label: string, primary = false) => {
    const icon = actionIcon(action);
    return html`<button
      class="btn w-full whitespace-normal"
      type="button"
      data-action=${action}
      data-variant=${primary ? nothing : 'outline'}
    >
      ${icon === '' ? nothing : html`<span class="inline-flex size-4 shrink-0">${unsafeHTML(icon)}</span>`}${label}
    </button>`;
  };
  const home = input.apps?.dashboard ?? '/account';
  const locale = input.locale ?? 'en';
  const t = TEXT[locale];
  const providerControl = (provider: 'discord' | 'google', label: string, configured: boolean, linked: boolean) => {
    if (!configured) return nothing;
    if (!input.signedIn) return button(provider, t.signInWith(label));
    if (linked) return html`<p class="text-muted-foreground text-sm">${t.linked(label)}</p>`;
    return button(`link-${provider}`, t.link(label));
  };
  const account = input.signedIn
    ? {
        handle: input.profile?.handle ?? '',
        displayName: input.profile?.displayName || input.name || t.guest,
        anonymous: input.anonymous,
        avatarURL: input.profile?.avatarURL,
      }
    : undefined;
  const profile =
    input.signedIn && !input.login && input.profile
      ? html` <section class="grid gap-4 border-t pt-4">
          <h2 class="text-sm font-medium">${t.profile}</h2>
          <form id="profile-form" class="grid gap-4">
            <label class="grid gap-2 text-sm font-medium"
              >${t.handle}<input
                class="input"
                name="handle"
                value=${input.profile.handle}
                required
                minlength="3"
                maxlength="15"
                pattern="[A-Za-z0-9_]{3,15}"
                autocomplete="username"
            /></label>
            <label class="grid gap-2 text-sm font-medium"
              >${t.displayName}<input
                class="input"
                name="displayName"
                value=${input.profile.displayName}
                required
                maxlength="64"
                autocomplete="nickname"
            /></label>
            <button class="btn w-full whitespace-normal" type="submit">${t.saveProfile}</button>
          </form>
          <h2 class="text-sm font-medium">${t.avatar}</h2>
          <img class="size-24 rounded-lg" src=${input.profile.avatarURL} width="96" height="96" alt=${t.yourAvatar} />
          <label class="grid gap-2 text-sm font-medium"
            >${t.uploadAvatar}<input
              class="input"
              type="file"
              id="avatar-input"
              accept="image/png,image/jpeg,image/webp"
          /></label>
          <button class="btn w-full whitespace-normal" data-variant="outline" type="button" data-action="remove-avatar">
            ${t.generatedAvatar}
          </button>
        </section>`
      : nothing;
  const serviceEntries = Object.entries(input.apps ?? {}).filter(([serviceName]) => serviceName !== 'donate');
  const services =
    serviceEntries.length === 0
      ? nothing
      : html` <section class="grid gap-3 border-t pt-4">
          <h2 class="text-sm font-medium">${t.services}</h2>
          <nav class="flex flex-wrap gap-3 text-sm" aria-label=${t.services}>
            ${serviceEntries.map(([serviceName, origin]) => html`<a class=${LINK_CLASS} href=${new URL('/api/auth/sign-in', origin).href}>${serviceName}</a>`)}
          </nav>
        </section>`;
  const donate =
    input.showDonateLink && input.apps?.donate
      ? html`<a class=${LINK_CLASS} href=${new URL('/api/auth/sign-in', input.apps.donate).href}>${t.donate}</a>`
      : nothing;
  const footer = serviceFooterTemplate({
    current: 'accounts',
    hostname: requestHostname(input.requestURL),
    navLabel: t.services,
    siteHTML: input.showDonateLink && input.apps?.donate ? renderHTML(donate) : undefined,
    buildInfo: input.buildInfo,
    locale,
  });
  return renderHTML(
    html`<!doctype html>
      <html lang=${locale}>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <meta name="robots" content="noindex" />
          <title>Be-Music Accounts</title>
          ${unsafeHTML(`<style>${SERVICE_CSS}</style>`)}
        </head>
        <body class="bg-background text-foreground min-h-svh antialiased">
          ${serviceSkipLinkTemplate(locale)}
          ${serviceHeaderTemplate({
            locale,
            title: 'Be-Music Accounts',
            homeHref: home,
            playHref: input.apps?.play === undefined ? undefined : new URL('/api/auth/sign-in', input.apps.play).href,
            accountHref: input.signedIn ? '/account' : '/login',
            account,
            requestURL: input.requestURL ?? (input.login ? '/login' : '/account'),
          })}
          <main class="mx-auto w-full max-w-lg px-4 pt-12 pb-12" id="main">
            <section class="card" data-size="sm" aria-labelledby="accounts-title">
              <header>
                <h1 class="text-2xl font-semibold tracking-tight" id="accounts-title">
                  ${input.login ? t.signIn : t.yourAccount}
                </h1>
                <p class="text-muted-foreground text-sm">
                  ${input.signedIn ? t.signedIn(input.name || t.guest, input.anonymous) : t.lead}
                </p>
              </header>
              <section class="grid gap-3">
                ${input.login && input.signedIn ? button('continue', t.continue, true) : nothing}
                ${!input.signedIn || input.login ? button('passkey', t.passkey, !input.signedIn) : nothing}
                ${providerControl('discord', 'Discord', input.discord, input.linkedDiscord === true)}
                ${providerControl('google', 'Google', input.google, input.linkedGoogle === true)}
                ${!input.signedIn ? button('guest', t.guestStart) : nothing}
                ${input.signedIn ? html`${button('add-passkey', t.addPasskey, !input.login)}${button('sign-out', t.signOut)}` : nothing}
              </section>
              ${profile}
              <section>
                <be-music-status class="text-destructive min-h-6 text-sm" id="status" role="status" aria-live="polite"
                  >${input.notice ?? ''}</be-music-status
                >
              </section>
              ${services}
            </section>
            <p class="text-muted-foreground mt-6 text-xs">${t.footnote}</p>
          </main>
          ${footer}
          <script type="module" src="/assets/client.js"></script>
        </body>
      </html>`,
  );
}
