import { afterEach, expect, test, vi } from 'vite-plus/test';
import { playerLang, setPlayerLang } from './player-copy.ts';
import {
  bindPlayerHeader,
  classifyPlayerHeaderClick,
  playerHeaderFullscreenTarget,
  playerServiceHeaderHTML,
  runPlayerHeaderAction,
  setPlayerHeaderAccount,
  togglePlayerHeaderFullscreen,
  type PlayerHeaderFullscreenDocument,
} from './player-header.ts';

afterEach(() => {
  setPlayerLang('en');
  setPlayerHeaderAccount(undefined);
  bindPlayerHeader({
    openDebugMenu: null,
    openSignIn: null,
    selectLanguage: setPlayerLang,
  });
});

test('renders the shared header with Settings where Play would be', () => {
  const html = playerServiceHeaderHTML({ locale: 'en', hostname: 'localhost', requestURL: '/' });
  expect(html).toContain('>Be-Music Play</a><span class="badge" data-variant="outline">Beta</span>');
  expect(html.match(/<span class="badge"/g)).toHaveLength(1);
  expect(html).toContain('data-service-header="settings"');
  expect(html).toContain('aria-label="Settings"');
  expect(html).toContain('title="Debug Menu"');
  expect(html).toContain('data-service-header="fullscreen" title="Full screen" aria-label="Full screen"');
  expect(html).toContain('aria-pressed="false"');
  expect(html).toContain('lucide-maximize');
  expect(html.indexOf('data-service-header="settings"')).toBeLessThan(
    html.indexOf('data-service-header="fullscreen"'),
  );
  expect(html).toContain('>Sign in</a>');
  expect(html).toContain('href="#main"');
  expect(html).not.toContain('aria-label="Play"');
  expect(html).not.toContain('lucide-play');
  const ja = playerServiceHeaderHTML({ locale: 'ja', hostname: 'play.be-music.app', requestURL: '/?chart=1' });
  expect(ja).toContain('aria-label="設定"');
  expect(ja).toContain('title="デバッグメニュー"');
  expect(ja).toContain('aria-label="フルスクリーン" aria-pressed="false"');
  expect(ja).toContain('>ログイン</a>');
  expect(ja).toContain('href="/?chart=1&amp;lang=en"');
  const signedIn = playerServiceHeaderHTML({
    locale: 'en',
    hostname: 'localhost',
    requestURL: '/',
    account: { handle: 'alice', displayName: 'Alice', anonymous: false },
  });
  expect(signedIn).toContain(
    'data-service-header="account" target="_blank" rel="noopener" href="https://leaderboard.be-music.app/players/alice"',
  );
});

test('Settings opens the Debug Menu and a signed-out account opens sign-in', () => {
  const hit = (selector: string) => ({
    closest: (query: string) =>
      query === selector ? { lang: selector === '#language-menu a' ? 'ja' : undefined } : null,
  });
  expect(classifyPlayerHeaderClick(hit('[data-service-header="settings"]'), true)).toBe('settings');
  expect(classifyPlayerHeaderClick(hit('[data-service-header="fullscreen"]'), true)).toBe('fullscreen');
  expect(classifyPlayerHeaderClick(hit('[data-service-header="account"]'), true)).toBe('sign-in');
  expect(classifyPlayerHeaderClick(hit('[data-service-header="account"]'), false)).toBeUndefined();
  expect(classifyPlayerHeaderClick(hit('#language-menu a'), true)).toBe('ja');

  const opened = { menu: 0, signIn: 0 };
  runPlayerHeaderAction('settings');
  runPlayerHeaderAction('sign-in');
  bindPlayerHeader({
    openDebugMenu: () => {
      opened.menu += 1;
    },
    openSignIn: () => {
      opened.signIn += 1;
    },
    selectLanguage: setPlayerLang,
  });
  expect(opened).toEqual({ menu: 1, signIn: 1 });
  runPlayerHeaderAction('settings');
  expect(opened.menu).toBe(2);
  runPlayerHeaderAction('ja');
  expect(playerLang()).toBe('ja');
});

function resolved() {
  return vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
}

function fullscreenDocument(input: {
  phone: boolean;
  shell?: { requestFullscreen: ReturnType<typeof resolved> } | null;
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
    querySelector: (selector) => (selector === '.shell' ? (input.shell ?? null) : null),
  };
}

test('fullscreen toggles the shell on a desktop and the document on a phone', async () => {
  const shellRequest = resolved();
  const desktop = fullscreenDocument({ phone: false, shell: { requestFullscreen: shellRequest } });
  expect(playerHeaderFullscreenTarget(desktop)).toBe(desktop.querySelector('.shell'));
  await togglePlayerHeaderFullscreen(desktop);
  expect(shellRequest).toHaveBeenCalledOnce();

  const rootRequest = resolved();
  const phoneShell = resolved();
  const lock = vi.fn().mockResolvedValue(undefined);
  const phone = fullscreenDocument({
    phone: true,
    shell: { requestFullscreen: phoneShell },
    rootRequest,
  });
  expect(playerHeaderFullscreenTarget(phone)).toBe(phone.documentElement);
  await togglePlayerHeaderFullscreen(phone, { orientation: { lock } });
  expect(rootRequest).toHaveBeenCalledOnce();
  expect(phoneShell).not.toHaveBeenCalled();
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
  await togglePlayerHeaderFullscreen(fullscreenDocument({ phone: false, shell: null, rootRequest: fallback }));
  expect(fallback).toHaveBeenCalledOnce();
});
