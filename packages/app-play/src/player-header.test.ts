import { render } from '@lit-labs/ssr';
import { collectResultSync } from '@lit-labs/ssr/lib/render-result.js';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { playerLang, setPlayerLang } from './player-copy.ts';
import {
  bindPlayerHeader,
  classifyPlayerHeaderClick,
  playerHeaderFullscreenTarget,
  playerServiceHeaderTemplate,
  runPlayerHeaderAction,
  setPlayerHeaderAccount,
  setPlayerHeaderSettingsOpen,
  togglePlayerHeaderFullscreen,
  type PlayerHeaderFullscreenDocument,
} from './player-header.ts';

function playerServiceHeaderHTML(input: Parameters<typeof playerServiceHeaderTemplate>[0]): string {
  return collectResultSync(render(playerServiceHeaderTemplate(input)))
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .replace(/\s+>/g, '>');
}

afterEach(() => {
  setPlayerLang('en');
  setPlayerHeaderAccount(undefined);
  setPlayerHeaderSettingsOpen(false);
  bindPlayerHeader({
    toggleOptions: null,
    openSignIn: null,
    selectLanguage: setPlayerLang,
  });
});

test('renders the shared header with Settings where Play would be', () => {
  const html = playerServiceHeaderHTML({ locale: 'en', hostname: 'localhost', requestURL: '/' });
  expect(html).toContain('>Be-Music Play</a><span class="badge max-sm:hidden" data-variant="outline">Beta</span>');
  expect(html).toContain('class="flex items-center gap-x-3 px-4 py-2.5 sm:gap-x-6"');
  expect(html).not.toContain('max-w-5xl');
  expect(html).not.toContain('mx-auto');
  expect(html.match(/<span class="badge/g)).toHaveLength(1);
  expect(html).toContain('data-service-header="settings"');
  expect(html).toContain('aria-label="Settings" aria-expanded="false"');
  expect(html).toContain('data-tooltip="Settings"');
  const open = playerServiceHeaderHTML({
    locale: 'en',
    hostname: 'localhost',
    requestURL: '/',
    settingsOpen: true,
  });
  expect(open).toContain('aria-label="Settings" aria-expanded="true"');
  expect(html).toContain(
    'data-service-header="fullscreen" data-tooltip="Full screen" data-side="bottom" aria-label="Full screen"',
  );
  expect(html).toContain('aria-pressed="false"');
  expect(html).toContain('lucide-maximize');
  expect(html.indexOf('data-service-header="settings"')).toBeLessThan(html.indexOf('data-service-header="fullscreen"'));
  expect(html).toContain('data-service-header="help" aria-haspopup="dialog" aria-controls="help-modal"');
  expect(html).not.toContain('data-service-header="install"');
  expect(
    playerServiceHeaderHTML({ locale: 'en', hostname: 'localhost', requestURL: '/', installable: true }),
  ).toContain('data-service-header="install"');
  expect(html.indexOf('data-service-header="help"')).toBeLessThan(html.indexOf('data-service-header="settings"'));
  expect(html).toMatch(/>\s*Sign in\s*<\/a>/);
  expect(html).toContain('href="#main"');
  expect(html).not.toContain('aria-label="Play"');
  expect(html).not.toContain('lucide-play');
  const ja = playerServiceHeaderHTML({ locale: 'ja', hostname: 'play.be-music.app', requestURL: '/?chart=1' });
  expect(ja).toContain('aria-label="設定"');
  expect(ja).toContain('aria-label="ヘルプ"');
  expect(ja).toContain('data-tooltip="設定"');
  expect(ja).toContain('aria-label="フルスクリーン" aria-pressed="false"');
  expect(ja).toMatch(/>\s*ログイン\s*<\/a>/);
  expect(ja).toContain('href="/?chart=1&amp;lang=en"');
  const signedIn = playerServiceHeaderHTML({
    locale: 'en',
    hostname: 'localhost',
    requestURL: '/',
    account: { handle: 'alice', displayName: 'Alice', anonymous: false, avatarUrl: '/players/alice/avatar?v=g' },
  });
  expect(signedIn).toContain(
    'data-service-header="account" href="https://leaderboard.be-music.app/players/alice" target="_blank" rel="noopener"',
  );
  expect(signedIn).toContain(
    'rounded-full object-cover ring-1" src="https://leaderboard.be-music.app/players/alice/avatar?v=g"',
  );
  expect(signedIn).toContain('width="24" height="24"');
  const noAvatar = playerServiceHeaderHTML({
    locale: 'en',
    hostname: 'localhost',
    requestURL: '/',
    account: { handle: 'alice', displayName: 'Alice', anonymous: false },
  });
  expect(noAvatar).not.toContain('/avatar');
});

test('Settings toggles the Options dialog and a signed-out account opens sign-in', () => {
  const hit = (selector: string) => ({
    closest: (query: string) =>
      query === selector ? { lang: selector === '#language-menu a' ? 'ja' : undefined } : null,
  });
  expect(classifyPlayerHeaderClick(hit('[data-service-header="install"]'), true)).toBe('install');
  expect(classifyPlayerHeaderClick(hit('[data-service-header="help"]'), true)).toBe('help');
  expect(classifyPlayerHeaderClick(hit('[data-service-header="settings"]'), true)).toBe('settings');
  expect(classifyPlayerHeaderClick(hit('[data-service-header="fullscreen"]'), true)).toBe('fullscreen');
  expect(classifyPlayerHeaderClick(hit('[data-service-header="account"]'), true)).toBe('sign-in');
  expect(classifyPlayerHeaderClick(hit('[data-service-header="account"]'), false)).toBeUndefined();
  expect(classifyPlayerHeaderClick(hit('#language-menu a'), true)).toBe('ja');

  const opened = { open: false, toggles: 0, signIn: 0 };
  let helpOpened = 0;
  runPlayerHeaderAction('help');
  bindPlayerHeader({ openHelp: () => (helpOpened += 1) });
  expect(helpOpened).toBe(1);
  runPlayerHeaderAction('help');
  expect(helpOpened).toBe(2);
  bindPlayerHeader({ openHelp: null });
  runPlayerHeaderAction('settings');
  runPlayerHeaderAction('sign-in');
  bindPlayerHeader({
    toggleOptions: () => {
      opened.toggles += 1;
      opened.open = !opened.open;
    },
    openSignIn: () => {
      opened.signIn += 1;
    },
    selectLanguage: setPlayerLang,
  });
  expect(opened).toEqual({ open: true, toggles: 1, signIn: 1 });
  runPlayerHeaderAction('settings');
  expect(opened).toEqual({ open: false, toggles: 2, signIn: 1 });
  runPlayerHeaderAction('settings');
  expect(opened.open).toBe(true);
  bindPlayerHeader({
    toggleOptions: null,
    openSignIn: null,
    selectLanguage: setPlayerLang,
  });
  runPlayerHeaderAction('settings');
  runPlayerHeaderAction('settings');
  bindPlayerHeader({
    toggleOptions: () => {
      opened.toggles += 1;
    },
    selectLanguage: setPlayerLang,
  });
  expect(opened.toggles).toBe(3);
  runPlayerHeaderAction('ja');
  expect(playerLang()).toBe('ja');
});

function resolved() {
  return vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
}

function fullscreenDocument(input: {
  phone: boolean;
  surface?: { requestFullscreen: ReturnType<typeof resolved> } | null;
  rootRequest?: ReturnType<typeof resolved>;
  fullscreenElement?: Element;
  exitFullscreen?: ReturnType<typeof resolved>;
}): PlayerHeaderFullscreenDocument {
  return {
    fullscreenElement: input.fullscreenElement,
    exitFullscreen: input.exitFullscreen,
    documentElement: {
      classList: { contains: (token) => input.phone && token === 'phone' },
      requestFullscreen: input.rootRequest ?? resolved(),
    },
    querySelector: (selector) => (selector === '#main' ? (input.surface ?? null) : null),
  };
}

test('fullscreen toggles the play surface on a desktop and on a phone', async () => {
  const surfaceRequest = resolved();
  const desktop = fullscreenDocument({ phone: false, surface: { requestFullscreen: surfaceRequest } });
  expect(playerHeaderFullscreenTarget(desktop)).toBe(desktop.querySelector('#main'));
  expect(playerHeaderFullscreenTarget(desktop)).not.toBe(desktop.documentElement);
  await togglePlayerHeaderFullscreen(desktop);
  expect(surfaceRequest).toHaveBeenCalledOnce();

  const rootRequest = resolved();
  const phoneSurface = resolved();
  const lock = vi.fn().mockResolvedValue(undefined);
  const phone = fullscreenDocument({
    phone: true,
    surface: { requestFullscreen: phoneSurface },
    rootRequest,
  });
  expect(playerHeaderFullscreenTarget(phone)).toBe(phone.querySelector('#main'));
  expect(playerHeaderFullscreenTarget(phone)).not.toBe(phone.documentElement);
  await togglePlayerHeaderFullscreen(phone, { orientation: { lock } });
  expect(phoneSurface).toHaveBeenCalledOnce();
  expect(rootRequest).not.toHaveBeenCalled();
  expect(lock).toHaveBeenCalledWith('landscape');

  const exit = resolved();
  const activeRoot = resolved();
  await togglePlayerHeaderFullscreen(
    fullscreenDocument({
      phone: true,
      rootRequest: activeRoot,
      fullscreenElement: {} as Element,
      exitFullscreen: exit,
    }),
  );
  expect(exit).toHaveBeenCalledOnce();
  expect(activeRoot).not.toHaveBeenCalled();

  const fallback = resolved();
  await togglePlayerHeaderFullscreen(fullscreenDocument({ phone: false, surface: null, rootRequest: fallback }));
  expect(fallback).toHaveBeenCalledOnce();
});
