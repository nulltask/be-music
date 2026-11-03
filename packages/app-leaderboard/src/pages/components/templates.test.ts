import { expect, test } from 'vite-plus/test';
import { renderHTML } from '@be-music/service-web-theme/server';
import { messagesFor } from '../i18n/index.ts';
import { ShareCard } from './share-card.ts';
import { LocalTime, Toggle } from './basics.ts';

const compact = (html: string) => html.replace(/\s+>/g, '>');

test('share JSON preserves replacement tokens and cannot terminate its script', () => {
  const title = "$& $` $' </script><img src=x onerror=alert(1)>";
  const data = { title };
  const output = renderHTML(
    ShareCard(
      {
        data,
        text: title,
        pageURL: 'https://leaderboard.be-music.app/scores/x',
        image: '/card',
        hasCard: false,
        upload: '/upload?x="<evil>',
      },
      messagesFor('en'),
    ),
  );
  const scripts = [...output.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  expect(scripts).toHaveLength(1);
  expect(JSON.parse(scripts[0]![1]!)).toEqual(data);
  expect(output).not.toContain('<img src=x');
  expect(output).not.toContain('<evil>');
  expect(output).toContain('data-upload="/upload?x=&quot;&lt;evil&gt;"');
});

test('localized templates have no ambient language state and retain htmx link contracts', () => {
  const props = {
    label: 'Anonymous',
    on: true,
    href: '/?anonymous=1&every=1',
    help: 'filters' as const,
    description: '<unsafe>',
  };
  const english = () => compact(renderHTML(Toggle(props, messagesFor('en'))));
  const before = english();
  const japanese = compact(renderHTML(Toggle(props, messagesFor('ja'))));
  const after = english();
  for (const output of [before, japanese, after]) {
    expect(output).toContain('href="/?anonymous=1&amp;every=1"');
    expect(output).toContain('hx-get="/?anonymous=1&amp;every=1"');
    expect(output).toContain('hx-select="main"');
    expect(output).toContain('hx-select-oob="#site-header:outerMorph"');
    expect(output).toContain('hx-swap="outerMorph"');
    expect(output).toContain('hx-push-url="true"');
    expect(output).toContain('aria-checked="true"');
    expect(output).toContain('&lt;unsafe&gt;');
    expect(output).not.toContain('<!--lit-');
  }
  expect(before).toContain(messagesFor('en').help.more);
  expect(japanese).toContain(messagesFor('ja').help.more);
  expect(after).not.toContain(messagesFor('ja').help.more);
});

test('local times keep native UTC fallback markup before the client upgrades', () => {
  const output = renderHTML(LocalTime({ at: Date.UTC(2026, 9, 13, 6, 20), precision: 'relative' }));
  expect(output).toContain('<be-music-local-time');
  expect(output).toContain('precision="relative"');
  expect(output).toMatch(/<time[\s\S]*datetime="2026-10-13T06:20:00.000Z"/);
  expect(output).toContain('2026-10-13 06:20 UTC');
  expect(output).not.toContain('<!--lit-');
});
