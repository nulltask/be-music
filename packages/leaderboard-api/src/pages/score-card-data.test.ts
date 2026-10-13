import { describe, expect, test } from 'vite-plus/test';
import { shareText, xIntentUrl } from './score-card-data.ts';

describe('sharing a play', () => {
  const play = {
    title: 'two notes disko',
    lamp: { label: 'FULL COMBO', color: '#22d3ee' },
    djRank: 'AA',
    exScore: 81,
    maxExScore: 104,
    rate: '77.88%',
    rulesetLabel: 'LR2',
  };

  test('the text names the chart, lamp, DJ Rank, EX-Score and ruleset', () => {
    expect(shareText(play)).toBe('two notes disko — FULL COMBO · AA · EX 81/104 (77.88%) [LR2]');
  });

  test('the X post carries the text, the page and #bemusic', () => {
    const url = new URL(xIntentUrl(shareText(play), 'https://example.test/leaderboard/scores/s1'));
    expect(url.origin + url.pathname).toBe('https://x.com/intent/post');
    expect(url.searchParams.get('text')).toBe(shareText(play));
    expect(url.searchParams.get('url')).toBe('https://example.test/leaderboard/scores/s1');
    expect(url.searchParams.get('hashtags')).toBe('bemusic');
  });
});
