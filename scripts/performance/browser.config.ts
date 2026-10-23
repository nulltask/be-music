import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import base from '../../packages/app-play/e2e/playwright.config.ts';
const server = base.webServer;
if (!server || Array.isArray(server)) throw new Error('The base E2E configuration must define one web server');
export default defineConfig({
  ...base,
  testDir: import.meta.dirname,
  testMatch: 'browser.check.ts',
  globalSetup: './browser.setup.ts',
  outputDir: resolve(import.meta.dirname, '../../tmp/remaining-work/performance/results'),
  timeout: 900000,
  workers: 1,
  fullyParallel: false,
  use: { ...base.use, viewport: { width: 1280, height: 720 }, trace: 'retain-on-failure' },
  webServer: {
    ...server,
    command: server.command.replace('vp build --logLevel error', 'vp build --sourcemap --logLevel error'),
  },
});
