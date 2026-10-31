import { describe, expect, test } from 'vite-plus/test';
import { partialLinkAttributes, PARTIAL_SELECT_OOB, SITE_HEADER_ID } from './partial-swap.ts';

describe('partialLinkAttributes', () => {
  test('fetches the link and morphs the page body and the header in place, pushing the URL', () => {
    expect(partialLinkAttributes('/charts/x?every=1')).toEqual({
      'hx-get': '/charts/x?every=1',
      'hx-target': 'main',
      'hx-select': 'main',
      'hx-swap': 'outerMorph',
      'hx-select-oob': '#site-header:outerMorph',
      'hx-sync': 'main:replace',
      'hx-indicator': 'main',
      'hx-push-url': 'true',
    });
  });

  test('leaves the address alone when asked', () => {
    expect(partialLinkAttributes('/ruleset/lr2?next=%2F', { push: false })).not.toHaveProperty('hx-push-url');
  });

  test('selects the header by the id the layout gives it', () => {
    expect(PARTIAL_SELECT_OOB.startsWith(`#${SITE_HEADER_ID}:`)).toBe(true);
  });
});
