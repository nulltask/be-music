import { collectResultSync } from '@lit-labs/ssr/lib/render-result.js';
import { render } from '@lit-labs/ssr';
import { afterEach, expect, test, vi } from 'vite-plus/test';

/** Normalize Lit boundary comments and source formatting for markup assertions. */
async function shellHTML(): Promise<string> {
  const { PLAYER_APP_TEMPLATE } = await import('./dom-template.ts');
  return collectResultSync(render(PLAYER_APP_TEMPLATE))
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .replace(/\s+>/g, '>');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
test('shows fixed build metadata in the page footer and the help overlay', async () => {
  vi.stubGlobal('__BE_MUSIC_BUILD_TIME__', '2026-10-20T08:00:00Z');
  vi.stubGlobal('__BE_MUSIC_BUILD_REVISION__', '0123456789abcdef');
  const pageHTML = await shellHTML();
  expect(pageHTML.match(/2026-10-20 08:00:00 UTC/g)).toHaveLength(2);
  expect(pageHTML.match(/>01234567<\/code>/g)).toHaveLength(2);
  expect(pageHTML).toContain('class="service-build-footer"');
  const footer = pageHTML.slice(pageHTML.lastIndexOf('<footer'));
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
  const dropCard = pageHTML.slice(
    pageHTML.indexOf('class="card drop-card'),
    pageHTML.indexOf('id="leaderboard-sign-in"'),
  );
  expect(dropCard).toContain(
    '<p data-public-beta-notice="en" lang="en">Public Beta. Data may be deleted without notice.</p>',
  );
  expect(dropCard).toContain(
    '<p data-public-beta-notice="ja" lang="ja" hidden>パブリックベータのためデータは予告なく削除されることがあります。</p>',
  );
  expect(footer).not.toContain('>beta</span>');
  expect(footer).not.toContain('>Beta</span>');
  expect(pageHTML).toContain('id="player-service-header"');
  const mainStart = pageHTML.indexOf('<main id="main"');
  const mainEnd = pageHTML.lastIndexOf('</main>');
  const main = pageHTML.slice(mainStart, mainEnd);
  expect(mainStart).toBeGreaterThan(pageHTML.indexOf('id="player-service-header"'));
  expect(main).not.toContain('service-page-footer');
  expect(main).not.toContain('id="player-service-header"');
  expect(pageHTML.indexOf('service-page-footer')).toBeGreaterThan(mainEnd);
  // The shell reserves a host; the bootstrap mounts this view into it exactly once.
  expect(pageHTML).toContain('<div id="player-service-header" class="player-service-header"></div>');
  const { playerServiceHeaderTemplate } = await import('./player-header.ts');
  const header = collectResultSync(
    render(playerServiceHeaderTemplate({ locale: 'en', hostname: 'localhost', requestURL: '/' })),
  )
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .replace(/\s+>/g, '>');
  expect(header).toContain('class="flex items-center gap-x-3 px-4 py-2.5 sm:gap-x-6"');
  expect(header).not.toContain('max-w-5xl');
  expect(header).not.toContain('mx-auto');
  expect(header).toContain('>Be-Music Play</a><span class="badge max-sm:hidden" data-variant="outline">Beta</span>');
  expect(header).toContain('data-service-header="settings"');
  expect(header).toContain('aria-label="Settings"');
  expect(header).toContain('data-service-header="fullscreen"');
  expect(header).toContain('aria-label="Full screen"');
  expect(pageHTML).not.toContain('lucide-play');
  expect(pageHTML).not.toContain('id="account-chip"');
  expect(pageHTML).not.toContain('player-brand');
  expect(pageHTML).toContain(
    '<h2 class="flex items-center gap-2" id="help-modal-title"><span>Be-Music Play</span><span class="badge" data-variant="outline">Beta</span></h2>',
  );
  expect((pageHTML + header).match(/<span class="badge/g)).toHaveLength(2);
});

test('uses chart and replay vocabulary in bilingual help', async () => {
  const pageHTML = await shellHTML();
  expect(pageHTML).toContain('Loading charts');
  expect(pageHTML).toContain('Chart select');
  expect(pageHTML).toContain('譜面の読み込み');
  expect(pageHTML).toContain('リプレイ (<code>*.bmplay.json</code>、コースは <code>*.bmcourse.json</code>)');
  expect(pageHTML).not.toContain('チャート');
  expect(pageHTML).not.toContain('Loading songs');
  expect(pageHTML).toContain('is a Public Beta: its rankings may be reset.');
  expect(pageHTML).toContain('Data may be deleted without notice.');
  expect(pageHTML).toContain(
    'はパブリックベータで、ランキングはリセットされることがあります。データは予告なく削除されることがあります。',
  );
  expect(pageHTML).not.toContain('is a beta:');
  expect(pageHTML).not.toContain('ベータ版');
});

test('builds Help as a Basecoat dialog with Basecoat tabs', async () => {
  const pageHTML = await shellHTML();
  const help = pageHTML.slice(
    pageHTML.indexOf('<dialog class="dialog help-dialog" id="help-modal"'),
    pageHTML.indexOf('</dialog>', pageHTML.indexOf('id="help-modal"')),
  );
  expect(help).toContain('aria-labelledby="help-modal-title" aria-describedby="help-modal-description"');
  expect(help).toContain('<section class="tabs help-tabs">');
  expect(help).toContain('<nav role="tablist" aria-orientation="horizontal">');
  expect(help.match(/role="tab" /g)).toHaveLength(3);
  expect(help).toContain('id="help-tab-usage" aria-controls="help-pane-usage" aria-selected="true" tabindex="0"');
  expect(help).toMatch(/id="help-tab-keyboard"[^>]*>\s*Keyboard\s*<\/button>/);
  expect(help.match(/role="tabpanel"/g)).toHaveLength(3);
  expect(help).toContain(
    'id="help-pane-keyboard" aria-labelledby="help-tab-keyboard" tabindex="-1" aria-selected="false" hidden',
  );
  expect(help).toContain(
    'id="help-pane-oss" aria-labelledby="help-tab-oss" tabindex="-1" aria-selected="false" hidden',
  );
  expect(help.match(/class="button-group help-lang-switch"/g)).toHaveLength(1);
  const header = help.slice(help.indexOf('<header>'), help.indexOf('</header>'));
  expect(header).toContain('class="help-heading-row"');
  expect(header).toContain('id="help-modal-description"');
  expect(header).toContain('class="button-group help-lang-switch"');
  expect(help).toMatch(/id="help-tab-oss"[^>]*>\s*Acknowledgements\s*<\/button>/);
  expect(help).not.toContain('help-tab-options');
  expect(help).not.toContain('options-help-content');
  expect(pageHTML).toContain('<div id="options-help-content" hidden>');
  expect(help).toContain('<button type="button" id="help-modal-close" aria-label="Close"');
  expect(help).not.toContain('help-modal-backdrop');
});
