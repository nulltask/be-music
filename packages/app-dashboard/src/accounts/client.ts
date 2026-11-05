import { defineServiceUI, type BeMusicStatusElement } from '@be-music/service-web-theme/client';
import { clientMessages, describeClientError } from './client-messages.ts';
import { createAuthClient } from 'better-auth/client';
import { anonymousClient } from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';
import { oauthProviderClient } from '@better-auth/oauth-provider/client';
import { socialSignInToStart } from '@be-music/service-auth-client/social-sign-in';
// Handle redirects once here: a duplicate navigation can consume a single-use authorization code twice.
const auth = createAuthClient({
  disableDefaultFetchPlugins: true,
  plugins: [anonymousClient(), passkeyClient(), oauthProviderClient()],
});
const query = location.pathname === '/login' ? location.search.slice(1) : '';
defineServiceUI();
const status = document.querySelector<BeMusicStatusElement>('#status')!;
const messages = clientMessages(document.documentElement.lang);

const welcome = document.querySelector<HTMLElement>('[data-welcome]');
/** The app's sign-in request the welcome returns to (`oauth_query`), kept from the sign-in page through the welcome. */
const welcomeQuery = welcome === null ? '' : (new URLSearchParams(location.search).get('oauth_query') ?? '');

/** Goes back to the app that asked for the sign-in (`oauthQuery`), or to `fallback` on this host. */
async function continueSignIn(oauthQuery: string, fallback: string): Promise<void> {
  if (!oauthQuery) {
    location.assign(fallback);
    return;
  }
  const continued = await auth.$fetch<{ url?: string }>('/oauth2/continue', {
    method: 'POST',
    body: { selected: true, oauth_query: oauthQuery },
  });
  if (continued.data?.url) {
    location.assign(continued.data.url);
    return;
  }
  status.message = continued.error?.message ?? messages.continueFailed;
}

/** Whether the signed-in account has yet to see the welcome after signing up. */
async function needsWelcome(): Promise<boolean> {
  const response = await fetch('/api/profile');
  if (!response.ok) return false;
  return ((await response.json()) as { onboarded?: boolean }).onboarded === false;
}

async function done(result: unknown): Promise<void> {
  const value = result as { error?: { message?: string }; data?: { url?: string; redirect?: boolean } } | undefined;
  if (value?.error) {
    status.message = value.error.message ?? messages.requestFailed;
    return;
  }
  if (value?.data?.url) {
    location.assign(value.data.url);
    return;
  }
  // On the welcome, keeping the account goes on to its last step.
  if (welcome !== null) {
    showWelcomeStep('finish');
    return;
  }
  // A new account is welcomed first, before going back to the app (docs/services.md, "Welcome after sign-up").
  if (await needsWelcome()) {
    const params = new URLSearchParams(query ? { oauth_query: query } : { next: '/account' });
    location.assign(`/welcome?${params}`);
    return;
  }
  await continueSignIn(query, '/account');
}

/** Shows one step of the welcome; the last one records the welcome as done. */
function showWelcomeStep(step: string): void {
  for (const section of document.querySelectorAll<HTMLElement>('[data-welcome-step]')) {
    section.hidden = section.dataset.welcomeStep !== step;
  }
  document.querySelector<HTMLElement>(`[data-welcome-step="${step}"] h2`)?.focus();
  if (step === 'finish') void fetch('/api/profile/onboarded', { method: 'POST' });
}
document.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action], button[data-auth-action]');
  if (!button) return;
  const action = button.dataset.authAction ?? button.dataset.action;
  button.disabled = true;
  status.message = '';
  void (async () => {
    switch (action) {
      case 'remove-avatar':
        return saveProfile('/api/profile/avatar', { method: 'DELETE' });
      case 'guest':
        return done(await auth.signIn.anonymous());
      case 'passkey':
        return done(await auth.signIn.passkey());
      case 'passkey-start': {
        // A new account with a passkey: a guest account, kept at once by the passkey made for it.
        const started = (await auth.signIn.anonymous()) as { error?: { message?: string } } | undefined;
        if (started?.error) return done(started);
        await auth.passkey.addPasskey({ name: 'Be-Music' });
        return done(undefined);
      }
      case 'welcome-finish': {
        await fetch('/api/profile/onboarded', { method: 'POST' });
        return continueSignIn(welcomeQuery, welcome?.dataset.welcomeNext ?? '/account');
      }
      case 'discord':
      case 'google':
        return done(await auth.signIn.social({ provider: action, callbackURL: '/account' }));
      case 'link-discord':
      case 'link-google': {
        // From the welcome, linking comes back to its last step, keeping where the welcome goes next.
        const back = welcome === null ? '/account' : welcomeReturnURL('finish');
        return done(
          await auth.linkSocial({
            provider: action === 'link-discord' ? 'discord' : 'google',
            callbackURL: back,
            errorCallbackURL: welcome === null ? '/account' : welcomeReturnURL('keep'),
          }),
        );
      }
      case 'continue':
        return done(
          await auth.$fetch('/oauth2/continue', { method: 'POST', body: { selected: true, oauth_query: query } }),
        );
      case 'add-passkey':
        return done(await auth.passkey.addPasskey({ name: 'Be-Music' }));
      case 'sign-out':
        await auth.signOut();
        location.assign('/login');
    }
  })()
    .catch(() => {
      status.message = messages.tryAgain;
    })
    .finally(() => {
      button.disabled = false;
    });
});

document.documentElement.dataset.authReady = 'true';

/** Starts Google or Discord when this login was opened from that button on another service. */
function startRequestedProvider(): void {
  const requested = new URLSearchParams(location.search).get('sign_in_method');
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-auth-action]')).find(
    (candidate) => candidate.dataset.authAction === requested,
  );
  const method = socialSignInToStart({
    pathname: location.pathname,
    search: location.search,
    providerConfigured: button !== undefined,
    alreadyContinuing: document.querySelector('[data-auth-action="continue"]') !== null,
  });
  if (method === undefined) return;
  const guard = `be-music.sign-in.${method}`;
  try {
    if (sessionStorage.getItem(guard) === location.search) return;
    sessionStorage.setItem(guard, location.search);
  } catch {
    // Private mode can reject storage. One attempt is still made.
  }
  button?.click();
}
startRequestedProvider();

async function saveProfile(path: string, init: RequestInit): Promise<void> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = (await response.json()) as { error?: string };
    throw new Error(describeClientError(body.error, messages.profileFailed, messages));
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
      status.message = error.message;
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
      if (!context) throw new Error(messages.cannotPrepare);
      const size = Math.min(image.width, image.height);
      context.drawImage(image, (image.width - size) / 2, (image.height - size) / 2, size, size, 0, 0, 256, 256);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
      if (!blob) throw new Error(messages.cannotEncode);
      await saveProfile('/api/profile/avatar', { method: 'PUT', body: blob });
    } finally {
      image.close();
    }
  })()
    .catch((error: Error) => {
      status.message = error.message;
    })
    .finally(() => {
      input.disabled = false;
    });
});

/** This welcome's URL at `step`, keeping where it goes next and the app's sign-in request. */
function welcomeReturnURL(step: 'keep' | 'finish'): string {
  const params = new URLSearchParams(location.search);
  params.set('step', step);
  return `/welcome?${params}`;
}

// The welcome: the steps move forward without reloading, and its handle is checked as it is typed.
if (welcome !== null) {
  const initial = new URLSearchParams(location.search).get('step');
  if (initial === 'finish' || initial === 'keep') showWelcomeStep(initial);
  document.addEventListener('click', (event) => {
    const target = (event.target as Element).closest<HTMLButtonElement>('button[data-welcome-go]');
    if (target) showWelcomeStep(target.dataset.welcomeGo ?? 'finish');
  });
  const form = document.querySelector<HTMLFormElement>('#welcome-profile-form');
  const handle = form?.querySelector<HTMLInputElement>('input[name="handle"]');
  const handleStatus = document.querySelector<HTMLElement>('#welcome-handle-status');
  const original = handle?.value ?? '';
  let checking: ReturnType<typeof setTimeout> | undefined;
  handle?.addEventListener('input', () => {
    clearTimeout(checking);
    if (!handleStatus) return;
    const value = handle.value;
    if (value === original) {
      handleStatus.textContent = messages.welcome.handleHint;
      return;
    }
    handleStatus.textContent = messages.welcome.handleChecking;
    checking = setTimeout(() => {
      void fetch(`/api/profile/handle?${new URLSearchParams({ value })}`)
        .then((response) => response.json() as Promise<{ ok: boolean; reason?: 'format' | 'reserved' | 'taken' }>)
        .then((result) => {
          if (handle.value !== value) return;
          handleStatus.textContent = result.ok
            ? messages.welcome.handleFree
            : messages.welcome.handle[result.reason ?? 'format'];
        })
        .catch(() => {
          handleStatus.textContent = messages.welcome.handleHint;
        });
    }, 300);
  });
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    button.disabled = true;
    const entered = data.get('displayName');
    const displayName = typeof entered === 'string' ? entered.trim() : '';
    void fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: data.get('handle'), ...(displayName ? { displayName } : {}) }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json()) as { error?: string };
          throw new Error(describeClientError(body.error, messages.profileFailed, messages));
        }
        status.message = '';
        showWelcomeStep(form.dataset.next ?? 'finish');
      })
      .catch((error: Error) => {
        status.message = error.message;
      })
      .finally(() => {
        button.disabled = false;
      });
  });
}
