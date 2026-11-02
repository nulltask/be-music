import { afterEach, expect, test } from 'vite-plus/test';
import { describeProfileError, describeStartAccount } from './account.ts';
import { describeLeaderboardResult } from './leaderboard.ts';
import { onPlayerLangChange, playerText, resolvePlayerLang, setPlayerLang } from './player-copy.ts';

afterEach(() => {
  setPlayerLang('en');
});

test('rebuilds views that listen when the language changes', () => {
  let seen = '';
  const stop = onPlayerLangChange(() => {
    seen = playerText().shell.help;
  });
  setPlayerLang('ja');
  expect(seen).toBe('ヘルプ');
  stop();
  setPlayerLang('en');
  expect(seen).toBe('ヘルプ');
});

test('treats ja locales as Japanese and everything else as English', () => {
  expect(resolvePlayerLang('ja-JP')).toBe('ja');
  expect(resolvePlayerLang('en-US')).toBe('en');
  expect(resolvePlayerLang(undefined)).toBe('en');
});

test('says the same facts in Japanese for the shell, account and a leaderboard result', () => {
  expect(playerText().shell.dropTitle).toBe('Drop to load');
  expect(playerText().replay.notLoaded('Twin')).toBe('Replay: chart not loaded (Twin)');
  setPlayerLang('ja');
  expect(playerText().shell.dropTitle).toBe('ドロップして読み込む');
  expect(playerText().shell.help).toBe('ヘルプ');
  expect(playerText().phases.parsing).toContain('譜面');
  expect(playerText().replay.notLoaded('Twin')).toContain('譜面');
  expect(playerText().course.making).toContain('譜面');
  expect(playerText().course.making).not.toContain('曲');
  expect(describeStartAccount(undefined).label).toBe('ログインしていません');
  expect(describeStartAccount(undefined).hint).toContain('ゲスト');
  expect(describeProfileError('handle-taken')).toBe('このユーザー名はすでに使われています。');
  expect(describeProfileError('sign-in-required')).toBe('先にログインしてください。');
  expect(
    describeLeaderboardResult(
      {
        status: 'accepted',
        scoreId: 's',
        results: [
          {
            ruleset: 'lr2',
            exScore: 10,
            clearLamp: 5,
            missCount: 0,
            rank: 1,
            players: 2,
            improved: { exScore: true, lamp: true, missCount: false },
          },
        ],
      },
      'lr2',
    ),
  ).toBe('Leaderboard lr2: #1 / 2 · EX 10 · 自己ベスト更新 EX / ランプ');
});
