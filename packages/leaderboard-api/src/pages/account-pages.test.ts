import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';
import { createApp } from '../app.ts';
import type { Env } from '../env.ts';
import { ORIGIN, signInAnonymously, startTestBindings } from '../../test/support.ts';

let env: Env;
let dispose: () => Promise<void>;
const app = createApp({ chartsetLookup: async () => undefined });
const fetchApp = (path: string, init?: RequestInit): Promise<Response> =>
  Promise.resolve(app.request(`${ORIGIN}${path}`, init, env));
const html = async (path: string, cookie?: string) =>
  (await fetchApp(path, cookie !== undefined ? { headers: { cookie } } : undefined)).text();

beforeAll(async () => {
  ({ env, dispose } = await startTestBindings());
});

afterAll(async () => {
  await dispose();
});

describe('signing in on the site', () => {
  test('signed out, the header offers the passkey sign-in, and the settings page asks for it', async () => {
    const top = await html('/leaderboard');
    expect(top).toContain('data-account-action="sign-in"');
    expect(top).not.toContain('href="/leaderboard/settings"');
    const settings = await html('/leaderboard/settings');
    expect(settings).toContain('Sign in with a passkey');
    expect(settings).not.toContain('data-profile-form');
  });

  test('the client script is linked and served', async () => {
    const top = await html('/leaderboard');
    const src = /<script src="(\/leaderboard\/assets\/client\.[0-9a-f]{12}\.js)" defer/.exec(top)?.[1];
    expect(src).toBeDefined();
    const script = await fetchApp(src!);
    expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(script.headers.get('cache-control')).toContain('immutable');
    expect((await script.text()).length).toBeGreaterThan(1000);
  });

  test('signed in, the header shows the account and the settings page its profile', async () => {
    const cookie = await signInAnonymously(fetchApp);
    const me = (await (await fetchApp('/api/v0/me', { headers: { cookie } })).json()) as { handle: string };
    const top = await html('/leaderboard', cookie);
    expect(top).toContain(`@${me.handle}`);
    expect(top).toContain('href="/leaderboard/settings"');
    expect(top).toContain('data-account-action="sign-out"');
    const settings = await html('/leaderboard/settings', cookie);
    expect(settings).toContain('data-profile-form');
    expect(settings).toContain(`value="${me.handle}"`);
    // An anonymous account is urged to create a passkey; it has no upload to remove yet.
    expect(settings).toContain('Create a passkey to keep this account');
    expect(settings).not.toContain('data-account-action="remove-avatar"');
  });
});
