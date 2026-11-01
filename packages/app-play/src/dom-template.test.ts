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
    '<p data-public-beta-notice="ja" lang="ja" hidden>パブリックベータ。データは予告なく削除されることがあります。</p>',
  );
  expect(footer).not.toContain('>beta</span>');
  expect(footer).not.toContain('>Beta</span>');
  expect(PLAYER_APP_HTML).toContain('id="player-service-header"');
  expect(PLAYER_APP_HTML).toContain('>Be-Music Play</a><span class="badge" data-variant="outline">Beta</span>');
  expect(PLAYER_APP_HTML).toContain('data-service-header="settings"');
  expect(PLAYER_APP_HTML).toContain('aria-label="Settings"');
  expect(PLAYER_APP_HTML).not.toContain('lucide-play');
  expect(PLAYER_APP_HTML).not.toContain('id="account-chip"');
  expect(PLAYER_APP_HTML).not.toContain('player-brand');
  expect(PLAYER_APP_HTML).toContain(
    '<h2 class="help-modal-title" id="help-modal-title"><span>be-music player</span><span class="badge" data-variant="outline">Beta</span></h2>',
  );
  expect(PLAYER_APP_HTML.match(/<span class="badge"/g)).toHaveLength(2);
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
