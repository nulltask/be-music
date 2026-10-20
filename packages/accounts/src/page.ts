import { SERVICE_CSS, renderBuildInfo, type BuildInfo } from '@be-music/web-theme';

export function renderAccountPage(input: {
  signedIn: boolean;
  anonymous: boolean;
  name: string;
  login: boolean;
  discord: boolean;
  google: boolean;
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
    `<button class="button${primary ? '' : ' secondary'}" type="button" data-action="${action}">${label}</button>`;
  const escape = (value: string) =>
    value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const home = input.apps?.dashboard ?? '/account';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>be-music Accounts</title><style>${SERVICE_CSS}
.account-main{max-width:32rem;padding-top:48px}.account-actions{margin-top:24px}.account-actions .button{width:100%}.account-services{margin-top:24px;padding-top:20px;border-top:1px solid var(--line)}.account-services nav{display:flex;gap:12px;flex-wrap:wrap;font-size:.875rem}.account-services h2{font-size:.875rem;margin-bottom:12px}#status{min-height:1.5rem;margin:16px 0 0;color:var(--danger);font-size:.875rem}.account-services input{display:block;width:100%;margin:6px 0 16px;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit}.account-services form{margin-bottom:24px}.account-services img{display:block;border-radius:8px;margin-bottom:16px}.session-note{font-size:.75rem;margin:24px 0 0}
</style></head><body><a class="skip-link" href="#main">Skip to content</a><header class="site-header"><div class="header-inner"><a class="brand" href="${home.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">be-music <span>Accounts</span></a></div></header><main class="site-main account-main" id="main"><section class="panel" aria-labelledby="account-title"><h1 id="account-title">${input.login ? 'Sign in' : 'Your account'}</h1><p class="muted">${input.signedIn ? `Signed in as ${name}${input.anonymous ? ' (guest)' : ''}.` : 'One account for all be-music services.'}</p><div class="stack account-actions">
${input.login && input.signedIn ? button('continue', 'Continue with this account', true) : ''}
${!input.signedIn || input.login ? button('passkey', 'Sign in with a passkey', !input.signedIn) + (input.discord ? button('discord', 'Sign in with Discord') : '') + (input.google ? button('google', 'Sign in with Google') : '') + (!input.signedIn ? button('guest', 'Start a guest account') : '') : ''}
${input.signedIn ? button('add-passkey', 'Add a passkey to keep this account', !input.login) + button('sign-out', 'Sign out of Accounts') : ''}
</div>${input.signedIn && !input.login && input.profile ? `<section class="account-services"><h2>Profile</h2><form id="profile-form" class="stack"><label>Handle<input name="handle" value="${escape(input.profile.handle)}" required minlength="3" maxlength="15" pattern="[A-Za-z0-9_]{3,15}" autocomplete="username"></label><label>Display name<input name="displayName" value="${escape(input.profile.displayName)}" required maxlength="64" autocomplete="nickname"></label><button class="button" type="submit">Save profile</button></form><h2>Avatar</h2><img src="${escape(input.profile.avatarURL)}" width="96" height="96" alt="Your avatar"><label>Upload avatar<input type="file" id="avatar-input" accept="image/png,image/jpeg,image/webp"></label><button class="button secondary" type="button" data-action="remove-avatar">Use generated avatar</button></section>` : ''}<p id="status" role="status" aria-live="polite"></p>
${
  Object.keys(input.apps ?? {}).some((name) => name !== 'donate')
    ? `<div class="account-services"><h2>Services</h2><nav aria-label="Services">${Object.entries(input.apps ?? {})
        .filter(([name]) => name !== 'donate')
        .map(
          ([name, origin]) =>
            `<a href="${new URL('/api/auth/sign-in', origin).href.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">${name.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</a>`,
        )
        .join('')}</nav></div>`
    : ''
}
</section><p class="muted session-note">Signing out here ends the Accounts session. Existing app sessions expire within 10 minutes; each app also has its own sign-out.</p></main><footer class="site-footer">${input.showDonateLink && input.apps?.donate ? `<a href="${new URL('/api/auth/sign-in', input.apps.donate).href.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">Donate</a>` : ''}${input.buildInfo && input.showDonateLink && input.apps?.donate ? ' · ' : ''}${renderBuildInfo(input.buildInfo)}</footer><script type="module" src="/assets/client.js"></script></body></html>`;
}
