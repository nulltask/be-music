import { resolveChart } from '@be-music/chart-model';
import { describe, expect, test } from 'vite-plus/test';
import type { PlayerOptions } from '../engine-types.ts';
import { basicChart, exRankChart, longNoteChart, mineChart, nonstopCourse } from './charts.ts';
import { command, observePlay, tap } from './harness.ts';

const cases = [
  { name: 'taps and misses', chart: basicChart, at: 2.2 },
  ...([1, 2, 3] as const).map((mode) => ({
    name: `long note mode ${mode}`,
    chart: () => longNoteChart(mode),
    at: 1.2,
  })),
  { name: 'mines', chart: mineChart, at: 1.6 },
  { name: 'rank changes and invisible notes', chart: exRankChart, at: 2.6 },
];

describe('a replay that seeks', () => {
  for (const ruleset of ['lr2', 'beatoraja', 'iidx'] as const) {
    for (const sample of cases) {
      test(`${ruleset} / ${sample.name}: agrees with uninterrupted replay at the target and end`, async () => {
        const chart = sample.chart();
        const original = await observePlay({
          driver: 'manual',
          chart,
          options: { judgeRuleset: ruleset },
          script: resolveChart(chart).notes.flatMap((note, index) =>
            index % 4 === 3
              ? []
              : tap(
                  note.seconds * 1000 + (index % 3) * 15,
                  note.channel,
                  note.endSeconds === undefined ? 50 : (note.endSeconds - note.seconds) * 1000,
                ),
          ),
        });
        const options: PlayerOptions = { judgeRuleset: ruleset, replayInputs: original.replay!.inputs };
        const uninterrupted = await observePlay({
          driver: 'manual',
          chart: sample.chart(),
          options,
          captureAt: [sample.at],
        });
        for (const atMs of [undefined, 300, 3000]) {
          const sought = await observePlay({
            driver: 'manual',
            chart: sample.chart(),
            options: { ...options, ...(atMs === undefined ? { startAtSeconds: sample.at } : {}) },
            captureAt: [sample.at],
            script: atMs === undefined ? [] : [command(atMs, { kind: 'seek', seconds: sample.at })],
          });
          expect(sought.frames.generations?.at(-1)).toMatch(/ generation=1 /);
          expect(sought.captured).toEqual(uninterrupted.captured);
          expect(sought.summary).toEqual(uninterrupted.summary);
          expect(sought.replay).toBeUndefined();
        }
      });
    }
  }

  test('a replay aborted early clamps a seek to its recorded end', async () => {
    const options: PlayerOptions = { replayInputs: [], replayAbortedAtUs: 1_200_000 };
    const fromStart = await observePlay({ driver: 'manual', chart: basicChart(), options, captureAt: [1.2] });
    const sought = await observePlay({
      driver: 'manual',
      chart: basicChart(),
      options,
      captureAt: [1.2],
      script: [command(300, { kind: 'seek', seconds: 3 })],
    });
    expect(sought.frames.generations?.[0]).toContain('seconds=1.2 ');
    expect(sought.captured).toEqual(fromStart.captured);
    expect(sought.summary).toEqual(fromStart.summary);
  });

  test('rebuilds held long notes and resumes their keysounds partway without replaying old effects', async () => {
    const options: PlayerOptions = {
      replayInputs: [
        { timeUs: 500_000, seq: 0, action: 'down', channels: ['11'] },
        { timeUs: 1_500_000, seq: 1, action: 'up', channels: ['11'] },
      ],
    };
    const held = await observePlay({
      driver: 'manual',
      chart: longNoteChart(2),
      options,
      script: [command(300, { kind: 'seek', seconds: 1.2 })],
    });
    expect(
      held.audio.some((entry) => entry.includes('trigger-at') && entry.includes('51:02') && entry.endsWith('+0.7')),
    ).toBe(true);
    expect(held.ui.some((entry) => entry.includes('long-note-start 11'))).toBe(true);
    const released = await observePlay({
      driver: 'manual',
      chart: longNoteChart(2),
      options: {
        ...options,
        replayInputs: [options.replayInputs![0]!, { ...options.replayInputs![1]!, timeUs: 1_000_000 }],
      },
      script: [command(300, { kind: 'seek', seconds: 1.8 })],
    });
    expect(released.audio.some((entry) => entry.includes('trigger-at') && entry.includes('51:02'))).toBe(false);
  });

  test.each(['manual', 'auto'] as const)(
    '%s replay restores the recorded tempo while paused and follows changes again',
    async (driver) => {
      const options: PlayerOptions = {
        replayInputs: [],
        speed: 1.25,
        replayTempoChanges: [
          { timeUs: 1_000_000, tempo: 2 },
          { timeUs: 2_000_000, tempo: 0.75 },
        ],
      };
      const sought = await observePlay({
        driver,
        chart: basicChart(),
        options,
        script: [
          command(200, { kind: 'toggle-pause' }),
          command(300, { kind: 'seek', seconds: 2.2 }),
          command(400, { kind: 'seek', seconds: 0.2 }),
          command(500, { kind: 'toggle-pause' }),
        ],
      });
      expect(sought.frames.generations?.[0]).toMatch(/seconds=2.2 .*tempo=0.75 paused/);
      expect(sought.frames.generations?.[1]).toMatch(/seconds=0.2 .*tempo=1.25 paused/);
      expect(sought.host.filter((entry) => entry.includes('tempo x'))).toEqual([
        '300.000 tempo x0.75 at 2.2',
        '400.000 tempo x1.25 at 0.2',
        expect.stringMatching(/tempo x2 at /),
        expect.stringMatching(/tempo x0.75 at /),
      ]);
    },
  );
});

for (const judgeRuleset of ['lr2', 'beatoraja', 'iidx'] as const) {
  test(`${judgeRuleset}: NONSTOP replay seeks across a stage's different judge rank`, async () => {
    const { chart, map } = nonstopCourse();
    const at = map.stageRanks[0]!.seconds + 1.7;
    const options: PlayerOptions = {
      judgeRuleset,
      endOnFailure: false,
      stageRanks: map.stageRanks,
      course: { kind: 'nonstop' },
    };
    const original = await observePlay({
      driver: 'manual',
      chart,
      options,
      script: resolveChart(chart).notes.flatMap((note) => tap(note.seconds * 1000 + 80, note.channel)),
    });
    const playback = { ...options, replayInputs: original.replay!.inputs };
    const baseline = await observePlay({
      driver: 'manual',
      chart: nonstopCourse().chart,
      options: playback,
      captureAt: [at],
    });
    for (const atMs of [300, (at + 0.4) * 1000]) {
      const sought = await observePlay({
        driver: 'manual',
        chart: nonstopCourse().chart,
        options: playback,
        captureAt: [at],
        script: [command(atMs, { kind: 'seek', seconds: at })],
      });
      expect(sought.captured).toEqual(baseline.captured);
      expect(sought.summary).toEqual(baseline.summary);
    }
  });
}
