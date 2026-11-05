import { renderAccountPage } from '../../app-dashboard/src/accounts/page.ts';
import { renderDashboard } from '../../app-dashboard/src/page.ts';
import { CLIENT_JS as ACCOUNTS_CLIENT_JS } from '../../app-dashboard/src/accounts/client.generated.ts';
import { CLIENT_JS } from '../../app-leaderboard/src/pages/client.generated.ts';
import { expect, test } from './support.ts';

test('Lit status messages survive htmx partial navigation without exposing markup', async ({ page }) => {
  let partialRequests = 0;
  await page.route('**/__service-ui-test', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html lang="en"><body><main><be-music-status id="message" role="status" data-share-status>Server notice</be-music-status>
      <be-music-local-time id="moment" datetime="2026-10-13T06:20:00.000Z" utc="original UTC" precision="minute"><time>Server UTC fallback</time></be-music-local-time>
      <a href="/__service-ui-next" hx-get="/__service-ui-next" hx-target="main" hx-select="main" hx-swap="outerMorph">Next</a>
    </main></body></html>`,
    }),
  );
  await page.route('**/__service-ui-next', (route) => {
    if (route.request().headers()['hx-request'] === 'true') partialRequests++;
    return route.fulfill({
      contentType: 'text/html',
      body: `<html lang="en"><body><main><h1>Next page</h1><be-music-status id="message" role="status" data-share-status hidden></be-music-status>
        <be-music-local-time id="moment" datetime="2026-10-13T07:20:00.000Z" utc="updated UTC" precision="minute"><time>Updated UTC fallback</time></be-music-local-time>
        <button type="button" data-share-copy>Copy link</button></main></body></html>`,
    });
  });
  await page.goto('/__service-ui-test');
  await expect(page.locator('#moment').locator('xpath=./time')).toBeVisible();
  await page.addScriptTag({ content: CLIENT_JS });
  await expect(page.locator('#moment').locator('xpath=./time')).toBeHidden();
  await expect
    .poll(() => page.locator('#moment').evaluate((host) => host.shadowRoot?.querySelector('time')?.dateTime))
    .toBe('2026-10-13T06:20:00.000Z');
  const status = page.locator('#message');
  await expect(status).toContainText('Server notice');
  await status.evaluate((element) => {
    (element as HTMLElement & { message: string }).message = '<img src=x onerror=alert(1)>';
  });
  await expect(status.locator('[part="message"]')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(status.locator('img')).toHaveCount(0);
  await page.getByRole('link', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Next page' })).toBeVisible();
  expect(partialRequests).toBe(1);
  await expect
    .poll(() => page.locator('#moment').evaluate((host) => host.shadowRoot?.querySelector('time')?.dateTime))
    .toBe('2026-10-13T07:20:00.000Z');
  await expect
    .poll(() => page.locator('#moment').evaluate((host) => host.shadowRoot?.querySelector('time')?.title))
    .toContain('updated UTC');
  await expect(status).toBeHidden();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => undefined } });
  });
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(status).toBeVisible();
  await expect(status.locator('[part="message"]')).toHaveText('Link copied.');
});

test('Accounts keeps the server notice until an auth action and renders the returned error safely', async ({
  page,
}) => {
  await page.route('**/__accounts-ui-test', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: renderAccountPage({
        signedIn: false,
        anonymous: false,
        name: '',
        login: true,
        discord: false,
        google: false,
        notice: 'Server notice',
      }),
    }),
  );
  await page.route('**/api/auth/sign-in/anonymous', (route) =>
    route.fulfill({
      status: 400,
      json: { code: 'TEST_ERROR', message: '<img src=x onerror=alert(1)>' },
    }),
  );
  await page.route('**/assets/client.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: ACCOUNTS_CLIENT_JS }),
  );
  await page.goto('/__accounts-ui-test');
  await expect(page.locator('html')).toHaveAttribute('data-auth-ready', 'true');
  const status = page.locator('#status');
  await expect(status).toContainText('Server notice');
  const guest = page.getByRole('button', { name: 'Start a guest account' });
  await guest.click();
  await expect(status.locator('[part="message"]')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(status.locator('img')).toHaveCount(0);
  await expect(guest).toBeEnabled();
});

test('Dashboard server templates render localized navigation without client JavaScript', async ({ page }) => {
  await page.route('**/__dashboard-ui-test', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: renderDashboard({
        account: { handle: 'guest', displayName: 'Guest', anonymous: true },
        hostname: 'preview.be-music.app',
        locale: 'ja',
        showDonateLink: true,
      }),
    }),
  );
  await page.goto('/__dashboard-ui-test');
  await expect(page.getByRole('heading', { name: 'ダッシュボード', exact: true })).toBeVisible();
  await expect(page.locator('main [data-state]')).toHaveAttribute('data-state', 'anonymous');
  await expect(page.locator('main nav a')).toHaveCount(2);
  await expect(page.locator('main nav a').first()).toHaveAttribute('href', 'https://play.preview.be-music.app/');
  await expect(page.locator('script')).toHaveCount(0);
  await page.locator('[popovertarget="language-menu"]').click();
  await expect(page.locator('#language-menu')).toBeVisible();
  await expect(page.locator('footer a', { hasText: '寄付' })).toHaveAttribute(
    'href',
    'https://donate.preview.be-music.app/',
  );
});

test('Leaderboard Lit pages keep real htmx filters and header ruleset updates', async ({ page }) => {
  const { startBrowserWorker } = await import('../../app-leaderboard/src/test-support/browser-worker.ts');
  const worker = await startBrowserWorker();
  const origin = (await worker.ready).origin;
  let partialRequests = 0;
  page.on('request', (request) => {
    if (request.headers()['hx-request'] === 'true') partialRequests++;
  });
  try {
    await page.goto(origin + '/');
    await expect(page.getByRole('heading', { name: 'Latest', exact: true })).toBeVisible();
    await page.evaluate(() => {
      (window as Window & { retained?: number }).retained = 17;
    });
    const toggle = page.getByRole('switch').first();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(page).toHaveURL(/anonymous=1/);
    expect(partialRequests).toBe(1);
    expect(await page.evaluate(() => (window as Window & { retained?: number }).retained)).toBe(17);
    await page.locator('[popovertarget="ruleset-menu"]').click();
    await page.locator('#ruleset-menu a[href^="/ruleset/beatoraja"]').click();
    await expect(page.locator('[popovertarget="ruleset-menu"]')).toHaveAttribute(
      'aria-label',
      'Scoring rules: beatoraja rules',
    );
    await expect(page.locator('#ruleset-menu')).toBeHidden();
    expect(partialRequests).toBeGreaterThanOrEqual(2);
    expect(await page.evaluate(() => (window as Window & { retained?: number }).retained)).toBe(17);
    await page.goto(origin + '/help?lang=ja');
    await expect(page.getByRole('heading', { name: 'プレイの見方', exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    await expect(page.locator('body > footer')).toContainText('パブリックベータ');
    await page.locator('[data-account-action="open-sign-in"]').click();
    await expect(page.locator('dialog[open]')).toBeVisible();
    await page.locator('dialog[open] [data-auth-action="close"]').click();
    const signedIn = await page.request.post(origin + '/api/auth/sign-in/anonymous', { data: {}, headers: { origin } });
    expect(signedIn.ok()).toBe(true);
    const me = await page.request.get(origin + '/api/v0/me');
    expect(me.ok()).toBe(true);
    const identity = (await me.json()) as { handle: string };
    await page.goto(origin + '/?lang=en');
    const account = page.locator('[popovertarget="account-menu"]');
    await expect(account).toContainText('@' + identity.handle);
    await expect(account.locator('img')).toHaveAttribute('width', '24');
    await account.click();
    await expect(page.locator('#account-menu [data-account-identity]')).toBeVisible();
    await expect(page.locator('#account-menu [data-account-identity]')).toContainText('@' + identity.handle);
    await expect(page.locator('#account-menu .badge')).toHaveText('guest');
    await page.keyboard.press('Escape');
    await expect(page.locator('#account-menu')).toBeHidden();
    await expect(account).toBeFocused();
  } finally {
    await worker.dispose();
  }
});

test('Play uses the shared auth panel without losing sign-up edits during language changes', async ({
  player,
}, info) => {
  const { page } = player;
  await page.route('**/api/auth/get-session', (route) => route.fulfill({ json: null }));
  await page.route('**/api/v0/me', (route) => route.fulfill({ status: 409, json: { error: 'handle-taken' } }));
  await page.route('**/api/auth/sign-in?*', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Accounts route reached</h1>' }),
  );
  await player.open();
  await page.locator('[data-service-header="account"]').click();
  const signIn = page.locator('#leaderboard-sign-in');
  await expect(signIn).toHaveAttribute('open', '');
  await expect(signIn.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  await signIn.locator('[data-auth-action="open-sign-up"]').click();
  const signUp = page.locator('#leaderboard-sign-up');
  await expect(signUp).toHaveAttribute('open', '');
  const handle = signUp.locator('input[name="handle"]');
  const name = signUp.locator('input[name="displayName"]');
  await handle.fill('alice_test');
  await name.fill('Alice');
  await page.setViewportSize({ width: 390, height: 600 });
  await signUp.getByRole('button', { name: 'Create passkey', exact: true }).click();
  await expect(signUp.locator('[data-auth-status]')).toBeVisible();
  await expect(signUp.locator('[data-auth-status]')).toContainText('taken');
  await expect(signUp.getByRole('button', { name: 'Create passkey', exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('shared-auth-panel.png') });
  await handle.focus();
  const original = await handle.elementHandle();
  await page.locator('#language-menu a[lang="ja"]').dispatchEvent('click');
  await expect(signUp.getByRole('heading', { name: 'アカウントを作成', exact: true })).toBeVisible();
  await expect(signUp.getByRole('button', { name: 'Google で登録', exact: true })).toBeVisible();
  await expect(handle).toHaveValue('alice_test');
  await expect(name).toHaveValue('Alice');
  await expect(handle).toBeFocused();
  expect(await handle.evaluate((current, previous) => current === previous, original)).toBe(true);
  await signUp.locator('[data-auth-action="close"]').click();
  await expect(signUp).not.toHaveAttribute('open', '');
  await page.locator('[popovertarget="language-menu"]').click();
  await page.locator('#language-menu a[lang="en"]').click();
  await page.locator('[data-service-header="account"]').click();
  await signIn.getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(page.getByRole('heading', { name: 'Accounts route reached' })).toBeVisible();
  await expect(page).toHaveURL(/\/api\/auth\/sign-in\?.*method=google/);
});

for (const method of ['google', 'discord'] as const) {
  test(`Accounts auto-starts the shared ${method} action once when requested by another site`, async ({ page }) => {
    const requests: string[] = [];
    await page.route('**/login?*', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: renderAccountPage({
          signedIn: false,
          anonymous: false,
          name: '',
          login: true,
          google: true,
          discord: true,
          notice: 'Ready',
          requestURL: route.request().url(),
        }),
      }),
    );
    await page.route('**/assets/client.js', (route) =>
      route.fulfill({ contentType: 'text/javascript', body: ACCOUNTS_CLIENT_JS }),
    );
    await page.route('**/api/auth/sign-in/social', (route) => {
      requests.push(route.request().postDataJSON().provider as string);
      return route.fulfill({ status: 400, json: { code: 'TEST_ERROR', message: '<img src=x> provider error' } });
    });
    await page.goto('/login?sign_in_method=' + method);
    await expect(page.locator('#status')).toContainText('<img src=x> provider error');
    await expect(page.locator('#status img')).toHaveCount(0);
    expect(requests).toEqual([method]);
    await expect(page.locator(`[data-auth-action="${method}"]`)).toBeEnabled();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-auth-ready', 'true');
    await page.waitForLoadState('networkidle');
    expect(requests).toEqual([method]);
    await expect(page.locator('#status')).toContainText('Ready');
  });
}

test('Accounts leaves an unavailable or malformed requested provider inactive', async ({ page }) => {
  let requests = 0;
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/login?*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: renderAccountPage({
        signedIn: false,
        anonymous: false,
        name: '',
        login: true,
        google: false,
        discord: false,
        notice: 'Ready',
        requestURL: route.request().url(),
      }),
    }),
  );
  await page.route('**/assets/client.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: ACCOUNTS_CLIENT_JS }),
  );
  await page.route('**/api/auth/sign-in/social', (route) => {
    requests++;
    return route.fulfill({ status: 400, json: {} });
  });
  for (const method of ['google', 'google"][data-auth-action="guest']) {
    await page.goto('/login?sign_in_method=' + encodeURIComponent(method));
    await expect(page.locator('html')).toHaveAttribute('data-auth-ready', 'true');
    await page.waitForLoadState('networkidle');
    expect(requests).toBe(0);
    await expect(page.locator('#status')).toContainText('Ready');
    await expect(page.locator('[data-auth-action="guest"]')).toBeEnabled();
  }
  expect(pageErrors).toEqual([]);
});
