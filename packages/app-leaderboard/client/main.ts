/**
 * The Leaderboard pages' client script, bundled by scripts/build-client.ts into src/pages/client.generated.ts. It wires
 * what needs the browser: passkey sign-in and sign-out in the header, the settings page (profile form, icon upload,
 * passkey creation), and htmx, which updates a page in place when a filter changes or an action is done
 * (src/pages/partial-swap.ts). The pages work without it, minus these actions.
 */
import { accountSignInPath } from '@be-music/service-auth-client/social-sign-in';
import htmx from 'htmx.org';
import type { CourseCardData } from '../src/pages/course-card-data.ts';
import { PARTIAL_SELECT_OOB, PARTIAL_SWAP, PARTIAL_TARGET } from '../src/pages/partial-swap.ts';
import type { ScoreCardData } from '../src/pages/score-card-data.ts';
import { drawCourseCard } from './course-card.ts';
import { clientMessages } from './messages.ts';
import { centerSquare, describeAccountError } from './profile.ts';
import { CARD_HEIGHT, CARD_WIDTH, drawScoreCard } from './score-card.ts';

const AVATAR_SIZE = 256;
/** Messages in the page's language. */
const t = clientMessages(document.documentElement.lang);
/** The server's limit for a share card (src/cards.ts). */
const CARD_UPLOAD_LIMIT = 512 * 1024;

/** Shows a message in the element `selector` names (the header status line by default), or clears it. */
function say(message: string | undefined, selector = '[data-account-status]'): void {
  const target = document.querySelector<HTMLElement>(selector);
  if (target === null) return;
  target.textContent = message ?? '';
  target.hidden = message === undefined;
}

/**
 * Loads the page in view again and updates it in place, as a filter switch does: after an action that changes what the
 * page shows (signing out, hiding a play, saving the profile). A full reload is the fallback (the htmx:error listener).
 */
async function refresh(): Promise<void> {
  await htmx.ajax('GET', location.pathname + location.search, {
    target: PARTIAL_TARGET,
    select: PARTIAL_TARGET,
    swap: PARTIAL_SWAP,
    selectOOB: PARTIAL_SELECT_OOB,
  });
}

/**
 * A partial update that fails (the network, a swap error) falls back to opening the page the plain way. A request that
 * a newer one replaced (`hx-sync`) is aborted on purpose and left alone.
 */
document.addEventListener('htmx:error', (event) => {
  const { ctx, error } = (
    event as CustomEvent<{ ctx?: { request?: { method?: string; action?: string } }; error?: unknown }>
  ).detail;
  if (error instanceof DOMException && error.name === 'AbortError') return;
  const request = ctx?.request;
  if (request?.method !== 'GET' || request.action === undefined) return;
  location.assign(request.action);
});

/** A choice in a header menu (the ruleset) closes the menu as its update starts; the morph would keep it open. */
document.addEventListener('htmx:before:request', (event) => {
  const menu = event.target instanceof Element ? event.target.closest<HTMLElement>('[popover]') : null;
  if (menu?.matches(':popover-open')) menu.hidePopover();
});

/** Answers of the account API: the body on success, a message otherwise. */
async function callAccountAPI(path: string, init: RequestInit): Promise<{ ok: true } | { ok: false; message: string }> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  if (response.ok) return { ok: true };
  const body = (await response.json().catch(() => ({}))) as { error?: string; detail?: string };
  return { ok: false, message: describeAccountError(body.error ?? `http-${response.status}`, body.detail, t) };
}

/** This page, so Accounts sends the player back here after sign-in. */
function returnHere(): string {
  return `${location.pathname}${location.search}`;
}

/** Opens one account dialog and closes any other that is already up. */
function openAccountDialog(id: string): void {
  for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) dialog.close();
  const dialog = document.getElementById(id);
  if (dialog instanceof HTMLDialogElement && !dialog.open) dialog.showModal();
}

const actions: Record<string, (button: HTMLButtonElement) => Promise<void>> = {
  async 'sign-in'() {
    location.assign(accountSignInPath(returnHere()));
  },
  async 'sign-in-google'() {
    location.assign(accountSignInPath(returnHere(), 'google'));
  },
  async 'sign-in-discord'() {
    location.assign(accountSignInPath(returnHere(), 'discord'));
  },
  async 'sign-out'() {
    await fetch('/api/auth/sign-out', { method: 'POST' });
    await refresh();
  },
  async 'open-sign-in'() {
    openAccountDialog('sign-in');
  },
  async 'open-sign-up'() {
    location.assign(accountSignInPath('/settings'));
  },
  async 'sign-up-google'() {
    location.assign(accountSignInPath('/settings', 'google'));
  },
  async 'sign-up-discord'() {
    location.assign(accountSignInPath('/settings', 'discord'));
  },
  async 'close-dialogs'() {
    for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) dialog.close();
  },
  async 'create-passkey'() {
    location.assign('/api/auth/manage');
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
    await refresh();
  },
};

/** Hides the play or the course run the button names, or shows it again, then updates its page. */
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
  await refresh();
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
    .then((result) => (result.ok ? refresh() : say(result.message, '[data-settings-status]')))
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

/** The icon picker: shrink, upload with PUT /api/v0/me/avatar, update the page. */
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
    .then((result) => (result.ok ? refresh() : say(result.message, '[data-settings-status]')))
    .catch((error: unknown) => say(error instanceof Error ? error.message : String(error), '[data-settings-status]'))
    .finally(() => {
      input.disabled = false;
      input.value = '';
    });
});

/** What a share card is of: a play, or a course run (`data-card-kind="course"`). */
type CardSource = { kind: 'score'; data: ScoreCardData } | { kind: 'course'; data: CourseCardData };

/** Draws a share card and returns it as an image, PNG unless that is too large for the upload limit. */
async function renderShareCard(card: CardSource, font: CardFont | undefined): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error(t.cannotDrawCard);
  const avatar = await loadImage(card.data.avatarUrl).catch(() => null);
  await loadCardFont(font);
  if (document.fonts !== undefined) await document.fonts.ready;
  const playedOn = new Date(card.data.playedAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  if (card.kind === 'course') drawCourseCard(context, card.data, avatar, playedOn);
  else drawScoreCard(context, card.data, avatar, playedOn);
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
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`cannot load ${src}`));
    image.src = src;
  });
}

/** Card uploads started on this page: an update in place sets up sharing again, and must not upload twice. */
const cardUploads = new Set<string>();

/** The play's or the run's own player: draw the card and upload it when there is none yet. */
async function ensureShareCard(source: HTMLScriptElement): Promise<void> {
  const upload = source.dataset.upload;
  if (upload === undefined || source.dataset.hasCard === 'true' || cardUploads.has(upload)) return;
  cardUploads.add(upload);
  try {
    await uploadShareCard(source, upload);
  } catch (error) {
    cardUploads.delete(upload);
    throw error;
  }
}

async function uploadShareCard(source: HTMLScriptElement, upload: string): Promise<void> {
  const data: unknown = JSON.parse(source.textContent ?? '{}');
  const card: CardSource =
    source.dataset.cardKind === 'course'
      ? { kind: 'course', data: data as CourseCardData }
      : { kind: 'score', data: data as ScoreCardData };
  const { fontFamily, fontUrl: fontURL } = source.dataset;
  const font = fontFamily !== undefined && fontURL !== undefined ? { family: fontFamily, url: fontURL } : undefined;
  const blob = await renderShareCard(card, font);
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

/** The share buttons, listened for on the document so they keep working when the page is updated in place. */
document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('[data-share-native]') != null) {
    const source = document.querySelector<HTMLScriptElement>('script[data-score-card]');
    void navigator
      .share({ title: document.title, text: source?.dataset.shareText, url: location.href })
      .catch(() => undefined);
  } else if (target?.closest('[data-share-copy]') != null) {
    void navigator.clipboard
      .writeText(location.href)
      .then(() => say(t.linkCopied, '[data-share-status]'))
      .catch(() => say(t.copyNotAllowed, '[data-share-status]'));
  }
});

/** Shows the system share button where there is one, and makes the card. Runs again after an update in place. */
function setUpSharing(): void {
  const source = document.querySelector<HTMLScriptElement>('script[data-score-card]');
  if (source === null) return;
  const native = document.querySelector<HTMLButtonElement>('[data-share-native]');
  if (native !== null && typeof navigator.share === 'function') native.hidden = false;
  void ensureShareCard(source).catch((error: unknown) =>
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
  document.addEventListener('htmx:after:settle', setUpSharing);
});
