import { describe, expect, test } from 'vite-plus/test';
import { shouldRegisterServiceWorker } from './register.ts';

describe('shouldRegisterServiceWorker', () => {
  test('registers in a production build of a browser with service workers', () => {
    expect(shouldRegisterServiceWorker({ production: true, testHook: false, supported: true })).toBe(true);
  });

  test('skips the dev server, the test hook and browsers without service workers', () => {
    expect(shouldRegisterServiceWorker({ production: false, testHook: false, supported: true })).toBe(false);
    expect(shouldRegisterServiceWorker({ production: true, testHook: true, supported: true })).toBe(false);
    expect(shouldRegisterServiceWorker({ production: true, testHook: false, supported: false })).toBe(false);
  });
});
