import { expect, test } from 'vite-plus/test';
import { resolveServiceHeader } from './header-model.ts';

const base = {
  locale: 'en',
  title: 'Be-Music',
  homeHref: '/',
  accountHref: '/account',
  requestURL: '/?chart=1',
} as const;

test('orders optional actions and makes Settings replace Play without mutating input', () => {
  const input = {
    ...base,
    playHref: '/play',
    install: true,
    help: true,
    settings: true,
    settingsOpen: true,
    fullscreen: true,
    fullscreenActive: true,
  };
  const view = resolveServiceHeader(input);
  expect(view.actions.map((action) => action.key)).toEqual(['install', 'help', 'settings', 'fullscreen']);
  expect(view.actions[2]).toMatchObject({ expanded: true });
  expect(view.actions[3]).toMatchObject({ pressed: true, label: 'Exit full screen' });
  expect(input.playHref).toBe('/play');
  expect(resolveServiceHeader({ ...base, playHref: '/play' }).actions).toMatchObject([{ key: 'play', href: '/play' }]);
});

test('keeps unescaped account data for each renderer and localizes language links', () => {
  const view = resolveServiceHeader({
    ...base,
    locale: 'ja',
    accountNewTab: true,
    account: { handle: '', displayName: '<Alice & Bob>', anonymous: true },
  });
  expect(view.account).toMatchObject({
    label: '<Alice & Bob>',
    ariaLabel: '<Alice & Bob>',
    title: '<Alice & Bob> (ゲスト)',
    newTab: true,
  });
  expect(view.language.choices).toEqual([
    { locale: 'en', label: 'English', href: '/?chart=1&lang=en', current: false },
    { locale: 'ja', label: '日本語', href: '/?chart=1&lang=ja', current: true },
  ]);
  expect(resolveServiceHeader({ ...base, accountNewTab: true }).account.newTab).toBe(false);
});
