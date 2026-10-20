import { describe, expect, test } from 'vite-plus/test';
import { speculationRules } from './speculation.ts';

const BASE = 'https://be-music.example/';

type Predicate =
  | { and: Predicate[] }
  | { or: Predicate[] }
  | { not: Predicate }
  | { href_matches: { pathname: string } }
  | { selector_matches: string };

/** Evaluates a document rule's `where` the way the browser does, for a link to `href` with no attributes. */
function matches(where: Predicate, href: string): boolean {
  if ('and' in where) return where.and.every((p) => matches(p, href));
  if ('or' in where) return where.or.some((p) => matches(p, href));
  if ('not' in where) return !matches(where.not, href);
  if ('href_matches' in where) return new URLPattern({ ...where.href_matches, baseURL: BASE }).test(href, BASE);
  return false;
}

function rule(action?: 'prefetch' | 'prerender') {
  return JSON.parse(speculationRules(action)) as Record<string, { where: Predicate; eagerness: string }[]>;
}

describe('speculationRules', () => {
  test('prefetches with moderate eagerness by default', () => {
    const rules = rule();
    expect(Object.keys(rules)).toEqual(['prefetch']);
    expect(rules.prefetch[0].eagerness).toBe('moderate');
  });

  test('switches to prerender with the same rule', () => {
    expect(rule('prerender').prerender[0]).toEqual(rule().prefetch[0]);
  });

  test.each([
    '/',
    '/?lang=ja',
    '/scores/abc',
    '/charts/0123abcd',
    '/players/someone',
    '/chartsets/42',
    '/help#gauge',
    '/about',
  ])('speculates %s', (path) => {
    expect(matches(rule().prefetch[0].where, new URL(path, BASE).href)).toBe(true);
  });

  test.each([
    // Cookie-writing redirects: a hover must not switch the viewer's rules or language.
    '/ruleset/beatoraja?next=%2F',
    '/lang/en?next=%2Fhelp',
    '/settings',
    '/settings?tab=passkeys',
    '/assets/app.0123.css',
    '/api-reference',
    '/scores/abc/card',
    '/players/someone/avatar',
    '/api/v0/scores',
    '/api/auth/get-session',
  ])('never speculates %s', (path) => {
    expect(matches(rule().prefetch[0].where, new URL(path, BASE).href)).toBe(false);
  });

  test('skips links marked data-no-speculate', () => {
    expect(rule().prefetch[0].where).toMatchObject({
      and: expect.arrayContaining([{ not: { selector_matches: '[data-no-speculate]' } }]),
    });
  });

  test('cannot close its script element', () => {
    expect(speculationRules()).not.toContain('<');
  });
});
