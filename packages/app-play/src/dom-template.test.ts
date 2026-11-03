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
  // Build line on the left, service links in the centre, copyright on the right.
  expect(footer.indexOf('class="build-info"')).toBeLessThan(footer.indexOf('<nav'));
  expect(footer.indexOf('<nav')).toBeLessThan(footer.indexOf('© 2026 nulltask'));
  // Public Beta sits in the drop card, not the footer.
  expect(footer).not.toContain('data-public-beta-notice');
  const dropCard = PLAYER_APP_HTML.slice(
    PLAYER_APP_HTML.indexOf('class="card drop-card'),
    PLAYER_APP_HTML.indexOf('id="leaderboard-sign-in"'),
  );
  expect(dropCard).toContain(
    '<p data-public-beta-notice="en" lang="en">Public Beta. Data may be deleted without notice.</p>',
  );
  expect(dropCard).toContain(
    '<p data-public-beta-notice="ja" lang="ja" hidden>パブリックベータのためデータは予告なく削除されることがあります。</p>',
  );
  expect(footer).not.toContain('>beta</span>');
  expect(footer).not.toContain('>Beta</span>');
  expect(PLAYER_APP_HTML).toContain('id="player-service-header"');
  const mainStart = PLAYER_APP_HTML.indexOf('<main id="main"');
  const mainEnd = PLAYER_APP_HTML.lastIndexOf('</main>');
  const main = PLAYER_APP_HTML.slice(mainStart, mainEnd);
  expect(mainStart).toBeGreaterThan(PLAYER_APP_HTML.indexOf('id="player-service-header"'));
  expect(main).not.toContain('service-page-footer');
  expect(main).not.toContain('id="player-service-header"');
  expect(PLAYER_APP_HTML.indexOf('service-page-footer')).toBeGreaterThan(mainEnd);
  const header = PLAYER_APP_HTML.slice(
    PLAYER_APP_HTML.indexOf('id="player-service-header"'),
    PLAYER_APP_HTML.indexOf('<main id="main"'),
  );
  expect(header).toContain('class="flex items-center gap-x-3 px-4 py-2.5 sm:gap-x-6"');
  expect(header).not.toContain('max-w-5xl');
  expect(header).not.toContain('mx-auto');
  expect(PLAYER_APP_HTML).toContain(
    '>Be-Music Play</a><span class="badge max-sm:hidden" data-variant="outline">Beta</span>',
  );
  expect(PLAYER_APP_HTML).toContain('data-service-header="settings"');
  expect(PLAYER_APP_HTML).toContain('aria-label="Settings"');
  expect(PLAYER_APP_HTML).toContain('data-service-header="fullscreen"');
  expect(PLAYER_APP_HTML).toContain('aria-label="Full screen"');
  expect(PLAYER_APP_HTML).not.toContain('lucide-play');
  expect(PLAYER_APP_HTML).not.toContain('id="account-chip"');
  expect(PLAYER_APP_HTML).not.toContain('player-brand');
  expect(PLAYER_APP_HTML).toContain(
    '<h2 class="flex items-center gap-2" id="help-modal-title"><span>Be-Music Play</span><span class="badge" data-variant="outline">Beta</span></h2>',
  );
  expect(PLAYER_APP_HTML.match(/<span class="badge/g)).toHaveLength(2);
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

test('builds Help as a Basecoat dialog with Basecoat tabs', async () => {
  const { PLAYER_APP_HTML } = await import('./dom-template.ts');
  const help = PLAYER_APP_HTML.slice(
    PLAYER_APP_HTML.indexOf('<dialog class="dialog help-dialog" id="help-modal"'),
    PLAYER_APP_HTML.indexOf('</dialog>', PLAYER_APP_HTML.indexOf('id="help-modal"')),
  );
  expect(help).toContain('aria-labelledby="help-modal-title" aria-describedby="help-modal-description"');
  expect(help).toContain('<section class="tabs help-tabs">');
  expect(help).toContain('<nav role="tablist" aria-orientation="horizontal">');
  expect(help.match(/role="tab" /g)).toHaveLength(3);
  expect(help).toContain('id="help-tab-usage" aria-controls="help-pane-usage" aria-selected="true" tabindex="0"');
  expect(help.match(/role="tabpanel"/g)).toHaveLength(3);
  expect(help).toContain(
    'id="help-pane-oss" aria-labelledby="help-tab-oss" tabindex="-1" aria-selected="false" hidden',
  );
  expect(help.match(/class="button-group help-lang-switch"/g)).toHaveLength(2);
  expect(help).toContain('<button type="button" id="help-modal-close" aria-label="Close"');
  expect(help).not.toContain('help-modal-backdrop');
});
