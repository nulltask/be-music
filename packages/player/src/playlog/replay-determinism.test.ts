import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BeMusicJson } from '@be-music/json';
import { describe, expect, test } from 'vite-plus/test';
import { parseChartFile } from '../../../parser/src/index.ts';
import { manualPlay } from '../index.ts';
import type { PlayerSummary } from '../core/engine.ts';
import { simulatePlaylog } from './simulate.ts';
import type { BeMusicPlaylog, PlaylogInputEvent } from './format.ts';

/**
 * Replay determinism: a replay's summary and re-recorded play log must depend only on the chart and the input
 * stream — never on where the wall-clock ticks happened to land or on `speed`, which only changes how much chart
 * time one tick covers. Long-note charts are the sensitive case: holds, releases, tail windows and the clamped
 * gauge all used to be resolved at tick time.
 */

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

interface ReplayRun {
  summary: PlayerSummary;
  playlog: BeMusicPlaylog;
}

async function play(json: BeMusicJson, inputs: readonly PlaylogInputEvent[], speed: number): Promise<ReplayRun> {
  let playlog: BeMusicPlaylog | undefined;
  const summary = await manualPlay(structuredClone(json), {
    speed,
    leadInMs: 0,
    audio: false,
    tui: false,
    writeOutput: () => undefined,
    judgeRuleset: 'lr2',
    replayInputs: inputs,
    recordPlaylog: {},
    onPlaylogRecorded: (recorded) => {
      playlog = recorded;
    },
  });
  return { summary, playlog: playlog! };
}

/** Press offsets cycled over the notes, so the stream spans several judges instead of a clean all-PGREAT pass. */
const PRESS_OFFSETS_US = [0, 12_000, -12_000, 30_000, -30_000, 70_000, -70_000, 150_000];
const TAP_HOLD_US = 40_000;

/** Presses every note: taps are held 40 ms, long notes are held to their tail. */
function buildInputs(playlog: BeMusicPlaylog): PlaylogInputEvent[] {
  const events: Array<Omit<PlaylogInputEvent, 'seq'>> = [];
  playlog.chart.notes.forEach((note, index) => {
    if (note.type !== 'normal' && note.type !== 'long') {
      return;
    }
    const downUs = note.timeUs + PRESS_OFFSETS_US[index % PRESS_OFFSETS_US.length]!;
    const upUs = note.type === 'long' && note.endTimeUs !== undefined ? note.endTimeUs : downUs + TAP_HOLD_US;
    events.push({ timeUs: downUs, action: 'down', channels: [note.channel] });
    events.push({ timeUs: upUs, action: 'up', channels: [note.channel] });
  });
  events.sort((left, right) => left.timeUs - right.timeUs);
  return events.map((event, seq) => ({ ...event, seq }));
}

function scoreOf(summary: PlayerSummary) {
  const { perfect, great, good, bad, poor, emptyPoor, fast, slow, exScore, score, total } = summary;
  return { perfect, great, good, bad, poor, emptyPoor, fast, slow, exScore, score, total, gauge: summary.gauge };
}

function inputsOf(playlog: BeMusicPlaylog) {
  return playlog.inputs.map(({ timeUs, action, channels }) => ({ timeUs, action, channels }));
}

const LONG_NOTE_CHARTS = ['7key-longnote.bml', 'ln-mode-1-long-note.bms', 'ln-mode-2-charge-note.bms'];

describe('engine replay determinism', () => {
  test.each(LONG_NOTE_CHARTS)(
    '%s: repeated replays at speeds 4, 16 and 64 reach the same summary and play log',
    async (file) => {
      const json = await parseChartFile(resolve(rootDir, 'examples/test', file));
      const inputs = buildInputs((await play(json, [], 64)).playlog);
      expect(inputs.length).toBeGreaterThan(0);

      const reference = await play(json, inputs, 16);
      // The trailing release after the last note used to be dropped when the loop exited first.
      expect(inputsOf(reference.playlog)).toEqual(inputsOf({ inputs } as BeMusicPlaylog));
      // Guard against a vacuous pass: the offsets above must land on several judges.
      expect(reference.summary.perfect).toBeGreaterThan(0);
      expect(reference.summary.good + reference.summary.bad).toBeGreaterThan(0);

      for (const speed of [16, 16, 4, 64, 64]) {
        const run = await play(json, inputs, speed);
        expect(scoreOf(run.summary), `speed ${speed}`).toEqual(scoreOf(reference.summary));
        expect(inputsOf(run.playlog), `speed ${speed}`).toEqual(inputsOf(reference.playlog));
      }

      const simulated = simulatePlaylog(reference.playlog, { ruleset: 'lr2' });
      expect([
        reference.summary.perfect,
        reference.summary.great,
        reference.summary.good,
        reference.summary.bad,
        reference.summary.poor,
        reference.summary.emptyPoor,
      ]).toEqual([
        simulated.judge.pgreat,
        simulated.judge.great,
        simulated.judge.good,
        simulated.judge.bad,
        simulated.judge.poor,
        simulated.judge.emptyPoor,
      ]);
      expect(reference.summary.exScore).toBe(simulated.exScore);
      expect(reference.summary.fast).toBe(simulated.fast);
      expect(reference.summary.slow).toBe(simulated.slow);
      expect(reference.summary.score).toBe(simulated.score);
    },
    60_000,
  );
});
