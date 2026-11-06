import {
  html,
  nothing,
  unsafeHTML,
  renderHTML,
  serviceHeaderTemplate,
  serviceFooterTemplate,
  serviceSkipLinkTemplate,
  authButtonTemplate,
  avatarTemplate,
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
    passkeyStart: 'Start with a passkey',
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
    welcome: {
      title: 'Welcome to Be-Music',
      lead: 'Your account is ready. A few things before you play — each can wait.',
      steps: ['Profile', 'Keep the account', 'Done'],
      stepOf: (step: number, total: number) => `Step ${step} of ${total}`,
      profileTitle: 'Name your account',
      profileLead: 'Rankings and your player page show these. You can change them later on your account page.',
      displayNameHint: 'Up to 32 characters, in any script.',
      handleHint: '3 to 15 letters, digits or _. Your player page lives at /players/your-handle.',
      avatarLead: 'This avatar was made for you. Upload an image to use your own.',
      saveAndNext: 'Save and continue',
      later: 'Later',
      keepTitle: 'Keep this account',
      keepLead:
        'You are playing as a guest. A guest account lives in this browser: other devices cannot sign in to it, and rankings leave it out. Keep it with a passkey, Google or Discord to play anywhere and be ranked.',
      keepPasskey: 'Keep with a passkey',
      keepWith: (label: string) => `Keep with ${label}`,
      doneTitle: "You're all set",
      doneLead: 'Where to next? Everything here can be changed later on your account page.',
      continueBack: 'Continue',
      goPlay: 'Play',
      goLeaderboard: 'Leaderboard',
      goDashboard: 'Dashboard',
    },
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
    passkeyStart: 'パスキーで始める',
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
    welcome: {
      title: 'Be-Music へようこそ',
      lead: 'アカウントができました。遊ぶ前に、いくつか決めておきましょう。どれもあとからできます。',
      steps: ['プロフィール', 'アカウントの保存', '完了'],
      stepOf: (step: number, total: number) => `${total} 段階中 ${step}`,
      profileTitle: 'アカウントの名前を決める',
      profileLead: 'ランキングやプレイヤーページに表示されます。あとからアカウントページで変えられます。',
      displayNameHint: '32 文字まで。日本語も使えます。',
      handleHint: '英数字と _ で 3〜15 文字。プレイヤーページは /players/ユーザー名 になります。',
      avatarLead: 'このアバターは自動で作りました。画像をアップロードして自分のものにもできます。',
      saveAndNext: '保存して次へ',
      later: 'あとで',
      keepTitle: 'このアカウントを保存する',
      keepLead:
        'いまはゲストとして遊んでいます。ゲストアカウントはこのブラウザだけのもので、ほかの端末からはログインできず、ランキングにも載りません。パスキー・Google・Discord のどれかで保存すると、どこからでも遊べてランキングにも載ります。',
      keepPasskey: 'パスキーで保存',
      keepWith: (label: string) => `${label} で保存`,
      doneTitle: '準備ができました',
      doneLead: 'このあとはどこへ行きますか？ここで決めたことは、あとからアカウントページで変えられます。',
      continueBack: '続ける',
      goPlay: 'プレイ',
      goLeaderboard: 'Leaderboard',
      goDashboard: 'ダッシュボード',
    },
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
  const button = (action: string, label: string, primary = false) =>
    authButtonTemplate({
      action,
      label,
      variant: primary ? undefined : 'outline',
      method:
        action === 'passkey' || action === 'add-passkey' || action === 'passkey-start'
          ? 'passkey'
          : action === 'google' || action === 'link-google'
            ? 'google'
            : action === 'discord' || action === 'link-discord'
              ? 'discord'
              : undefined,
    });
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
          ${avatarTemplate({ src: input.profile.avatarURL, size: 96, className: 'size-24', alt: t.yourAvatar })}
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
            ${serviceEntries.map(([serviceName, origin]) => html`<a class=${LINK_CLASS} href=${serviceName === 'dashboard' ? origin : new URL('/api/auth/sign-in', origin).href}>${serviceName}</a>`)}
          </nav>
        </section>`;
  return accountsDocument(input, {
    account,
    accountHref: input.signedIn ? '/account' : '/login',
    requestPath: input.login ? '/login' : '/account',
    main: html`<main class="mx-auto w-full max-w-lg px-4 pt-12 pb-12" id="main">
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
          ${!input.signedIn ? button('passkey-start', t.passkeyStart) : nothing}
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
    </main>`,
  });
}

/** What every Accounts page shares: the head, the service header and footer, and the page script. */
function accountsDocument(
  input: {
    locale?: Locale;
    requestURL?: string;
    apps?: Record<string, string>;
    showDonateLink?: boolean;
    buildInfo?: BuildInfo;
  },
  page: {
    account: Parameters<typeof serviceHeaderTemplate>[0]['account'];
    accountHref: string;
    requestPath: string;
    main: ReturnType<typeof html>;
  },
): string {
  const locale = input.locale ?? 'en';
  const t = TEXT[locale];
  const home = input.apps?.dashboard ?? '/';
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
            accountHref: page.accountHref,
            account: page.account,
            requestURL: input.requestURL ?? page.requestPath,
          })}
          ${page.main} ${footer}
          <script type="module" src="/assets/client.js"></script>
        </body>
      </html>`,
  );
}

/**
 * The welcome a new account sees after signing up (`/welcome`): name the account (display name, handle, avatar),
 * then, for a guest, keep it with a passkey, Google or Discord, then go on. Every step can be left for later; the page
 * script (`client.ts`) moves between the steps and records the welcome as done (`/api/profile/onboarded`). `next` is
 * where it goes afterwards, on this host; `continuing` means it returns to the app that asked for the sign-in.
 */
export function renderWelcomePage(input: {
  anonymous: boolean;
  name: string;
  discord: boolean;
  google: boolean;
  linkedDiscord?: boolean;
  linkedGoogle?: boolean;
  next: string;
  continuing: boolean;
  step: 'profile' | 'finish';
  notice?: string;
  locale?: Locale;
  requestURL?: string;
  profile?: { handle: string; displayName: string; avatarURL: string };
  apps?: Record<string, string>;
  showDonateLink?: boolean;
  buildInfo?: BuildInfo;
}): string {
  const locale = input.locale ?? 'en';
  const t = TEXT[locale];
  const w = t.welcome;
  // A guest gets the step that keeps the account; anyone else goes from the profile straight to the end.
  const steps = input.anonymous ? (['profile', 'keep', 'finish'] as const) : (['profile', 'finish'] as const);
  const labels = { profile: w.steps[0], keep: w.steps[1], finish: w.steps[2] } as const;
  // The placeholder names (`Anonymous`, `Player`) are left out of the field, so the player types their own.
  const placeholderName = ['Anonymous', 'Player'].includes(input.profile?.displayName ?? '');
  const button = (action: string, label: string, primary = false, method?: 'passkey' | 'google' | 'discord') =>
    authButtonTemplate({ action, label, variant: primary ? undefined : 'outline', method });
  const progress = (current: (typeof steps)[number]) => {
    const index = steps.indexOf(current as never) + 1;
    return html`<p class="text-muted-foreground text-xs" data-welcome-progress>
      ${w.stepOf(index, steps.length)} · ${labels[current]}
    </p>`;
  };
  const later = (to: string) =>
    html`<button class="btn w-full whitespace-normal" data-variant="ghost" type="button" data-welcome-go=${to}>
      ${w.later}
    </button>`;
  const afterProfile = steps[1];
  const profileStep = input.profile
    ? html`<section class="grid gap-4" data-welcome-step="profile" ?hidden=${input.step !== 'profile'}>
        ${progress('profile')}
        <h2 class="text-lg font-semibold" tabindex="-1">${w.profileTitle}</h2>
        <p class="text-muted-foreground text-sm">${w.profileLead}</p>
        <div class="flex items-center gap-4">
          ${avatarTemplate({ src: input.profile.avatarURL, size: 64, className: 'size-16', alt: t.yourAvatar })}
          <p class="text-muted-foreground text-sm">${w.avatarLead}</p>
        </div>
        <label class="grid gap-2 text-sm font-medium"
          >${t.uploadAvatar}<input class="input" type="file" id="avatar-input" accept="image/png,image/jpeg,image/webp"
        /></label>
        <form id="welcome-profile-form" class="grid gap-4" data-next=${afterProfile}>
          <label class="grid gap-2 text-sm font-medium"
            >${t.displayName}<input
              class="input"
              name="displayName"
              value=${placeholderName ? '' : input.profile.displayName}
              placeholder=${input.profile.displayName}
              maxlength="32"
              autocomplete="nickname"
            /><span class="text-muted-foreground text-xs font-normal">${w.displayNameHint}</span></label
          >
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
              aria-describedby="welcome-handle-status"
            /><span class="text-muted-foreground text-xs font-normal" id="welcome-handle-status" aria-live="polite"
              >${w.handleHint}</span
            ></label
          >
          <button class="btn w-full whitespace-normal" type="submit">${w.saveAndNext}</button>
        </form>
        ${later(afterProfile)}
      </section>`
    : nothing;
  const keepStep = input.anonymous
    ? html`<section class="grid gap-4" data-welcome-step="keep" hidden>
        ${progress('keep')}
        <h2 class="text-lg font-semibold" tabindex="-1">${w.keepTitle}</h2>
        <p class="text-muted-foreground text-sm">${w.keepLead}</p>
        ${button('add-passkey', w.keepPasskey, true, 'passkey')}
        ${input.google && input.linkedGoogle !== true ? button('link-google', w.keepWith('Google'), false, 'google') : nothing}
        ${
          input.discord && input.linkedDiscord !== true
            ? button('link-discord', w.keepWith('Discord'), false, 'discord')
            : nothing
        }
        ${later('finish')}
      </section>`
    : nothing;
  const apps = input.apps ?? {};
  const go = (href: string | undefined, label: string) =>
    href === undefined ? nothing : html`<a class="btn w-full" data-variant="outline" href=${href}>${label}</a>`;
  const finishStep = html`<section class="grid gap-4" data-welcome-step="finish" ?hidden=${input.step !== 'finish'}>
    ${progress('finish')}
    <h2 class="text-lg font-semibold" tabindex="-1">${w.doneTitle}</h2>
    <p class="text-muted-foreground text-sm">${w.doneLead}</p>
    <button class="btn w-full whitespace-normal" type="button" data-action="welcome-finish">${w.continueBack}</button>
    ${
      input.continuing
        ? nothing
        : html`<div class="grid gap-2 sm:grid-cols-3">
            ${go(apps.play === undefined ? undefined : new URL('/api/auth/sign-in', apps.play).href, w.goPlay)}
            ${go(
              apps.leaderboard === undefined ? undefined : new URL('/api/auth/sign-in', apps.leaderboard).href,
              w.goLeaderboard,
            )}
            ${go(apps.dashboard ?? '/', w.goDashboard)}
          </div>`
    }
  </section>`;
  const displayName = input.profile?.displayName || input.name || t.guest;
  return accountsDocument(input, {
    account: {
      handle: input.profile?.handle ?? '',
      displayName,
      anonymous: input.anonymous,
      avatarURL: input.profile?.avatarURL,
    },
    accountHref: '/account',
    requestPath: '/welcome',
    main: html`<main
      class="mx-auto w-full max-w-lg px-4 pt-12 pb-12"
      id="main"
      data-welcome
      data-welcome-next=${input.next}
    >
      <section class="card" data-size="sm" aria-labelledby="welcome-title">
        <header>
          <h1 class="text-2xl font-semibold tracking-tight" id="welcome-title">${w.title}</h1>
          <p class="text-muted-foreground text-sm">${w.lead}</p>
        </header>
        ${profileStep} ${keepStep} ${finishStep}
        <section>
          <be-music-status class="text-destructive min-h-6 text-sm" id="status" role="status" aria-live="polite"
            >${input.notice ?? ''}</be-music-status
          >
        </section>
      </section>
    </main>`,
  });
}
