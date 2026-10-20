import { SERVICE_CSS } from '@be-music/web-theme';

export function renderAccountPage(input: {
  signedIn: boolean;
  anonymous: boolean;
  name: string;
  login: boolean;
  discord: boolean;
  google: boolean;
  apps?: Record<string, string>;
}): string {
  const name = input.name.replace(
    /[&<>"']/g,
    (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s]!,
  );
  const button = (action: string, label: string, primary = false) =>
    `<button class="button${primary ? '' : ' secondary'}" type="button" data-action="${action}">${label}</button>`;
  const home = input.apps?.dashboard ?? '/account';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>be-music Accounts</title><style>${SERVICE_CSS}
.account-main{max-width:32rem;padding-top:48px}.account-actions{margin-top:24px}.account-actions .button{width:100%}.account-services{margin-top:24px;padding-top:20px;border-top:1px solid var(--line)}.account-services nav{display:flex;gap:12px;flex-wrap:wrap;font-size:.875rem}.account-services h2{font-size:.875rem;margin-bottom:12px}#status{min-height:1.5rem;margin:16px 0 0;color:var(--danger);font-size:.875rem}.session-note{font-size:.75rem;margin:24px 0 0}
</style></head><body><a class="skip-link" href="#main">Skip to content</a><header class="site-header"><div class="header-inner"><a class="brand" href="${home.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">be-music <span>Accounts</span></a></div></header><main class="site-main account-main" id="main"><section class="panel" aria-labelledby="account-title"><h1 id="account-title">${input.login ? 'Sign in' : 'Your account'}</h1><p class="muted">${input.signedIn ? `Signed in as ${name}${input.anonymous ? ' (guest)' : ''}.` : 'One account for all be-music services.'}</p><div class="stack account-actions">
${input.login && input.signedIn ? button('continue', 'Continue with this account', true) : ''}
${!input.signedIn || input.login ? button('passkey', 'Sign in with a passkey', !input.signedIn) + (input.discord ? button('discord', 'Sign in with Discord') : '') + (input.google ? button('google', 'Sign in with Google') : '') + (!input.signedIn ? button('guest', 'Start a guest account') : '') : ''}
${input.signedIn ? button('add-passkey', 'Add a passkey to keep this account', !input.login) + button('sign-out', 'Sign out of Accounts') : ''}
</div><p id="status" role="status" aria-live="polite"></p>
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
</section><p class="muted session-note">Signing out here ends the Accounts session. Existing app sessions expire within 10 minutes; each app also has its own sign-out.</p></main>${input.apps?.donate ? `<footer class="site-footer"><a href="${new URL('/api/auth/sign-in', input.apps.donate).href.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">Donate</a></footer>` : ''}<script type="module" src="/assets/client.js"></script></body></html>`;
}
