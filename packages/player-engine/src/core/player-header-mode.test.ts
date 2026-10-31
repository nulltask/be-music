import { expect, test } from 'vite-plus/test';
import { parseBMS } from '@be-music/chart-parser';
import { resolveChart } from '@be-music/chart-model';
import { preparePlaybackChart } from './bootstrap.ts';
import { resolveEffectiveBattleMode } from './battle-mode.ts';
import { observePlay } from './characterization/harness.ts';
import { simulateReplay, parseReplay, serializeReplay } from '../replay/index.ts';

const source = '#BPM 120\n#WAV01 a.wav\n#00011:0001\n#00021:00000101';
test('header interpretation is opt-in and explicit selections remain authoritative', () => {
  expect(resolveEffectiveBattleMode('OFF', 'lr2', '14', false, 2)).toBe('OFF');
  expect(resolveEffectiveBattleMode('TWO-PLAYER', 'lr2', '7', false, 2)).toBe('TWO-PLAYER');
  expect(resolveEffectiveBattleMode('D-BATTLE', 'lr2', '7', false, 4)).toBe('D-BATTLE');
  expect(resolveEffectiveBattleMode('AUTO', 'lr2', '14', false, 2)).toBe('COUPLE');
  expect(resolveEffectiveBattleMode('AUTO', 'lr2', '7', false, 4)).toBe('TWO-PLAYER');
  for (const player of [undefined, 1, 3, 9])
    expect(resolveEffectiveBattleMode('AUTO', 'lr2', '7', false, player)).toBe('OFF');
  for (const ruleset of ['beatoraja', '____'] as const)
    expect(resolveEffectiveBattleMode('AUTO', ruleset, '14', false, 2)).toBe('OFF');
  for (const variant of ['9', '24', '48', 'generic-9'] as const)
    expect(resolveEffectiveBattleMode('AUTO', 'lr2', variant, false, 2)).toBe('OFF');
  expect(resolveEffectiveBattleMode('AUTO', 'lr2', '14', true, 2)).toBe('OFF');
});

test('COUPLE preserves authored banks and an empty second side rather than copying SP notes', () => {
  for (const text of [source, '#BPM 120\n#00011:01']) {
    const json = parseBMS(`#PLAYER 2\n${text}`);
    const before = JSON.stringify(json);
    const chart = resolveChart(json);
    const prepared = preparePlaybackChart(chart, { battleMode: 'AUTO' });
    expect(prepared.battleMode).toBe('COUPLE');
    expect(prepared.resolvedChart.playVariant).toBe('10');
    expect(prepared.notes.map((note) => note.channel)).toEqual(chart.notes.map((note) => note.channel));
    expect(prepared.battleChangedObjectCount).toBe(0);
    expect(prepared.laneBindings.some((lane) => lane.side === '2P')).toBe(true);
    expect(JSON.stringify(json)).toBe(before);
  }
});

test('AUTO ignores bmson metadata and preserves explicit OFF', () => {
  const chart = resolveChart(parseBMS(`#PLAYER 2\n${source}`));
  expect(preparePlaybackChart(chart).battleMode).toBeUndefined();
  expect(preparePlaybackChart(chart, { battleMode: 'OFF' }).battleMode).toBe('OFF');
  chart.source.sourceFormat = 'bmson';
  expect(preparePlaybackChart(resolveChart(chart.source), { battleMode: 'AUTO' }).battleMode).toBe('OFF');
});

test('header COUPLE judges separate sides and records a reproducible effective mode', async () => {
  const json = parseBMS(`#PLAYER 2\n${source}`);
  const played = await observePlay({
    driver: 'auto',
    chart: json,
    options: { battleMode: 'AUTO', judgeRuleset: 'lr2' },
  });
  expect(played.outcome).toBe('completed');
  expect(played.summary?.total).toBe(1);
  expect(played.summary?.secondPlayer?.total).toBe(2);
  const replay = parseReplay(serializeReplay(played.replay!));
  expect(replay.play.battleMode).toBe('COUPLE');
  const restored = await observePlay({
    driver: 'auto',
    chart: json,
    options: { battleMode: replay.play.battleMode, judgeRuleset: 'lr2' },
  });
  expect(restored.summary).toEqual(played.summary);
  const old = await observePlay({ driver: 'auto', chart: json, options: { battleMode: 'OFF', judgeRuleset: 'lr2' } });
  expect(old.summary?.secondPlayer).toBeUndefined();
  expect(old.summary?.total).toBe(3);
  expect(() => parseReplay(JSON.stringify({ ...replay, play: { ...replay.play, battleMode: 'AUTO' } }))).toThrow(
    /battleMode/,
  );
});

test('COUPLE replay simulation scores each player independently using its own gauge', async () => {
  const played = await observePlay({
    driver: 'manual',
    chart: parseBMS(`#PLAYER 2\n${source}`),
    options: { battleMode: 'AUTO', judgeRuleset: 'lr2', gauge: 'HARD', gauge2P: 'EASY' },
    script: [
      { atMs: 1000, down: ['11'] },
      { atMs: 1050, up: ['11'] },
      { atMs: 1500, down: ['21'] },
      { atMs: 1550, up: ['21'] },
    ],
  });
  const replay = played.replay!;
  const before = JSON.stringify(replay);
  for (const player of [1, 2] as const) {
    const result = simulateReplay(replay, { ruleset: 'lr2', player });
    const summary = player === 1 ? played.summary! : played.summary!.secondPlayer!;
    expect(result.noteCount).toBe(summary.total);
    expect(result.judge.pgreat).toBe(summary.perfect);
    expect(result.judge.poor).toBe(summary.poor);
    expect(result.exScore).toBe(summary.exScore);
    expect(result.gauge.final).toBeCloseTo(summary.gauge!.current);
  }
  expect(simulateReplay(replay, { ruleset: 'lr2' })).toEqual(simulateReplay(replay, { ruleset: 'lr2', player: 1 }));
  expect(JSON.stringify(replay)).toBe(before);
  expect(() =>
    simulateReplay({ ...replay, play: { ...replay.play, battleMode: 'OFF' } }, { ruleset: 'lr2', player: 2 }),
  ).toThrow(/Player 2/);
});

test('header BATTLE copies SP but preserves both authored banks as explicit Be-Music policy', () => {
  const single = preparePlaybackChart(resolveChart(parseBMS('#PLAYER 4\n#BPM 120\n#00011:01')), { battleMode: 'AUTO' });
  expect(single.battleMode).toBe('TWO-PLAYER');
  expect(single.notes.map((note) => note.channel)).toEqual(['11', '21']);
  const double = preparePlaybackChart(resolveChart(parseBMS(`#PLAYER 4\n${source}`)), { battleMode: 'AUTO' });
  expect(double.notes.map((note) => note.channel)).toEqual(['11', '21', '21']);
});

test('an empty COUPLE side completes without synthesizing notes or a nonfinite gauge', async () => {
  const played = await observePlay({
    driver: 'auto',
    chart: parseBMS('#PLAYER 2\n#BPM 120\n#00011:01'),
    options: { battleMode: 'AUTO' },
  });
  expect(played.outcome).toBe('completed');
  expect(played.summary?.total).toBe(1);
  expect(played.summary?.secondPlayer?.total).toBe(0);
  expect(Number.isFinite(played.summary?.secondPlayer?.gauge?.current)).toBe(true);
  expect(simulateReplay(played.replay!, { ruleset: 'lr2', player: 2 }).noteCount).toBe(0);
});
