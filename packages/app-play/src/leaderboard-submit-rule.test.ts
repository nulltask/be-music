import { describe, expect, test } from 'vite-plus/test';
import {
  DEFAULT_LEADERBOARD_SUBMIT_RULE,
  LEADERBOARD_SUBMIT_RULES,
  shouldSubmitPlay,
} from './leaderboard-submit-rule.ts';

describe('shouldSubmitPlay', () => {
  test('sends every play under "always"', () => {
    expect(shouldSubmitPlay('always', 1000, 1200)).toBe(true);
    expect(shouldSubmitPlay('always', 1200, 1200)).toBe(true);
    expect(shouldSubmitPlay('always', 1300, 1200)).toBe(true);
    expect(shouldSubmitPlay('always', 0, undefined)).toBe(true);
  });

  test('sends a play that beats the previous best EX-SCORE under "improved"', () => {
    expect(shouldSubmitPlay('improved', 1201, 1200)).toBe(true);
  });

  test('holds back a play that ties or falls short of the previous best under "improved"', () => {
    expect(shouldSubmitPlay('improved', 1200, 1200)).toBe(false);
    expect(shouldSubmitPlay('improved', 900, 1200)).toBe(false);
    expect(shouldSubmitPlay('improved', 0, 0)).toBe(false);
  });

  test('sends the first play of a chart under "improved"', () => {
    expect(shouldSubmitPlay('improved', 0, undefined)).toBe(true);
    expect(shouldSubmitPlay('improved', 1500, undefined)).toBe(true);
  });

  test('sends a play whose EX-SCORE is unknown', () => {
    expect(shouldSubmitPlay('improved', undefined, 1200)).toBe(true);
  });
});

describe('leaderboard submit rules', () => {
  test('default to sending improvements, and list both rules', () => {
    expect(DEFAULT_LEADERBOARD_SUBMIT_RULE).toBe('improved');
    expect(LEADERBOARD_SUBMIT_RULES).toEqual(['improved', 'always']);
  });
});
