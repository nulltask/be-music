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
      case 'remove-avatar':
        return saveProfile('/api/profile/avatar', { method: 'DELETE' });
      case 'guest':
        return done(await auth.signIn.anonymous());
      case 'passkey':
        return done(await auth.signIn.passkey());
      case 'discord':
      case 'google':
        return done(await auth.signIn.social({ provider: button.dataset.action, callbackURL: '/account' }));
      case 'link-discord':
      case 'link-google':
        return done(
          await auth.linkSocial({
            provider: button.dataset.action === 'link-discord' ? 'discord' : 'google',
            callbackURL: '/account',
            errorCallbackURL: '/account',
          }),
        );
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

async function saveProfile(path: string, init: RequestInit): Promise<void> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = (await response.json()) as { error?: string };
    throw new Error(body.error ?? 'Profile update failed');
  }
  location.reload();
}
document.querySelector<HTMLFormElement>('#profile-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const button = form.querySelector<HTMLButtonElement>('button')!;
  button.disabled = true;
  void saveProfile('/api/profile', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle: data.get('handle'), displayName: data.get('displayName') }),
  })
    .catch((error: Error) => {
      status.textContent = error.message;
    })
    .finally(() => {
      button.disabled = false;
    });
});
document.querySelector<HTMLInputElement>('#avatar-input')?.addEventListener('change', (event) => {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  input.disabled = true;
  void (async () => {
    const image = await createImageBitmap(file);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Cannot prepare image');
      const size = Math.min(image.width, image.height);
      context.drawImage(image, (image.width - size) / 2, (image.height - size) / 2, size, size, 0, 0, 256, 256);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
      if (!blob) throw new Error('Cannot encode image');
      await saveProfile('/api/profile/avatar', { method: 'PUT', body: blob });
    } finally {
      image.close();
    }
  })()
    .catch((error: Error) => {
      status.textContent = error.message;
    })
    .finally(() => {
      input.disabled = false;
    });
});
