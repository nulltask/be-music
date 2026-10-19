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
  const button = (action: string, label: string) => `<button type="button" data-action="${action}">${label}</button>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>be-music Accounts</title><style>:root{color-scheme:light dark}body{font:16px/1.6 system-ui;max-width:36rem;margin:4rem auto;padding:0 1rem}button,a{display:block;margin:1rem 0}button{font:inherit;padding:.6rem 1rem}#status{min-height:2rem}</style></head><body><main><h1>be-music Accounts</h1><p>${input.signedIn ? `Signed in as ${name}${input.anonymous ? ' (guest)' : ''}.` : 'Sign in to use your account across be-music services.'}</p>
${input.login && input.signedIn ? button('continue', 'Continue with this account') : ''}
${!input.signedIn || input.login ? button('passkey', 'Sign in with a passkey') + (input.discord ? button('discord', 'Sign in with Discord') : '') + (input.google ? button('google', 'Sign in with Google') : '') + (!input.signedIn ? button('guest', 'Start a guest account') : '') : ''}
${input.signedIn ? button('add-passkey', 'Add a passkey to keep this account') + button('sign-out', 'Sign out of Accounts') : ''}
<nav aria-label="Services">${Object.entries(input.apps ?? {})
    .map(
      ([name, origin]) =>
        `<a href="${new URL('/api/auth/sign-in', origin).href.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">${name.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</a>`,
    )
    .join('')}</nav>
<p id="status" role="status" aria-live="polite"></p><p>Signing out here ends the Accounts session. Existing app sessions expire within 10 minutes; each app also has its own sign-out.</p></main><script type="module" src="/assets/client.js"></script></body></html>`;
}
