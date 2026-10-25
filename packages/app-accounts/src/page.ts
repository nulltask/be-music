import {
  renderBuildInfo,
  renderServiceHeader,
  SERVICE_CSS,
  serviceSkipLink,
  type BuildInfo,
  type Locale,
} from '@be-music/service-web-theme';

export function accountNotice(code: string | null): string {
  if (code === 'account_already_linked_to_different_user')
    return 'That account is already linked to another be-music account.';
  if (code === 'access_denied') return 'Linking was cancelled.';
  if (code) return 'Could not link that account.';
  return '';
}

const FOOTER_CLASS = 'text-muted-foreground mx-auto max-w-5xl border-t px-4 py-4 text-xs';
const LINK_CLASS = 'underline underline-offset-4 hover:text-foreground';

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
  const providerControl = (provider: 'discord' | 'google', label: string, configured: boolean, linked: boolean) => {
    if (!configured) return '';
    if (!input.signedIn) return button(provider, `Sign in with ${label}`);
    if (linked) return `<p class="text-muted-foreground text-sm">${label} is linked.</p>`;
    return button(`link-${provider}`, `Link ${label}`);
  };
  const locale = input.locale ?? 'en';
  const account = input.signedIn
    ? {
        handle: input.profile?.handle ?? '',
        displayName: input.profile?.displayName || input.name || (locale === 'ja' ? 'ゲスト' : 'Guest'),
        anonymous: input.anonymous,
        avatarURL: input.profile?.avatarURL,
      }
    : undefined;
  const profile =
    input.signedIn && !input.login && input.profile
      ? `<section class="grid gap-4 border-t pt-4"><h2 class="text-sm font-medium">Profile</h2><form id="profile-form" class="grid gap-4"><label class="grid gap-2 text-sm font-medium">Handle<input class="input" name="handle" value="${escape(input.profile.handle)}" required minlength="3" maxlength="15" pattern="[A-Za-z0-9_]{3,15}" autocomplete="username"></label><label class="grid gap-2 text-sm font-medium">Display name<input class="input" name="displayName" value="${escape(input.profile.displayName)}" required maxlength="64" autocomplete="nickname"></label><button class="btn w-full whitespace-normal" type="submit">Save profile</button></form><h2 class="text-sm font-medium">Avatar</h2><img class="size-24 rounded-lg" src="${escape(input.profile.avatarURL)}" width="96" height="96" alt="Your avatar"><label class="grid gap-2 text-sm font-medium">Upload avatar<input class="input" type="file" id="avatar-input" accept="image/png,image/jpeg,image/webp"></label><button class="btn w-full whitespace-normal" data-variant="outline" type="button" data-action="remove-avatar">Use generated avatar</button></section>`
      : '';
  const serviceEntries = Object.entries(input.apps ?? {}).filter(([serviceName]) => serviceName !== 'donate');
  const services =
    serviceEntries.length === 0
      ? ''
      : `<section class="grid gap-3 border-t pt-4"><h2 class="text-sm font-medium">Services</h2><nav class="flex flex-wrap gap-3 text-sm" aria-label="Services">${serviceEntries
          .map(
            ([serviceName, origin]) =>
              `<a class="${LINK_CLASS}" href="${new URL('/api/auth/sign-in', origin).href.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">${serviceName.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</a>`,
          )
          .join('')}</nav></section>`;
  const donate =
    input.showDonateLink && input.apps?.donate
      ? `<a class="${LINK_CLASS}" href="${new URL('/api/auth/sign-in', input.apps.donate).href.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">Donate</a>`
      : '';
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
  )}<main class="mx-auto w-full max-w-lg px-4 pt-12 pb-12" id="main"><section class="card" data-size="sm" aria-labelledby="account-title"><header><h1 class="text-lg font-semibold tracking-tight" id="account-title">${input.login ? 'Sign in' : 'Your account'}</h1><p>${input.signedIn ? `Signed in as ${name}${input.anonymous ? ' (guest)' : ''}.` : 'One account for all be-music services.'}</p></header><section class="grid gap-3">${
    input.login && input.signedIn ? button('continue', 'Continue with this account', true) : ''
  }${
    !input.signedIn || input.login ? button('passkey', 'Sign in with a passkey', !input.signedIn) : ''
  }${providerControl('discord', 'Discord', input.discord, input.linkedDiscord === true)}${providerControl('google', 'Google', input.google, input.linkedGoogle === true)}${
    !input.signedIn ? button('guest', 'Start a guest account') : ''
  }${
    input.signedIn
      ? button('add-passkey', 'Add a passkey to keep this account', !input.login) +
        button('sign-out', 'Sign out of Accounts')
      : ''
  }</section>${profile}<section><p class="text-destructive min-h-6 text-sm" id="status" role="status" aria-live="polite">${escape(input.notice ?? '')}</p></section>${services}</section><p class="text-muted-foreground mt-6 text-xs">Signing out here ends the Accounts session. Existing app sessions expire within 10 minutes; each app also has its own sign-out.</p></main><footer class="${FOOTER_CLASS}">${donate}${input.buildInfo && donate ? ' · ' : ''}${renderBuildInfo(input.buildInfo)}</footer><script type="module" src="/assets/client.js"></script></body></html>`;
}
