/**
 * The Leaderboard pages' client script, bundled by scripts/build-client.ts into src/pages/client.generated.ts. It wires
 * what needs the browser: passkey sign-in and sign-out in the header, and the settings page (profile form, icon upload,
 * passkey creation). The pages work without it, minus these actions.
 */
import { passkeyClient } from '@better-auth/passkey/client';
import { createAuthClient } from 'better-auth/client';
import { anonymousClient } from 'better-auth/client/plugins';
import { centerSquare, describeAccountError } from './profile.ts';

const AVATAR_SIZE = 256;

let client: ReturnType<typeof createClient> | undefined;
function createClient() {
  return createAuthClient({ plugins: [anonymousClient(), passkeyClient()] });
}
/** Better Auth on this origin (`/api/auth`), created on first use. */
function auth() {
  client ??= createClient();
  return client;
}

/** Shows a message in the element `selector` names (the header status line by default), or clears it. */
function say(message: string | undefined, selector = '[data-account-status]'): void {
  const target = document.querySelector<HTMLElement>(selector);
  if (target === null) return;
  target.textContent = message ?? '';
  target.hidden = message === undefined;
}

function errorText(error: { message?: string; code?: string } | null | undefined): string {
  return error?.message ?? error?.code ?? 'Something went wrong.';
}

/** Answers of the account API: the body on success, a message otherwise. */
async function callAccountApi(path: string, init: RequestInit): Promise<{ ok: true } | { ok: false; message: string }> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  if (response.ok) return { ok: true };
  const body = (await response.json().catch(() => ({}))) as { error?: string; detail?: string };
  return { ok: false, message: describeAccountError(body.error ?? `http-${response.status}`, body.detail) };
}

const actions: Record<string, (button: HTMLButtonElement) => Promise<void>> = {
  async 'sign-in'() {
    const result = await auth().signIn.passkey();
    if (result?.error) return say(`Sign-in failed: ${errorText(result.error)}`);
    location.reload();
  },
  async 'sign-out'() {
    await auth().signOut();
    location.reload();
  },
  async 'create-passkey'() {
    const result = await auth().passkey.addPasskey({ name: 'be-music' });
    if (result?.error) return say(`Creating the passkey failed: ${errorText(result.error)}`, '[data-settings-status]');
    location.reload();
  },
  async 'remove-avatar'() {
    const result = await callAccountApi('/api/v0/me/avatar', { method: 'DELETE' });
    if (!result.ok) return say(result.message, '[data-settings-status]');
    location.reload();
  },
};

document.addEventListener('click', (event) => {
  const button =
    event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-account-action]') : null;
  const action = button?.dataset.accountAction;
  if (button === null || button === undefined || action === undefined || actions[action] === undefined) return;
  event.preventDefault();
  say(undefined);
  button.disabled = true;
  actions[action](button)
    .catch((error: unknown) => say(error instanceof Error ? error.message : String(error)))
    .finally(() => {
      button.disabled = false;
    });
});

/** The profile form: handle and display name, saved with PATCH /api/v0/me. */
document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.matches('[data-profile-form]')) return;
  event.preventDefault();
  const data = new FormData(form);
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit !== null) submit.disabled = true;
  say(undefined, '[data-settings-status]');
  void callAccountApi('/api/v0/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      handle: String(data.get('handle') ?? ''),
      displayName: String(data.get('displayName') ?? ''),
    }),
  })
    .then((result) => {
      if (result.ok) location.reload();
      else say(result.message, '[data-settings-status]');
    })
    .finally(() => {
      if (submit !== null) submit.disabled = false;
    });
});

/** Shrinks an image to the icon size: the centred square, as WebP (JPEG where the browser cannot write WebP). */
async function toAvatar(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const crop = centerSquare(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('This browser cannot draw the image.');
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, crop.x, crop.y, crop.size, crop.size, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close();
  const encode = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  const webp = await encode('image/webp', 0.9);
  if (webp !== null && webp.type === 'image/webp') return webp;
  const jpeg = await encode('image/jpeg', 0.88);
  if (jpeg === null) throw new Error('This browser cannot encode the image.');
  return jpeg;
}

/** The icon picker: shrink, upload with PUT /api/v0/me/avatar, reload. */
document.addEventListener('change', (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.matches('[data-avatar-input]')) return;
  const file = input.files?.[0];
  if (file === undefined) return;
  say(undefined, '[data-settings-status]');
  input.disabled = true;
  void toAvatar(file)
    .then((blob) =>
      callAccountApi('/api/v0/me/avatar', { method: 'PUT', headers: { 'content-type': blob.type }, body: blob }),
    )
    .then((result) => {
      if (result.ok) location.reload();
      else say(result.message, '[data-settings-status]');
    })
    .catch((error: unknown) => say(error instanceof Error ? error.message : String(error), '[data-settings-status]'))
    .finally(() => {
      input.disabled = false;
      input.value = '';
    });
});
