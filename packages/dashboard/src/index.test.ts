import { afterEach, describe, expect, test, vi } from 'vite-plus/test';
import { handleAuth, readSession, type LoginSession } from '@be-music/auth-client';
import worker from './index.ts';

vi.mock('@be-music/auth-client', () => ({ handleAuth: vi.fn(), readSession: vi.fn() }));

const env = {
  AUTH_ISSUER: 'https://accounts.example/api/auth',
  PUBLIC_ORIGIN: 'https://dashboard.example',
  OIDC_CLIENT_ID: 'dashboard',
  API_AUDIENCE: 'https://leaderboard.example',
  SESSION_SECRET: 'test-secret-with-at-least-32-characters',
  PLAY_ORIGIN: 'https://play.example',
  LEADERBOARD_ORIGIN: 'https://leaderboard.example',
  DONATE_ORIGIN: 'https://donate.example',
};
const session: LoginSession = {
  identity: { issuer: env.AUTH_ISSUER, sub: 'central-user', name: 'Old Name', anonymous: true },
  accessToken: 'must-not-be-forwarded',
  expiresAt: Date.now() + 60000,
};
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe('Dashboard profile dependency', () => {
  test('reads the current profile directly from Accounts without forwarding credentials', async () => {
    vi.mocked(readSession).mockResolvedValue(session);
    const fetchProfile = vi.fn(async (_request: Request) =>
      Response.json({ handle: 'central_user', displayName: 'Current Name' }),
    );
    const response = await worker.fetch(new Request(env.PUBLIC_ORIGIN), { ...env, ACCOUNTS: { fetch: fetchProfile } });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Signed in anonymously as @central_user.');
    const request = fetchProfile.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe('https://accounts.example/api/profiles/central-user');
    expect(request.headers.get('authorization')).toBeNull();
    expect(request.headers.get('cookie')).toBeNull();
  });

  test('supports HTTPS when Accounts is not available as a binding', async () => {
    vi.mocked(readSession).mockResolvedValue({ ...session, identity: { ...session.identity, anonymous: false } });
    const fetchProfile = vi.fn(async (_request: Request) =>
      Response.json({ handle: 'central_user', displayName: 'Current Name' }),
    );
    vi.stubGlobal('fetch', fetchProfile);
    const response = await worker.fetch(new Request(env.PUBLIC_ORIGIN), env);
    expect(await response.text()).toContain('Signed in as Current Name (@central_user).');
    expect(fetchProfile).toHaveBeenCalledOnce();
  });

  test('does not fetch profiles for signed-out visitors', async () => {
    vi.mocked(readSession).mockResolvedValue(null);
    const fetchProfile = vi.fn();
    const response = await worker.fetch(new Request(env.PUBLIC_ORIGIN), { ...env, ACCOUNTS: { fetch: fetchProfile } });
    expect(response.status).toBe(200);
    expect(fetchProfile).not.toHaveBeenCalled();
  });

  test.each(['unavailable', 'invalid', 'network'])(
    'reports %s profiles without signing the user out',
    async (failure) => {
      vi.mocked(readSession).mockResolvedValue(session);
      const fetchProfile = vi.fn(async () => {
        if (failure === 'network') throw new Error('offline');
        return failure === 'invalid' ? Response.json({ handle: 123 }) : new Response(null, { status: 503 });
      });
      const response = await worker.fetch(new Request(env.PUBLIC_ORIGIN), {
        ...env,
        ACCOUNTS: { fetch: fetchProfile },
      });
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('retry-after')).toBe('30');
    },
  );

  test('preserves local authentication routes', async () => {
    vi.mocked(handleAuth).mockResolvedValue(new Response(null, { status: 302 }));
    expect((await worker.fetch(new Request(env.PUBLIC_ORIGIN + '/api/auth/sign-in'), env)).status).toBe(302);
    expect(readSession).not.toHaveBeenCalled();
  });
});
