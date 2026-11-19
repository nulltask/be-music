import { expect, test, vi } from 'vite-plus/test';
import { parseBMS } from '@be-music/chart-parser';
import { classifyReplayAssists, resolveReplayRecordPolicy } from '../records/assist-policy.ts';
import { checkReplayEligibility } from '../replay/eligibility.ts';
import { parseReplay, serializeReplay } from '../replay/format.ts';
import { simulateReplay } from '../replay/simulate.ts';
import { observePlay, tap } from './characterization/harness.ts';

// One note at 2 s, hit 55 ms late: a GOOD under LR2's NORMAL windows (GREAT 40 ms, GOOD 100 ms).
const chart = (...options: string[]) =>
  parseBMS(
    ['#BPM 120', '#WAV01 note.wav', ...options.map((option) => `#OPTION ${option}`), '#00111:01', ''].join('\n'),
  );
const script = tap(2055, '11');

test.each(['774:CRAZY_GOOD2BAD', '774:CRAZY_GREAT2BAD'] as const)(
  '%s keeps the GOOD a GOOD but moves the gauge as a BAD, and the replay re-simulates it',
  async (option) => {
    const baseline = await observePlay({ driver: 'manual', chart: chart(), script });
    const result = await observePlay({ driver: 'manual', chart: chart(option), script });
    expect(result.outcome).toBe('completed');
    expect(result.summary?.good).toBe(1);
    expect(result.summary?.bad).toBe(0);
    expect(result.summary!.gauge!.current).toBeLessThan(baseline.summary!.gauge!.current);
    const saved = parseReplay(serializeReplay(result.replay!));
    expect(saved.chart.chartPlayOptions).toEqual({ version: 3, options: { judge: option.slice(10) } });
    // Replay equivalence: the re-simulation applies the recorded modifier to the gauge.
    const simulated = simulateReplay(saved, { ruleset: 'lr2' });
    expect(simulated.judge).toMatchObject({ good: 1, bad: 0 });
    expect(simulated.gauge.final).toBe(result.replay!.results!.native!.gauge.final);
    // Chart-authored, so not the player's assist: eligibility and class are the baseline's.
    expect(classifyReplayAssists(saved)).toEqual([]);
    const eligibility = checkReplayEligibility(saved);
    expect(eligibility.eligible && eligibility.assistClass).toBe('none');
  },
);

test('774:CRAZY_HELLJUDGE narrows GOOD to a third and BAD to a quarter, and the replay re-simulates it', async () => {
  // 45 ms late: past LR2 NORMAL's GOOD under HELLJUDGE (100 ms / 3), inside its BAD (200 ms / 4).
  const result = await observePlay({ driver: 'manual', chart: chart('774:CRAZY_HELLJUDGE'), script: tap(2045, '11') });
  expect(result.summary).toMatchObject({ good: 0, bad: 1 });
  const saved = parseReplay(serializeReplay(result.replay!));
  expect(saved.chart.chartPlayOptions).toEqual({ version: 3, options: { hellJudge: true } });
  expect(simulateReplay(saved, { ruleset: 'lr2' }).judge).toMatchObject({ good: 0, bad: 1 });
  expect(simulateReplay(saved, { ruleset: 'beatoraja' }).judge).toMatchObject({ good: 0 });
});

test('a replay recorded before version 3 keeps the earlier readings', async () => {
  const result = await observePlay({
    driver: 'manual',
    chart: chart(),
    script,
    options: { chartPlayOptionProgram: { version: 1, options: { judge: 'GOOD2BAD' } } },
  });
  // The GOOD window collapsed onto GREAT: the late GOOD is a BAD.
  expect(result.summary).toMatchObject({ good: 0, bad: 1 });
  const saved = parseReplay(serializeReplay(result.replay!));
  expect(saved.chart.chartPlayOptions).toEqual({ version: 1, options: { judge: 'GOOD2BAD' } });
  expect(simulateReplay(saved, { ruleset: 'lr2' }).judge).toMatchObject({ good: 0, bad: 1 });
});

test("the player's own GOOD2BAD and HELLJUDGE join the chart's options, the chart winning within a family", async () => {
  const own = await observePlay({
    driver: 'manual',
    chart: chart(),
    script,
    options: { playerChartPlayOptions: { judge: 'GREAT2BAD', hellJudge: true } },
  });
  expect(own.replay?.chart.chartPlayOptions).toEqual({
    version: 3,
    options: { judge: 'GREAT2BAD', hellJudge: true },
  });
  const chartWins = await observePlay({
    driver: 'manual',
    chart: chart('774:CRAZY_GOOD2BAD'),
    script,
    options: { playerChartPlayOptions: { judge: 'GREAT2BAD' } },
  });
  expect(chartWins.replay?.chart.chartPlayOptions?.options.judge).toBe('GOOD2BAD');
  // The replay names which of the options were the player's (#1243): none where the chart won.
  expect(parseReplay(serializeReplay(own.replay!)).play.playerChartPlayOptions).toEqual({
    judge: 'GREAT2BAD',
    hellJudge: true,
  });
  expect(chartWins.replay?.play.playerChartPlayOptions).toBeUndefined();
  // They make the play harder, as nanasigroove records them: not an assist.
  expect(classifyReplayAssists(own.replay!)).toEqual([]);
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

test("the engine-prepared chart takes the chart ADDMINE, nanasigroove's, in place of the mine option (#932, #1185)", async () => {
  // Every draw 0.95: each lane is a regular one, its first mine 366 positions (7.625 beats) in, before the chart's last
  // row at beat 11; the next would be past it. Each mine draws the 1–50 band: 48 points, 24 % of the gauge.
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.95);
  const result = await observePlay({
    driver: 'auto',
    chart: parseBMS(['#BPM 120', '#OPTION 774:CRAZY_ADDMINE', '#00111:01010101', '#00212:01010101', ''].join('\n')),
    options: { mineModifier: 'REMOVE' },
  }).finally(() => random.mockRestore());
  expect(result.outcome).toBe('completed');
  expect(result.replay?.play.mineModifier).toBe('NANASI_ADD');
  expect(result.replay?.chart.chartPlayOptions).toEqual({ version: 3, options: { addMine: true } });
  const mines = result.replay!.chart.notes.filter((note) => note.type === 'mine');
  expect(mines.length).toBeGreaterThanOrEqual(5);
  for (const mine of mines) {
    expect(mine.damage).toBe(24);
    expect(mine.timeUs).toBe(3_812_500);
  }
});

test('NOTES COPY plays the chart as double play, and the replay re-simulates it (#932)', async () => {
  const copied = parseBMS(['#BPM 120', '#OPTION 774:NOTES_COPY', '#00111:01', '#00116:01', ''].join('\n'));
  const result = await observePlay({ driver: 'manual', chart: copied, script: tap(2000, ['11', '16', '25', '26']) });
  expect(result.outcome).toBe('completed');
  const saved = parseReplay(serializeReplay(result.replay!));
  expect(saved.chart.laneMode).toBe('5 KEY DP');
  expect(saved.chart.notes.map((note) => note.channel).sort()).toEqual(['11', '16', '25', '26']);
  expect(saved.chart.chartPlayOptions).toEqual({ version: 3, options: { notes: 'COPY' } });
  expect(result.summary?.perfect).toBe(4);
  expect(simulateReplay(saved, { ruleset: 'lr2' }).judge).toMatchObject({ pgreat: 4 });
  expect(classifyReplayAssists(saved)).toEqual([]);
});

test("the player's NOTES COPY plays as double play but keeps no record of the single-play chart (#1243)", async () => {
  const single = parseBMS(['#BPM 120', '#00111:01', '#00116:01', ''].join('\n'));
  const result = await observePlay({
    driver: 'manual',
    chart: single,
    script: tap(2000, ['11', '16', '25', '26']),
    options: { playerChartPlayOptions: { notes: 'COPY' } },
  });
  const saved = parseReplay(serializeReplay(result.replay!));
  expect(saved.chart.laneMode).toBe('5 KEY DP');
  expect(saved.chart.chartPlayOptions).toEqual({ version: 3, options: { notes: 'COPY' } });
  expect(saved.play.playerChartPlayOptions).toEqual({ notes: 'COPY' });
  expect(classifyReplayAssists(saved)).toEqual([
    { option: 'nanasi-notes:COPY', source: 'be-music', assistClass: 'no-save' },
  ]);
  expect(resolveReplayRecordPolicy(saved)).toMatchObject({ keepsRecord: false, leaderboard: 'unranked' });
  // Re-judging the replay gives the live play's judgments.
  expect(result.summary?.perfect).toBe(4);
  expect(simulateReplay(saved, { ruleset: 'lr2' }).judge).toMatchObject({ pgreat: 4 });
  expect(simulateReplay(saved, { ruleset: 'beatoraja' }).judge).toMatchObject({ pgreat: 4 });
  // A course stage leaves the player's COPY out as it leaves the chart's, so nothing is the player's there.
  const stage = await observePlay({
    driver: 'auto',
    chart: single,
    options: { playerChartPlayOptions: { notes: 'COPY' }, course: { kind: 'grade' } },
  });
  expect(stage.replay?.play.playerChartPlayOptions).toBeUndefined();
});

test('NOTES DOUBLE copies the lanes as nanasigroove does, and the replay re-simulates it (#1184)', async () => {
  // 5 KEY: the 1 reaches 3 and 5, the 2 reaches 4.
  const doubled = parseBMS(['#BPM 120', '#OPTION 774:NOTES_DOUBLE', '#00111:01', '#00112:0001', ''].join('\n'));
  const result = await observePlay({
    driver: 'manual',
    chart: doubled,
    script: [...tap(2000, ['11', '13', '15']), ...tap(3000, ['12', '14'])],
  });
  expect(result.outcome).toBe('completed');
  const saved = parseReplay(serializeReplay(result.replay!));
  expect(saved.chart.chartPlayOptions).toEqual({ version: 3, options: { notes: 'DOUBLE' } });
  expect(saved.chart.notes.map((note) => note.channel).sort()).toEqual(['11', '12', '13', '14', '15']);
  expect(result.summary?.perfect).toBe(5);
  expect(simulateReplay(saved, { ruleset: 'lr2' }).judge).toMatchObject({ pgreat: 5 });
  expect(simulateReplay(saved, { ruleset: 'beatoraja' }).judge).toMatchObject({ pgreat: 5 });
});

test('a NOTES DOUBLE replay recorded before version 3 keeps the mirror-lane reading', async () => {
  const doubled = parseBMS(['#BPM 120', '#00111:01', ''].join('\n'));
  const result = await observePlay({
    driver: 'auto',
    chart: doubled,
    options: { chartPlayOptionProgram: { version: 1, options: { notes: 'DOUBLE' } } },
  });
  const saved = parseReplay(serializeReplay(result.replay!));
  expect(saved.chart.notes.map((note) => note.channel).sort()).toEqual(['11', '15']);
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
  // 25 ms late: PGREAT is 6.75 ms under HELLJUDGE (18 ms × 3/8), and NO_GREAT gives GREAT and GOOD that window.
  expect(result.summary?.bad).toBe(1);
});
