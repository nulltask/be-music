// Creates one guest to exercise real SSO; never prints cookies, tokens or personal account data.
import { chromium } from '@playwright/test';
const preview = process.argv.includes('--preview');
const site = preview ? 'preview.be-music.app' : 'be-music.app';
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  await context.route('**/beacon.min.js/**', (route) => route.abort());
  const page = await context.newPage();
  page.on('pageerror', () => {
    throw new Error('Browser script failed');
  });
  await page.goto(`https://leaderboard.${site}/api/auth/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.locator('html[data-auth-ready="true"]').waitFor();
  await page.getByRole('button', { name: 'Start a guest account' }).click();
  await page.waitForURL(`https://leaderboard.${site}/`, { timeout: 60000, waitUntil: 'domcontentloaded' });
  const firstResponse = await context.request.get(`https://leaderboard.${site}/api/v0/me`);
  if (!firstResponse.ok()) throw new Error('Leaderboard account unavailable');
  const first = (await firstResponse.json()) as { handle: string };
  const account = (await (await context.request.get(`https://accounts.${site}/api/auth/get-session`)).json()) as {
    user: { id: string };
  };
  for (const service of ['play', 'donate', 'dashboard']) {
    const origin = `https://${service === 'dashboard' ? '' : service + '.'}${site}`;
    await page.goto(`${origin}/api/auth/sign-in`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL((url) => url.origin === origin && !url.pathname.startsWith('/api/'), {
      timeout: 60000,
      waitUntil: 'domcontentloaded',
    });
    if (service === 'play') {
      const me = (await (await context.request.get(`${origin}/api/v0/me`)).json()) as { handle: string };
      if (me.handle !== first.handle) throw new Error('Player and Leaderboard identities differ');
    } else if (service === 'donate') {
      const me = (await (await context.request.get(`${origin}/api/me`)).json()) as { id: string };
      if (me.id !== account.user.id) throw new Error('Donation identity differs from Accounts');
      await page.goto(`${origin}/ja/`, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-account-status]').filter({ hasText: /\S/ }).waitFor();
    } else {
      await page.locator('[data-state="anonymous"]').waitFor();
      if (!(await page.content()).includes(first.handle)) throw new Error('Dashboard profile differs');
    }
    console.log(`${service}: SSO and account verified (${preview ? 'preview' : 'production'})`);
  }
  if (process.argv.includes('--passkey')) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    await page.goto(`https://accounts.${site}/account`, { waitUntil: 'domcontentloaded' });
    await page.locator('html[data-auth-ready="true"]').waitFor();
    const registration = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/auth/passkey/verify-registration',
    );
    await page.getByRole('button', { name: 'Add a passkey to keep this account' }).click();
    if (!(await registration).ok()) throw new Error('Passkey registration failed');
    await page.waitForURL(`https://accounts.${site}/account`, { waitUntil: 'domcontentloaded' });
    await context.request.post(`https://accounts.${site}/api/auth/sign-out`, {
      headers: { origin: `https://accounts.${site}` },
    });
    await context.clearCookies({ domain: `accounts.${site}` });
    await page.goto(`https://leaderboard.${site}/api/auth/sign-in`, { waitUntil: 'domcontentloaded' });
    await page.locator('html[data-auth-ready="true"]').waitFor();
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await page.waitForURL(`https://leaderboard.${site}/`, { timeout: 60000, waitUntil: 'domcontentloaded' });
    const me = (await (await context.request.get(`https://leaderboard.${site}/api/v0/me`)).json()) as {
      handle: string;
      anonymous: boolean;
      passkeys: number;
    };
    if (me.handle !== first.handle || me.anonymous || me.passkeys !== 1)
      throw new Error('Passkey sign-in did not keep the same player profile');
    console.log('Passkey enrollment, guest upgrade and sign-in verified with a virtual authenticator.');
  }
  const cookies = await context.cookies();
  if (cookies.some((cookie) => cookie.domain.startsWith('.'))) throw new Error('Unexpected parent-domain cookie');
  if (cookies.filter((cookie) => cookie.name === '__Host-be-music.session').length !== 4)
    throw new Error('Missing host-only app sessions');
  console.log('Verified four independent host-only sessions and one Accounts identity.');
} finally {
  await browser.close();
}
