import { renderServiceFooter as renderFooter } from './server.ts';
import { describe, expect, test } from 'vite-plus/test';
import { SERVICE_CSS } from './index.ts';
import {
  SERVICE_COPYRIGHT,
  SERVICE_FOOTER_CLASS,
  SERVICE_FOOTER_COLUMNS_CLASS,
  SERVICE_FOOTER_LINK_CLASS,
  serviceOrigins,
  serviceSite,
} from './footer.ts';

const renderServiceFooter = (input: Parameters<typeof renderFooter>[0] = {}) =>
  renderFooter(input).replace(/\s+/g, ' ').replace(/>\s+</g, '><').replace(/\s+>/g, '>');

describe('serviceSite', () => {
  test('keeps each environment with its own siblings', () => {
    expect(serviceSite('be-music.app')).toBe('be-music.app');
    expect(serviceSite('preview.be-music.app')).toBe('preview.be-music.app');
    expect(serviceSite('accounts.be-music.app')).toBe('be-music.app');
    expect(serviceSite('accounts.preview.be-music.app')).toBe('preview.be-music.app');
    expect(serviceSite('play.preview.be-music.app')).toBe('preview.be-music.app');
    expect(serviceSite('leaderboard.be-music.app')).toBe('be-music.app');
    expect(serviceSite('donate.preview.be-music.app')).toBe('preview.be-music.app');
    expect(serviceSite('PLAY.be-music.app')).toBe('be-music.app');
  });

  test('follows a branch Preview of the preview Player and uses production elsewhere', () => {
    expect(serviceSite('feature-x-play-preview.be-music.workers.dev')).toBe('preview.be-music.app');
    expect(serviceSite('localhost')).toBe('be-music.app');
    expect(serviceSite('leaderboard.example')).toBe('example');
  });
});

describe('serviceOrigins', () => {
  test('links the four services of the same environment', () => {
    expect(serviceOrigins('play.be-music.app')).toEqual({
      dashboard: 'https://be-music.app/',
      accounts: 'https://be-music.app/account',
      play: 'https://play.be-music.app/',
      leaderboard: 'https://leaderboard.be-music.app/',
    });
    expect(serviceOrigins('leaderboard.preview.be-music.app').play).toBe('https://play.preview.be-music.app/');
    expect(serviceOrigins('localhost').dashboard).toBe('https://be-music.app/');
  });
});

describe('renderServiceFooter', () => {
  test('links the other services and leaves the current one as text', () => {
    const html = renderServiceFooter({ current: 'accounts', hostname: 'accounts.preview.be-music.app' });
    expect(html).toContain(`class="${SERVICE_FOOTER_CLASS}"`);
    expect(html).toContain('<span aria-current="page">Accounts</span>');
    expect(html).not.toContain('>Accounts</a>');
    expect(html).toContain(
      `<a class="${SERVICE_FOOTER_LINK_CLASS}" data-service="dashboard" href="https://preview.be-music.app/">Dashboard</a>`,
    );
    expect(html).toContain('href="https://play.preview.be-music.app/">Play</a>');
    expect(html).toContain('href="https://leaderboard.preview.be-music.app/">Leaderboard</a>');
    expect(html).not.toContain('Donate');
    expect(html).toContain(`<p>${SERVICE_COPYRIGHT}</p>`);
    expect(html).toContain('<p lang="en">Public Beta. Data may be deleted without notice.</p>');
    expect(html.indexOf('Public Beta. Data may be deleted without notice.')).toBeLessThan(html.indexOf('<nav'));
    expect(html).not.toContain('>beta</span>');
    expect(html).not.toContain('>Beta</span>');
    expect(html).not.toContain('パブリックベータ');
  });

  test('states Public Beta in the page language, or both languages for the player', () => {
    const japanese = renderServiceFooter({ current: 'dashboard', locale: 'ja' });
    expect(japanese).toContain('<p lang="ja">パブリックベータのためデータは予告なく削除されることがあります。</p>');
    expect(japanese).not.toContain('Public Beta');
    const both = renderServiceFooter({ current: 'play', locale: 'both' });
    expect(both).toContain(
      '<p data-public-beta-notice="en" lang="en">Public Beta. Data may be deleted without notice.</p>',
    );
    expect(both).toContain(
      '<p data-public-beta-notice="ja" lang="ja" hidden>パブリックベータのためデータは予告なく削除されることがあります。</p>',
    );
    expect(both.indexOf('data-public-beta-notice="en"')).toBeLessThan(both.indexOf('data-public-beta-notice="ja"'));
  });

  test('lays out the build line, links, and copyright in one full-width row', () => {
    const html = renderServiceFooter({
      current: 'play',
      layout: 'columns',
      publicBeta: false,
      buildInfo: { builtAt: '2026-11-02T18:28:10Z', revision: 'c1013c20aaaa' },
    });
    expect(html).toContain(`class="${SERVICE_FOOTER_COLUMNS_CLASS}"`);
    expect(SERVICE_FOOTER_COLUMNS_CLASS).toContain('w-full');
    expect(SERVICE_FOOTER_COLUMNS_CLASS).not.toContain('max-w-');
    expect(html).not.toContain('Public Beta');
    expect(html).toContain('<div class="sm:justify-self-start"><span class="build-info">Built ');
    expect(html).toContain(`<p class="sm:justify-self-end">${SERVICE_COPYRIGHT}</p>`);
    expect(html.indexOf('build-info')).toBeLessThan(html.indexOf('<nav'));
    expect(html.indexOf('<nav')).toBeLessThan(html.indexOf(SERVICE_COPYRIGHT));
  });

  test('keeps the Public Beta line above the columns, across the row', () => {
    const html = renderServiceFooter({ layout: 'columns', siteHTML: 'Be-Music' });
    expect(html).toContain(
      '<div class="sm:col-span-3"><p lang="en">Public Beta. Data may be deleted without notice.</p></div>',
    );
    expect(html).toContain(`<p class="sm:justify-self-end">Be-Music · ${SERVICE_COPYRIGHT}</p>`);
  });

  test('keeps a configured origin and escapes it', () => {
    const html = renderServiceFooter({
      current: 'dashboard',
      hostname: 'be-music.app',
      origins: { play: 'https://play.example/?a=1&b="<' },
    });
    expect(html).toContain('href="https://play.example/?a=1&amp;b=&quot;&lt;">Play</a>');
    expect(html).toContain('href="https://leaderboard.be-music.app/">Leaderboard</a>');
    expect(html).toContain('<span aria-current="page">Dashboard</span>');
  });

  test('orders site content, copyright, and the build line', () => {
    const html = renderServiceFooter({
      current: 'leaderboard',
      hostname: 'leaderboard.be-music.app',
      navLabel: 'サービス',
      siteHTML: '<a href="/about">About</a>',
      buildInfo: { builtAt: '2026-10-20T08:00:00Z', revision: '0123456789abcdef' },
    });
    const nav = html.indexOf('<nav');
    const site = html.indexOf('<div class="space-y-2"><a href="/about">About</a></div>');
    const copyright = html.indexOf(SERVICE_COPYRIGHT);
    const built = html.indexOf('2026-10-20 08:00:00 UTC');
    expect(nav).toBeGreaterThan(-1);
    expect(nav).toBeLessThan(site);
    expect(site).toBeLessThan(copyright);
    expect(copyright).toBeLessThan(built);
    expect(html).toContain('aria-label="サービス"');
    expect(html).toContain('>01234567</code>');
    expect(html).toContain('<span aria-current="page">Leaderboard</span>');
  });

  test('omits an empty site row and an absent build line', () => {
    const html = renderServiceFooter({ current: 'play', hostname: 'play.be-music.app', siteHTML: '' });
    expect(html).not.toContain('<div class="space-y-2">');
    expect(html).not.toContain('build-info');
    expect(html).not.toContain('service-page-footer');
    expect(renderServiceFooter({ current: 'play', className: 'service-page-footer' })).toContain('service-page-footer');
  });

  test('on Donate, every one of the four services is a link', () => {
    const html = renderServiceFooter({ hostname: 'donate.be-music.app' });
    for (const label of ['Dashboard', 'Accounts', 'Play', 'Leaderboard']) {
      expect(html).toContain(`>${label}</a>`);
      expect(html).not.toContain(`>${label}</span>`);
    }
  });
});

describe('footer classes in the shared stylesheet', () => {
  test('compiles the footer utilities Accounts and Dashboard inline', () => {
    expect(SERVICE_CSS).toContain('.space-y-2');
    expect(SERVICE_CSS).toContain('.underline-offset-4');
  });
});
