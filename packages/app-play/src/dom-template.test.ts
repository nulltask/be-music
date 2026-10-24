import { afterEach, expect, test, vi } from 'vite-plus/test';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
test('shows fixed build metadata in start-card and help footers', async () => {
  vi.stubGlobal('__BE_MUSIC_BUILD_TIME__', '2026-10-20T08:00:00Z');
  vi.stubGlobal('__BE_MUSIC_BUILD_REVISION__', '0123456789abcdef');
  const { PLAYER_APP_HTML } = await import('./dom-template.ts');
  expect(PLAYER_APP_HTML.match(/2026-10-20 08:00:00 UTC/g)).toHaveLength(2);
  expect(PLAYER_APP_HTML.match(/>01234567<\/code>/g)).toHaveLength(2);
  expect(PLAYER_APP_HTML).toContain('class="service-build-footer"');
});

test('uses chart and replay vocabulary in bilingual help', async () => {
  const { PLAYER_APP_HTML } = await import('./dom-template.ts');
  expect(PLAYER_APP_HTML).toContain('Loading charts');
  expect(PLAYER_APP_HTML).toContain('Chart select');
  expect(PLAYER_APP_HTML).toContain('譜面の読み込み');
  expect(PLAYER_APP_HTML).toContain('リプレイ (<code>*.bmplay.json</code>)');
  expect(PLAYER_APP_HTML).not.toContain('チャート');
  expect(PLAYER_APP_HTML).not.toContain('Loading songs');
});
