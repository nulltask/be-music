import { afterEach, beforeAll, expect, test, vi } from 'vite-plus/test';
import type { BeMusicStatusElement } from '@be-music/service-web-theme/client';

// The DOM action and API request are real; only the page-refresh transport is replaced.
const refresh = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('htmx.org', () => ({ default: { ajax: refresh } }));

beforeAll(async () => {
  document.documentElement.lang = 'en';
  await import('./main.ts');
});

afterEach(() => {
  document.body.replaceChildren();
  refresh.mockClear();
  vi.unstubAllGlobals();
});

function startRequest() {
  let respond!: (response: Response) => void;
  const fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        respond = resolve;
      }),
  );
  vi.stubGlobal('fetch', fetch);
  return { fetch, respond: (response: Response) => respond(response) };
}

function profileForm(): HTMLFormElement {
  const form = document.createElement('form');
  form.setAttribute('data-profile-form', '');
  for (const [name, value] of [
    ['handle', 'new_name'],
    ['displayName', 'Mina Vale'],
  ] as const) {
    const field = document.createElement('input');
    field.name = name;
    field.value = value;
    form.append(field);
  }
  const button = document.createElement('button');
  button.type = 'submit';
  button.textContent = 'Save profile';
  form.append(button);
  document.body.append(form);
  return form;
}

function status(target: string): BeMusicStatusElement {
  const line = document.createElement('be-music-status') as BeMusicStatusElement;
  line.setAttribute(target, '');
  document.body.append(line);
  return line;
}

test('submits both profile fields and refreshes the current page after the save succeeds', async () => {
  const form = profileForm();
  const button = form.querySelector('button')!;
  const line = status('data-settings-status');
  line.message = 'An earlier request failed.';
  const { fetch, respond } = startRequest();
  form.requestSubmit(button);

  expect(button.disabled).toBe(true);
  expect(line.hidden).toBe(true);
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/v0/me', {
    credentials: 'same-origin',
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: '{"handle":"new_name","displayName":"Mina Vale"}',
  });
  respond(new Response(null, { status: 204 }));

  await vi.waitFor(() => expect(button.disabled).toBe(false));
  expect(refresh).toHaveBeenCalledExactlyOnceWith('GET', location.pathname + location.search, {
    target: 'main',
    select: 'main',
    swap: 'outerMorph',
    selectOOB: '#site-header:outerMorph',
  });
});

test('shows a profile validation error and re-enables the form without refreshing', async () => {
  const form = profileForm();
  const button = form.querySelector('button')!;
  const line = status('data-settings-status');
  const { respond } = startRequest();
  form.requestSubmit(button);
  respond(Response.json({ error: 'handle-taken' }, { status: 409 }));

  await vi.waitFor(() => expect(button.disabled).toBe(false));
  expect(line.message).toBe('That handle is taken.');
  expect(line.hidden).toBe(false);
  expect(refresh).not.toHaveBeenCalled();
});

test.each([
  ['hide-score', 'scoreId', '/api/v0/scores/run-123', true],
  ['show-score', 'courseScoreId', '/api/v0/course-scores/run-123', false],
] as const)('the %s control changes the named play and refreshes after success', async (action, id, path, hidden) => {
  const button = document.createElement('button');
  button.dataset.accountAction = action;
  button.dataset[id] = 'run-123';
  const label = document.createElement('span');
  label.textContent = hidden ? 'Hide' : 'Show';
  button.append(label);
  document.body.append(button);
  const { fetch, respond } = startRequest();
  label.click();

  expect(button.disabled).toBe(true);
  expect(fetch).toHaveBeenCalledExactlyOnceWith(path, {
    credentials: 'same-origin',
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: hidden ? '{"hidden":true}' : '{"hidden":false}',
  });
  respond(new Response(null, { status: 204 }));
  await vi.waitFor(() => expect(button.disabled).toBe(false));
  expect(refresh).toHaveBeenCalledTimes(1);
});

test('explains why the visibility change was refused and leaves the current page in place', async () => {
  const button = document.createElement('button');
  button.dataset.accountAction = 'hide-score';
  button.dataset.scoreId = 'run-123';
  document.body.append(button);
  const line = status('data-visibility-status');
  const { respond } = startRequest();
  button.click();
  respond(Response.json({ error: 'not-your-score' }, { status: 403 }));

  await vi.waitFor(() => expect(button.disabled).toBe(false));
  expect(line.message).toBe('Only the player of this play can change it.');
  expect(line.hidden).toBe(false);
  expect(refresh).not.toHaveBeenCalled();
});
