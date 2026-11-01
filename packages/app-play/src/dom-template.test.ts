import { afterEach, expect, test, vi } from 'vite-plus/test';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
test('shows fixed build metadata in the page footer and the help overlay', async () => {
  vi.stubGlobal('__BE_MUSIC_BUILD_TIME__', '2026-10-20T08:00:00Z');
  vi.stubGlobal('__BE_MUSIC_BUILD_REVISION__', '0123456789abcdef');
  const { PLAYER_APP_HTML } = await import('./dom-template.ts');
  expect(PLAYER_APP_HTML.match(/2026-10-20 08:00:00 UTC/g)).toHaveLength(2);
  expect(PLAYER_APP_HTML.match(/>01234567<\/code>/g)).toHaveLength(2);
  expect(PLAYER_APP_HTML).toContain('class="service-build-footer"');
  const footer = PLAYER_APP_HTML.slice(PLAYER_APP_HTML.lastIndexOf('<footer'));
  expect(footer).toContain('service-page-footer');
  expect(footer).toContain('aria-current="page">Play</span>');
  expect(footer).not.toContain('>Play</a>');
  expect(footer).toContain('href="https://be-music.app/">Dashboard</a>');
  expect(footer).toContain('href="https://accounts.be-music.app/">Accounts</a>');
  expect(footer).toContain('href="https://leaderboard.be-music.app/">Leaderboard</a>');
  expect(footer).toContain('© 2026 nulltask · MIT License');
  expect(footer).toContain(
    '<p data-public-beta-notice="en" lang="en">Public Beta. Data may be deleted without notice.</p>',
  );
  expect(footer).toContain(
    '<p data-public-beta-notice="ja" lang="ja" hidden>パブリックベータのためデータは予告なく削除されることがあります。</p>',
  );
  expect(footer).not.toContain('>beta</span>');
  expect(footer).not.toContain('>Beta</span>');
  const brand = PLAYER_APP_HTML.indexOf('class="player-brand"');
  expect(brand).toBeGreaterThan(-1);
  expect(brand).toBeLessThan(PLAYER_APP_HTML.lastIndexOf('<footer'));
  expect(PLAYER_APP_HTML).toMatch(
    /<div class="player-brand">\s*<span class="font-semibold tracking-tight whitespace-nowrap">be-music player<\/span>\s*<span class="badge" data-variant="outline">Beta<\/span>\s*<\/div>/,
  );
  expect(PLAYER_APP_HTML).toContain(
    '<h2 class="help-modal-title" id="help-modal-title"><span>be-music player</span><span class="badge" data-variant="outline">Beta</span></h2>',
  );
});

test('uses chart and replay vocabulary in bilingual help', async () => {
  const { PLAYER_APP_HTML } = await import('./dom-template.ts');
  expect(PLAYER_APP_HTML).toContain('Loading charts');
  expect(PLAYER_APP_HTML).toContain('Chart select');
  expect(PLAYER_APP_HTML).toContain('譜面の読み込み');
  expect(PLAYER_APP_HTML).toContain('リプレイ (<code>*.bmplay.json</code>、コースは <code>*.bmcourse.json</code>)');
  expect(PLAYER_APP_HTML).not.toContain('チャート');
  expect(PLAYER_APP_HTML).not.toContain('Loading songs');
  expect(PLAYER_APP_HTML).toContain('is a Public Beta: its rankings may be reset.');
  expect(PLAYER_APP_HTML).toContain('Data may be deleted without notice.');
  expect(PLAYER_APP_HTML).toContain(
    'はパブリックベータで、ランキングはリセットされることがあります。データは予告なく削除されることがあります。',
  );
  expect(PLAYER_APP_HTML).not.toContain('is a beta:');
  expect(PLAYER_APP_HTML).not.toContain('ベータ版');
});
