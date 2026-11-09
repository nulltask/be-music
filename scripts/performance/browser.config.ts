import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import base from '../../packages/app-play/e2e/playwright.config.ts';
const server = base.webServer;
if (!server || Array.isArray(server)) throw new Error('The base E2E configuration must define one web server');

/** `PERF_VIEWPORT=1920x1080` sizes the page; 1280 × 720 otherwise. */
function perfViewport(value: string | undefined): { width: number; height: number } {
  if (value === undefined) return { width: 1280, height: 720 };
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (!match) throw new Error(`PERF_VIEWPORT must look like 1920x1080, not "${value}"`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

export default defineConfig({
  ...base,
  testDir: import.meta.dirname,
  testMatch: 'browser.check.ts',
  globalSetup: './browser.setup.ts',
  outputDir: resolve(import.meta.dirname, '../../tmp/remaining-work/performance/results'),
  timeout: 900000,
  workers: 1,
  fullyParallel: false,
  use: {
    ...base.use,
    // `PERF_CHANNEL=chrome` measures the installed Chrome instead of Playwright's Chromium build.
    ...(process.env.PERF_CHANNEL ? { channel: process.env.PERF_CHANNEL } : {}),
    viewport: perfViewport(process.env.PERF_VIEWPORT),
    trace: 'retain-on-failure',
  },
  webServer: {
    ...server,
    command: server.command.replace('vp build --logLevel error', 'vp build --sourcemap --logLevel error'),
  },
});
