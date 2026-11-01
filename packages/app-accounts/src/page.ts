import {
  renderServiceFooter,
  renderServiceHeader,
  SERVICE_CSS,
  SERVICE_FOOTER_LINK_CLASS,
  serviceSkipLink,
  type BuildInfo,
  type Locale,
} from '@be-music/service-web-theme';

const TEXT = {
  en: {
    guest: 'Guest',
    services: 'Services',
    signIn: 'Sign in',
    yourAccount: 'Your account',
    signedIn: (name: string, guest: boolean) => `Signed in as ${name}${guest ? ' (guest)' : ''}.`,
    lead: 'One account for all be-music services.',
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
    noticeLinked: 'That account is already linked to another be-music account.',
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
    lead: 'be-music の各サービスで共通のアカウントです。',
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
    noticeLinked: 'そのアカウントは別の be-music アカウントにすでに連携されています。',
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
  const name = input.name.replace(
    /[&<>"']/g,
    (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s]!,
  );
  const button = (action: string, label: string, primary = false) =>
    `<button class="btn w-full whitespace-normal" type="button" data-action="${action}"${primary ? '' : ' data-variant="outline"'}>${label}</button>`;
  const escape = (value: string) =>
    value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const home = input.apps?.dashboard ?? '/account';
  const locale = input.locale ?? 'en';
  const t = TEXT[locale];
  const providerControl = (provider: 'discord' | 'google', label: string, configured: boolean, linked: boolean) => {
    if (!configured) return '';
    if (!input.signedIn) return button(provider, t.signInWith(label));
    if (linked) return `<p class="text-muted-foreground text-sm">${t.linked(label)}</p>`;
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
      ? `<section class="grid gap-4 border-t pt-4"><h2 class="text-sm font-medium">${t.profile}</h2><form id="profile-form" class="grid gap-4"><label class="grid gap-2 text-sm font-medium">${t.handle}<input class="input" name="handle" value="${escape(input.profile.handle)}" required minlength="3" maxlength="15" pattern="[A-Za-z0-9_]{3,15}" autocomplete="username"></label><label class="grid gap-2 text-sm font-medium">${t.displayName}<input class="input" name="displayName" value="${escape(input.profile.displayName)}" required maxlength="64" autocomplete="nickname"></label><button class="btn w-full whitespace-normal" type="submit">${t.saveProfile}</button></form><h2 class="text-sm font-medium">${t.avatar}</h2><img class="size-24 rounded-lg" src="${escape(input.profile.avatarURL)}" width="96" height="96" alt="${t.yourAvatar}"><label class="grid gap-2 text-sm font-medium">${t.uploadAvatar}<input class="input" type="file" id="avatar-input" accept="image/png,image/jpeg,image/webp"></label><button class="btn w-full whitespace-normal" data-variant="outline" type="button" data-action="remove-avatar">${t.generatedAvatar}</button></section>`
      : '';
  const serviceEntries = Object.entries(input.apps ?? {}).filter(([serviceName]) => serviceName !== 'donate');
  const services =
    serviceEntries.length === 0
      ? ''
      : `<section class="grid gap-3 border-t pt-4"><h2 class="text-sm font-medium">${t.services}</h2><nav class="flex flex-wrap gap-3 text-sm" aria-label="${t.services}">${serviceEntries
          .map(
            ([serviceName, origin]) =>
              `<a class="${LINK_CLASS}" href="${new URL('/api/auth/sign-in', origin).href.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">${serviceName.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</a>`,
          )
          .join('')}</nav></section>`;
  const donate =
    input.showDonateLink && input.apps?.donate
      ? `<a class="${LINK_CLASS}" href="${new URL('/api/auth/sign-in', input.apps.donate).href.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">${t.donate}</a>`
      : '';
  const footer = renderServiceFooter({
    current: 'accounts',
    hostname: requestHostname(input.requestURL),
    navLabel: t.services,
    siteHTML: donate === '' ? undefined : donate,
    buildInfo: input.buildInfo,
  });
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Be-Music Accounts</title><style>${SERVICE_CSS}</style></head><body class="bg-background text-foreground min-h-svh antialiased">${serviceSkipLink(locale)}${renderServiceHeader(
    {
      locale,
      title: 'Be-Music Accounts',
      homeHref: home,
      playHref: input.apps?.play,
      accountHref: input.signedIn ? '/account' : '/login',
      account,
      requestURL: input.requestURL ?? (input.login ? '/login' : '/account'),
    },
  )}<main class="mx-auto w-full max-w-lg px-4 pt-12 pb-12" id="main"><section class="card" data-size="sm" aria-labelledby="account-title"><header><h1 class="text-lg font-semibold tracking-tight" id="account-title">${input.login ? t.signIn : t.yourAccount}</h1><p>${input.signedIn ? t.signedIn(name, input.anonymous) : t.lead}</p></header><section class="grid gap-3">${
    input.login && input.signedIn ? button('continue', t.continue, true) : ''
  }${
    !input.signedIn || input.login ? button('passkey', t.passkey, !input.signedIn) : ''
  }${providerControl('discord', 'Discord', input.discord, input.linkedDiscord === true)}${providerControl('google', 'Google', input.google, input.linkedGoogle === true)}${
    !input.signedIn ? button('guest', t.guestStart) : ''
  }${
    input.signedIn ? button('add-passkey', t.addPasskey, !input.login) + button('sign-out', t.signOut) : ''
  }</section>${profile}<section><p class="text-destructive min-h-6 text-sm" id="status" role="status" aria-live="polite">${escape(input.notice ?? '')}</p></section>${services}</section><p class="text-muted-foreground mt-6 text-xs">${t.footnote}</p></main>${footer}<script type="module" src="/assets/client.js"></script></body></html>`;
}
