import { describe, expect, test } from 'vite-plus/test';
import { splitLinkedText, type BeMusicTextRun } from './linkify.ts';

const joined = (runs: readonly BeMusicTextRun[]): string => runs.map((run) => run.text).join('');
const links = (text: string): string[] =>
  splitLinkedText(text).flatMap((run) => (run.kind === 'link' ? [run.href] : []));

describe('splitLinkedText', () => {
  test('keeps a text without addresses as one run', () => {
    expect(splitLinkedText('BGA: someone\nObjects: someone else')).toEqual([
      { kind: 'text', text: 'BGA: someone\nObjects: someone else' },
    ]);
  });

  test('returns no runs for an empty text', () => {
    expect(splitLinkedText('')).toEqual([]);
  });

  test('splits a web address out of the text around it', () => {
    expect(splitLinkedText('Site: https://example.com/bms/ (mirror)')).toEqual([
      { kind: 'text', text: 'Site: ' },
      { kind: 'link', text: 'https://example.com/bms/', href: 'https://example.com/bms/' },
      { kind: 'text', text: ' (mirror)' },
    ]);
  });

  test('joins back to the original text', () => {
    const text = 'URL：http://example.jp/~author/index.html。\nmail: author@example.jp, www.example.org.';
    expect(joined(splitLinkedText(text))).toBe(text);
  });

  test('ends an address at the Japanese text after it', () => {
    expect(links('配布先はhttps://example.com/bmsです。')).toEqual(['https://example.com/bms']);
  });

  test('leaves sentence punctuation and an unmatched closing bracket out of the address', () => {
    expect(links('See https://example.com/a.')).toEqual(['https://example.com/a']);
    expect(links('(see https://example.com/b)')).toEqual(['https://example.com/b']);
    expect(links('"https://example.com/c",')).toEqual(['https://example.com/c']);
  });

  test('keeps brackets that the address itself pairs', () => {
    expect(links('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)']);
  });

  test('keeps the query and fragment', () => {
    expect(links('https://example.com/?a=1&b=2#top')).toEqual(['https://example.com/?a=1&b=2#top']);
  });

  test('completes a ttp:// address and a bare www. one', () => {
    expect(links('ttp://example.com/x')).toEqual(['http://example.com/x']);
    expect(links('ttps://example.com/y')).toEqual(['https://example.com/y']);
    expect(links('www.example.com/z')).toEqual(['https://www.example.com/z']);
  });

  test('keeps the text a ttp:// link shows as written', () => {
    expect(splitLinkedText('ttp://example.com')).toEqual([
      { kind: 'link', text: 'ttp://example.com', href: 'http://example.com' },
    ]);
  });

  test('links a mail address with mailto:', () => {
    expect(splitLinkedText('contact: author.name+bms@example.co.jp')).toEqual([
      { kind: 'text', text: 'contact: ' },
      { kind: 'link', text: 'author.name+bms@example.co.jp', href: 'mailto:author.name+bms@example.co.jp' },
    ]);
  });

  test('does not link a scheme with nothing after it, or an @ handle', () => {
    expect(links('https:// and www. and @someone')).toEqual([]);
  });

  test('never builds an address with another scheme', () => {
    expect(links('javascript:alert(1) data:text/html,<b>x</b> file:///etc/passwd')).toEqual([]);
  });

  test('keeps markup as plain text', () => {
    const runs = splitLinkedText('<a href="javascript:alert(1)">https://example.com/<b></a>');
    expect(runs.filter((run) => run.kind === 'link')).toEqual([
      { kind: 'link', text: 'https://example.com/', href: 'https://example.com/' },
    ]);
    expect(joined(runs)).toBe('<a href="javascript:alert(1)">https://example.com/<b></a>');
  });

  test('finds several addresses in order', () => {
    expect(links('a https://one.example b http://two.example c three@example.com')).toEqual([
      'https://one.example',
      'http://two.example',
      'mailto:three@example.com',
    ]);
  });
});
