import { expect, test } from 'vite-plus/test';
import { resolveInstallOffer } from './install-offer.ts';

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15';
const SAFARI_MAC_16 =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1';
const CHROME_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.0.0 Mobile/15E148 Safari/604.1';
const FIREFOX_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0';

const offer = (
  userAgent: string,
  overrides: { installed?: boolean; hasPrompt?: boolean; maxTouchPoints?: number } = {},
) =>
  resolveInstallOffer({
    installed: overrides.installed ?? false,
    hasPrompt: overrides.hasPrompt ?? false,
    userAgent,
    maxTouchPoints: overrides.maxTouchPoints ?? 0,
  });

test('offers Chromium’s prompt once the page has one', () => {
  expect(offer(CHROME_MAC, { hasPrompt: true })).toBe('prompt');
  expect(offer(CHROME_MAC)).toBeUndefined();
});

test('explains Safari’s own command on iOS, iPadOS and macOS Sonoma or later', () => {
  expect(offer(SAFARI_IPHONE)).toBe('ios-safari');
  // An iPad asks for the desktop site: a Mac user agent with touch points.
  expect(offer(SAFARI_MAC, { maxTouchPoints: 5 })).toBe('ios-safari');
  expect(offer(SAFARI_MAC)).toBe('mac-safari');
  expect(offer(SAFARI_MAC_16)).toBeUndefined();
});

test('offers nothing once installed, or where the browser has no way to install', () => {
  expect(offer(CHROME_MAC, { hasPrompt: true, installed: true })).toBeUndefined();
  expect(offer(SAFARI_IPHONE, { installed: true })).toBeUndefined();
  expect(offer(CHROME_IPHONE)).toBeUndefined();
  expect(offer(FIREFOX_MAC)).toBeUndefined();
});
