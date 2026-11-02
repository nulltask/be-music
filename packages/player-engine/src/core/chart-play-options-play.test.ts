import { expect, test } from 'vite-plus/test';
import { parseBMS } from '@be-music/chart-parser';
import { classifyReplayAssists } from '../records/assist-policy.ts';
import { checkReplayEligibility } from '../replay/eligibility.ts';
import { parseReplay, serializeReplay } from '../replay/format.ts';
import { simulateReplay } from '../replay/simulate.ts';
import { observePlay, tap } from './characterization/harness.ts';

// One note at 2 s, hit 55 ms late: a GOOD under LR2's NORMAL windows (GREAT 40 ms, GOOD 100 ms), and past the GOOD
// window HELLJUDGE halves to 50 ms.
const chart = (...options: string[]) =>
  parseBMS(
    ['#BPM 120', '#WAV01 note.wav', ...options.map((option) => `#OPTION ${option}`), '#00111:01', ''].join('\n'),
  );
const script = tap(2055, '11');

test.each([
  ['774:CRAZY_GOOD2BAD', 'bad'],
  ['774:CRAZY_HELLJUDGE', 'bad'],
  ['774:CRAZY_GREAT2BAD', 'bad'],
] as const)('%s turns the late GOOD into a BAD, and the replay re-simulates it', async (option, kind) => {
  const baseline = await observePlay({ driver: 'manual', chart: chart(), script });
  expect(baseline.summary?.good).toBe(1);
  const result = await observePlay({ driver: 'manual', chart: chart(option), script });
  expect(result.outcome).toBe('completed');
  expect(result.summary?.good).toBe(0);
  expect(result.summary?.[kind]).toBe(1);
  const saved = parseReplay(serializeReplay(result.replay!));
  expect(saved.chart.chartPlayOptions).toEqual({
    version: 1,
    options: option === '774:CRAZY_HELLJUDGE' ? { hellJudge: true } : { judge: option.slice(10) },
  });
  // Replay equivalence: the server's re-simulation applies the recorded modifier.
  expect(simulateReplay(saved, { ruleset: 'lr2' }).judge).toMatchObject({ good: 0, [kind]: 1 });
  expect(result.simulated?.lr2?.judge).toMatchObject({ good: 0, [kind]: 1 });
  // Chart-authored, so not the player's assist: eligibility and class are the baseline's.
  expect(classifyReplayAssists(saved)).toEqual([]);
  const eligibility = checkReplayEligibility(saved);
  expect(eligibility.eligible && eligibility.assistClass).toBe('none');
});

test('a recorded program wins over the source, so an older replay without one keeps its judgments', async () => {
  const result = await observePlay({
    driver: 'manual',
    chart: chart('774:CRAZY_GOOD2BAD'),
    script,
    options: { chartPlayOptionProgram: { version: 1, options: {} } },
  });
  expect(result.summary?.good).toBe(1);
  expect(result.replay?.chart.chartPlayOptions).toBeUndefined();
});

test('arrangement-only programs are recorded, arrange the engine-prepared chart and change no judge window', async () => {
  // The engine prepares the chart itself (as the terminal plays): the 5 KEY note on key 1 is mirrored onto key 5.
  const result = await observePlay({ driver: 'manual', chart: chart('774:RANDOM_MIRROR'), script: tap(2055, '15') });
  expect(result.summary?.good).toBe(1);
  expect(result.replay?.chart.notes.map((note) => note.channel)).toEqual(['15']);
  expect(result.replay?.chart.chartPlayOptions).toEqual({ version: 1, options: { random: 'MIRROR' } });
});

test('the engine-prepared chart takes the chart ADDMINE in place of the mine option (#932)', async () => {
  const result = await observePlay({
    driver: 'auto',
    chart: parseBMS(['#BPM 120', '#OPTION 774:CRAZY_ADDMINE', '#00111:01010101', '#00212:01010101', ''].join('\n')),
    options: { mineModifier: 'REMOVE' },
  });
  expect(result.outcome).toBe('completed');
  expect(result.replay?.play.mineModifier).toBe('ADD_RANDOM');
  expect(result.replay?.chart.notes.some((note) => note.type === 'mine')).toBe(true);
});

test('NOTES COPY plays the chart as double play, and the replay re-simulates it (#932)', async () => {
  const copied = parseBMS(['#BPM 120', '#OPTION 774:NOTES_COPY', '#00111:01', '#00116:01', ''].join('\n'));
  const result = await observePlay({ driver: 'manual', chart: copied, script: tap(2000, ['11', '16', '25', '26']) });
  expect(result.outcome).toBe('completed');
  const saved = parseReplay(serializeReplay(result.replay!));
  expect(saved.chart.laneMode).toBe('5 KEY DP');
  expect(saved.chart.notes.map((note) => note.channel).sort()).toEqual(['11', '16', '25', '26']);
  expect(saved.chart.chartPlayOptions).toEqual({ version: 1, options: { notes: 'COPY' } });
  expect(result.summary?.perfect).toBe(4);
  expect(simulateReplay(saved, { ruleset: 'lr2' }).judge).toMatchObject({ pgreat: 4 });
  expect(classifyReplayAssists(saved)).toEqual([]);
});

test('a course keeps its key mode: NOTES COPY is diagnosed and not recorded there (#932)', async () => {
  const copied = parseBMS(['#BPM 120', '#OPTION 774:NOTES_COPY', '#00111:01', ''].join('\n'));
  const result = await observePlay({
    driver: 'auto',
    chart: copied,
    options: { course: { kind: 'grade' } },
  });
  expect(result.replay?.chart.laneMode).not.toMatch(/DP/);
  expect(result.replay?.chart.chartPlayOptions).toBeUndefined();
  expect(result.log.some((entry) => entry.includes('774:NOTES_COPY'))).toBe(true);
});

test('a course judge constraint and a chart modifier compose', async () => {
  const result = await observePlay({
    driver: 'manual',
    chart: chart('774:CRAZY_HELLJUDGE'),
    script: tap(2025, '11'),
    options: { course: { kind: 'grade', judge: 'no-great' } },
  });
  // 25 ms late: PGREAT is 9 ms under HELLJUDGE (18 ms halved), and NO_GREAT gives GREAT and GOOD that window.
  expect(result.summary?.bad).toBe(1);
});
