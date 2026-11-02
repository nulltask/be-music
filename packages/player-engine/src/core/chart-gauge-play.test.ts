import { expect, test } from 'vite-plus/test';
import { parseBMS } from '@be-music/chart-parser';
import { parseReplay, serializeReplay } from '../replay/format.ts';
import { simulateReplay } from '../replay/simulate.ts';
import { observePlay, tap } from './characterization/harness.ts';

const chart = (...options: string[]) =>
  parseBMS(
    ['#BPM 120', '#WAV01 note.wav', ...options.map((option) => `#OPTION ${option}`), '#00111:01010101', ''].join('\n'),
  );
// Hits the first two notes and misses the last two.
const script = [...tap(2000, '11'), ...tap(2500, '11')];

test('chart HYPER plays and records HARD over the player GROOVE, and the replay re-simulates on it', async () => {
  const plain = await observePlay({ driver: 'manual', chart: chart(), script, options: { gauge: 'GROOVE' } });
  const result = await observePlay({
    driver: 'manual',
    chart: chart('774:GAMELEVEL_HYPER'),
    script,
    options: { gauge: 'GROOVE' },
  });
  expect(plain.replay?.play.gauge).toBe('GROOVE');
  expect(result.replay?.play.gauge).toBe('HARD');
  expect(result.summary?.gauge?.type).toBe('HARD');
  expect(result.summary?.gauge?.current).not.toBe(plain.summary?.gauge?.current);
  const saved = parseReplay(serializeReplay(result.replay!));
  // Replay equivalence: the recorded gauge is the one the play ran on.
  expect(simulateReplay(saved, { ruleset: 'lr2' }).gauge.final).toBeCloseTo(result.summary!.gauge!.current, 6);
});

test('the ruleset picks its own gauge for the pair', async () => {
  const result = await observePlay({
    driver: 'manual',
    chart: chart('774:GAMELEVEL_NORMAL', '774:EXTRA_EASY'),
    script,
    options: { judgeRuleset: 'beatoraja', gauge: 'HARD' },
  });
  expect(result.replay?.play.gauge).toBe('EASY');
  expect(result.summary?.gauge?.type).toBe('EASY');
});

test('a course stage keeps its course gauge, and a replay keeps its recorded gauge', async () => {
  const course = await observePlay({
    driver: 'manual',
    chart: chart('774:GAMELEVEL_DANGER'),
    script,
    options: { gauge: 'GROOVE', course: { kind: 'grade' } },
  });
  expect(course.replay?.play.gauge).toBe('GROOVE');
  const replayed = await observePlay({
    driver: 'manual',
    chart: chart('774:GAMELEVEL_DANGER'),
    options: { gauge: 'EASY', replayInputs: [] },
  });
  expect(replayed.replay?.play.gauge).toBe('EASY');
});
