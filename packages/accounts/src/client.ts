import { createAuthClient } from 'better-auth/client';
import { anonymousClient } from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';
import { oauthProviderClient } from '@better-auth/oauth-provider/client';
// Handle redirects once here: a duplicate navigation can consume a single-use authorization code twice.
const auth = createAuthClient({
  disableDefaultFetchPlugins: true,
  plugins: [anonymousClient(), passkeyClient(), oauthProviderClient()],
});
const query = location.pathname === '/login' ? location.search.slice(1) : '';
const status = document.querySelector<HTMLElement>('#status')!;

async function done(result: unknown): Promise<void> {
  const value = result as { error?: { message?: string }; data?: { url?: string; redirect?: boolean } } | undefined;
  if (value?.error) {
    status.textContent = value.error.message ?? 'Request failed';
    return;
  }
  if (value?.data?.url) {
    location.assign(value.data.url);
    return;
  }
  if (query) {
    const continued = await auth.$fetch<{ url?: string }>('/oauth2/continue', {
      method: 'POST',
      body: { selected: true, oauth_query: query },
    });
    if (continued.data?.url) {
      location.assign(continued.data.url);
      return;
    }
    status.textContent =
      continued.error?.message ?? 'Sign-in could not be continued. Return to the app and start again.';
  } else location.assign('/account');
}
document.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
  if (!button) return;
  button.disabled = true;
  status.textContent = '';
  void (async () => {
    switch (button.dataset.action) {
      case 'guest':
        return done(await auth.signIn.anonymous());
      case 'passkey':
        return done(await auth.signIn.passkey());
      case 'discord':
      case 'google':
        return done(await auth.signIn.social({ provider: button.dataset.action, callbackURL: '/account' }));
      case 'continue':
        return done(
          await auth.$fetch('/oauth2/continue', { method: 'POST', body: { selected: true, oauth_query: query } }),
        );
      case 'add-passkey':
        return done(await auth.passkey.addPasskey({ name: 'be-music' }));
      case 'sign-out':
        await auth.signOut();
        location.assign('/login');
    }
  })()
    .catch(() => {
      status.textContent = 'Request failed. Please try again.';
    })
    .finally(() => {
      button.disabled = false;
    });
});

document.documentElement.dataset.authReady = 'true';
