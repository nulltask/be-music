import { renderAccountPage } from '../../app-accounts/src/page.ts';
import { renderDashboard } from '../../app-dashboard/src/page.ts';
import { CLIENT_JS as ACCOUNTS_CLIENT_JS } from '../../app-accounts/src/client.generated.ts';
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
  } finally {
    await worker.dispose();
  }
});
