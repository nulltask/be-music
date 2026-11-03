import { html } from 'lit';
import { render } from '@lit-labs/ssr';
import { collectResultSync } from '@lit-labs/ssr/lib/render-result.js';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import * as playerCopy from '../player-copy.ts';
import { localized } from './localized.ts';

afterEach(() => {
  vi.restoreAllMocks();
  playerCopy.setPlayerLang('en');
});

test('renders catalog text in the current language and does not subscribe during SSR', () => {
  const subscribe = vi.spyOn(playerCopy, 'onPlayerLangChange');
  expect(collectResultSync(render(html`<p>${localized('dropTitle')}</p>`))).toContain('Drop to load');
  playerCopy.setPlayerLang('ja');
  expect(collectResultSync(render(html`<p>${localized('dropTitle')}</p>`))).toContain('ドロップして読み込む');
  expect(subscribe).not.toHaveBeenCalled();
});

test('a localized callback can render a template rather than an escaped string', () => {
  playerCopy.setPlayerLang('ja');
  expect(
    collectResultSync(render(html`${localized(() => html`<b>${playerCopy.playerText().shell.close}</b>`)}`)).replace(
      /<!--[\s\S]*?-->/g,
      '',
    ),
  ).toContain('<b>閉じる</b>');
});
