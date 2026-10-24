import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * The course browser checklist run end to end (`docs/course-checklist.md`): the player is built and served on a free
 * port, the checklist fixtures (charts, course files, minimal LR2 / beatoraja skins) are written to a temp dir by the
 * global setup, and the specs drive the player through synthetic drops and keys, asserting on `window.__beMusicTest`.
 *
 * `pnpm run test:e2e` runs it; `E2E_PORT` pins the port and `E2E_WORKERS` the parallelism.
 */

const playerDir = resolve(import.meta.dirname, '..');

/** A free TCP port on the loopback interface, found once and handed to the workers through the environment. */
function freePort(): string {
  return execFileSync(
    process.execPath,
    [
      '-e',
      "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})",
    ],
    { encoding: 'utf8' },
  );
}

process.env.E2E_PORT ??= freePort();
const port = Number(process.env.E2E_PORT);

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: resolve(playerDir, 'e2e-results'),
  globalSetup: './global-setup.ts',
  // A course runs several short charts in real time.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: true,
  workers: Number(process.env.E2E_WORKERS ?? 4),
  forbidOnly: process.env.CI === 'true',
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 960, height: 540 },
    // Full Chromium in its new headless mode draws on the GPU where there is one; the headless shell's software
    // renderer runs the scenes at a few frames a second.
    channel: 'chromium',
    // The scenes start their sound without a click.
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `pnpm exec vp build --logLevel error && pnpm exec vp preview --port ${port} --strictPort --host 127.0.0.1 --logLevel silent`,
    cwd: playerDir,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
