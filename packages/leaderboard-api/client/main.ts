/**
 * The Leaderboard pages' client script, bundled by scripts/build-client.ts into src/pages/client.generated.ts. It wires
 * what needs the browser: passkey sign-in and sign-out in the header, and the settings page (profile form, icon upload,
 * passkey creation). The pages work without it, minus these actions.
 */
import { passkeyClient } from '@better-auth/passkey/client';
import { createAuthClient } from 'better-auth/client';
import { anonymousClient } from 'better-auth/client/plugins';
import type { ScoreCardData } from '../src/pages/score-card-data.ts';
import { clientMessages } from './messages.ts';
import { centerSquare, describeAccountError } from './profile.ts';
import { CARD_HEIGHT, CARD_WIDTH, drawScoreCard } from './score-card.ts';

const AVATAR_SIZE = 256;
/** Messages in the page's language. */
const t = clientMessages(document.documentElement.lang);
/** The server's limit for a share card (src/cards.ts). */
const CARD_UPLOAD_LIMIT = 512 * 1024;

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
  return error?.message ?? error?.code ?? t.somethingWentWrong;
}

/** Answers of the account API: the body on success, a message otherwise. */
async function callAccountAPI(path: string, init: RequestInit): Promise<{ ok: true } | { ok: false; message: string }> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  if (response.ok) return { ok: true };
  const body = (await response.json().catch(() => ({}))) as { error?: string; detail?: string };
  return { ok: false, message: describeAccountError(body.error ?? `http-${response.status}`, body.detail, t) };
}

const actions: Record<string, (button: HTMLButtonElement) => Promise<void>> = {
  async 'sign-in'(button) {
    const result = await auth().signIn.passkey();
    // Inside the sign-in dialog the message goes under its button; elsewhere (Settings) to the header's status line.
    const status = button.closest('dialog') !== null ? '[data-sign-in-status]' : undefined;
    if (result?.error) return say(t.signInFailed(errorText(result.error)), status);
    location.reload();
  },
  async 'sign-out'() {
    await auth().signOut();
    location.reload();
  },
  async 'open-sign-in'() {
    openDialog('#sign-in');
  },
  async 'open-sign-up'() {
    openDialog('#sign-up');
  },
  async 'close-dialogs'() {
    for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) dialog.close();
  },
  async 'create-passkey'() {
    const result = await auth().passkey.addPasskey({ name: 'be-music' });
    if (result?.error) return say(t.passkeyFailed(errorText(result.error)), '[data-settings-status]');
    location.reload();
  },
  async 'hide-score'(button) {
    await setScoreHidden(button, true);
  },
  async 'show-score'(button) {
    await setScoreHidden(button, false);
  },
  async 'remove-avatar'() {
    const result = await callAccountAPI('/api/v0/me/avatar', { method: 'DELETE' });
    if (!result.ok) return say(result.message, '[data-settings-status]');
    location.reload();
  },
};

/** Hides the play or the course run the button names, or shows it again, then reloads its page. */
async function setScoreHidden(button: HTMLButtonElement, hidden: boolean): Promise<void> {
  const { scoreId, courseScoreId } = button.dataset;
  const path =
    courseScoreId !== undefined
      ? `/api/v0/course-scores/${encodeURIComponent(courseScoreId)}`
      : scoreId !== undefined
        ? `/api/v0/scores/${encodeURIComponent(scoreId)}`
        : undefined;
  if (path === undefined) return;
  const result = await callAccountAPI(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hidden }),
  });
  if (!result.ok) return say(result.message, '[data-visibility-status]');
  location.reload();
}

/** Opens one account dialog, closing any other first (Sign in links to Sign up). */
function openDialog(selector: string): void {
  for (const open of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) open.close();
  document.querySelector<HTMLDialogElement>(selector)?.showModal();
}

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
  void callAccountAPI('/api/v0/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      handle: formText(data, 'handle'),
      displayName: formText(data, 'displayName'),
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

/**
 * Sign-up: an anonymous account first (the passkey needs a session to belong to), then the handle and name, then the
 * passkey, which claims the account. Each step can fail on its own: the message says where it stopped, and an account
 * left without a passkey can add one in Settings.
 */
document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.matches('[data-sign-up-form]')) return;
  event.preventDefault();
  const data = new FormData(form);
  const status = '[data-sign-up-status]';
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit !== null) submit.disabled = true;
  say(undefined, status);
  void (async () => {
    const session = await auth().getSession();
    if (session.data === null) {
      const anonymous = await auth().signIn.anonymous();
      if (anonymous?.error) return say(t.accountStartFailed(errorText(anonymous.error)), status);
    }
    const saved = await callAccountAPI('/api/v0/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        handle: formText(data, 'handle'),
        displayName: formText(data, 'displayName'),
      }),
    });
    if (!saved.ok) return say(saved.message, status);
    const passkey = await auth().passkey.addPasskey({ name: 'be-music' });
    if (passkey?.error) {
      return say(t.passkeyNotMade(errorText(passkey.error)), status);
    }
    location.reload();
  })()
    .catch((error: unknown) => say(error instanceof Error ? error.message : String(error), status))
    .finally(() => {
      if (submit !== null) submit.disabled = false;
    });
});

/** A form field's text, or empty. */
function formText(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
}

/** Shrinks an image to the icon size: the centred square, as WebP (JPEG where the browser cannot write WebP). */
async function toAvatar(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const crop = centerSquare(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error(t.cannotDrawImage);
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, crop.x, crop.y, crop.size, crop.size, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close();
  const encode = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  const webp = await encode('image/webp', 0.9);
  if (webp !== null && webp.type === 'image/webp') return webp;
  const jpeg = await encode('image/jpeg', 0.88);
  if (jpeg === null) throw new Error(t.cannotEncodeImage);
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
      callAccountAPI('/api/v0/me/avatar', { method: 'PUT', headers: { 'content-type': blob.type }, body: blob }),
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

/** Draws the play's share card and returns it as an image, PNG unless that is too large for the upload limit. */
async function renderScoreCard(data: ScoreCardData, font: CardFont | undefined): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error(t.cannotDrawCard);
  const avatar = await loadImage(data.avatarUrl).catch(() => null);
  await loadCardFont(font);
  if (document.fonts !== undefined) await document.fonts.ready;
  const playedOn = new Date(data.playedAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  drawScoreCard(context, data, avatar, playedOn);
  const encode = (type: string, quality?: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  const png = await encode('image/png');
  if (png !== null && png.size <= CARD_UPLOAD_LIMIT) return png;
  // WebP keeps the text sharper than JPEG at the same size; browsers that cannot write it hand back PNG.
  const webp = await encode('image/webp', 0.92);
  if (webp !== null && webp.type === 'image/webp' && webp.size <= CARD_UPLOAD_LIMIT) return webp;
  const jpeg = await encode('image/jpeg', 0.9);
  if (jpeg === null) throw new Error(t.cannotEncodeCard);
  return jpeg;
}

interface CardFont {
  family: string;
  url: string;
}

/** Loads the card's Latin typeface; without it (or where it fails to load), the card falls back to system fonts. */
async function loadCardFont(font: CardFont | undefined): Promise<void> {
  if (font === undefined || typeof FontFace !== 'function' || document.fonts === undefined) return;
  const face = new FontFace(font.family, `url(${JSON.stringify(font.url)}) format("woff2")`, { weight: '100 900' });
  const loaded = await face.load().catch(() => null);
  if (loaded !== null) document.fonts.add(loaded);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`cannot load ${src}`));
    image.src = src;
  });
}

/** The play's own player: draw the card and upload it when the play has none yet. */
async function ensureScoreCard(source: HTMLScriptElement): Promise<void> {
  const upload = source.dataset.upload;
  if (upload === undefined || source.dataset.hasCard === 'true') return;
  const data = JSON.parse(source.textContent ?? '{}') as ScoreCardData;
  const { fontFamily, fontUrl: fontURL } = source.dataset;
  const font = fontFamily !== undefined && fontURL !== undefined ? { family: fontFamily, url: fontURL } : undefined;
  const blob = await renderScoreCard(data, font);
  const response = await fetch(upload, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': blob.type },
    body: blob,
  });
  if (!response.ok) throw new Error(`the card upload answered ${response.status}`);
  const { cardUrl: cardURL } = (await response.json()) as { cardUrl: string };
  source.dataset.hasCard = 'true';
  const preview = document.querySelector<HTMLImageElement>('[data-card-preview]');
  if (preview !== null) preview.src = cardURL;
  say(t.cardReady, '[data-share-status]');
}

function setUpSharing(): void {
  const source = document.querySelector<HTMLScriptElement>('script[data-score-card]');
  if (source === null) return;
  const native = document.querySelector<HTMLButtonElement>('[data-share-native]');
  if (native !== null && typeof navigator.share === 'function') native.hidden = false;
  native?.addEventListener('click', () => {
    void navigator
      .share({ title: document.title, text: source.dataset.shareText, url: location.href })
      .catch(() => undefined);
  });
  document.querySelector('[data-share-copy]')?.addEventListener('click', () => {
    void navigator.clipboard
      .writeText(location.href)
      .then(() => say(t.linkCopied, '[data-share-status]'))
      .catch(() => say(t.copyNotAllowed, '[data-share-status]'));
  });
  void ensureScoreCard(source).catch((error: unknown) =>
    say(t.cardFailed(error instanceof Error ? error.message : String(error)), '[data-share-status]'),
  );
}

/**
 * Runs `start` once the page is the one being shown. A page prerendered from a hovered link (src/pages/speculation.ts)
 * runs this script before the viewer opens it, and may never be opened; setting up sharing uploads the play's card, so
 * it waits for the page to be activated.
 */
function whenShown(start: () => void): void {
  if ((document as Document & { prerendering?: boolean }).prerendering === true) {
    document.addEventListener('prerenderingchange', start, { once: true });
  } else start();
}

whenShown(() => {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setUpSharing);
  else setUpSharing();
});
