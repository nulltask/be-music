import { expect, test } from 'vite-plus/test';
import { parseBMS } from '@be-music/chart-parser';
import { checkReplayEligibility } from '../replay/eligibility.ts';
import { parseReplay, serializeReplay } from '../replay/format.ts';
import { observePlay, tap } from './characterization/harness.ts';

const source = `#BPM 120
#WAV01 note.wav
#OPTION 774:HIDDEN_SUDDEN
#OPTION 774:CHANGE-HS_NAZO
#CHANGEOPTION01 774:HIDDEN_STEALTH
#CHANGEOPTION02 774:CRAZY_XWAVE
#CHANGEOPTION03 774:HIDDEN_OFF
#001A6:01
#002A6:0203
#00011:0001
#00111:0001
`;

test('HIDDEN, CHANGE-HS and CRAZY reach engine frames and leave judging, audio, simulation and eligibility alone', async () => {
  const frames: { seconds: number; state?: object }[] = [];
  const result = await observePlay({
    driver: 'manual',
    chart: parseBMS(source),
    script: [...tap(1000, '11'), ...tap(3000, '11')],
    onFrame: (frame) => frames.push({ seconds: frame.currentSeconds, state: frame.chartOptions }),
  });
  const plain = parseBMS(source);
  delete plain.bms.options;
  delete plain.bms.option;
  plain.bms.changeOption = {};
  plain.events = plain.events.filter((event) => event.channel !== 'A6');
  plain.events.push({ measure: 2, channel: '99', position: [1, 2], value: '01' });
  const baseline = await observePlay({
    driver: 'manual',
    chart: plain,
    script: [...tap(1000, '11'), ...tap(3000, '11')],
  });
  expect(result.outcome).toBe('completed');
  expect(frames.find((frame) => frame.seconds >= 0)?.state).toEqual({ hidden: 'SUDDEN', changeHS: 'NAZO' });
  expect(frames.find((frame) => frame.seconds >= 2.01)?.state).toEqual({ hidden: 'STEALTH', changeHS: 'NAZO' });
  // Two cues in one measure, at 4 s and 5 s: XWAVE joins, then HIDDEN clears.
  expect(frames.find((frame) => frame.seconds >= 4.01)?.state).toEqual({
    hidden: 'STEALTH',
    changeHS: 'NAZO',
    crazyWave: 'XWAVE',
  });
  expect(frames.find((frame) => frame.seconds >= 5.01)?.state).toEqual({ changeHS: 'NAZO', crazyWave: 'XWAVE' });
  expect(result.summary).toEqual(baseline.summary);
  expect(result.audio).toEqual(baseline.audio);
  expect(result.simulated).toEqual(baseline.simulated);
  expect(checkReplayEligibility(result.replay!)).toEqual(checkReplayEligibility(baseline.replay!));
  const saved = parseReplay(serializeReplay(result.replay!));
  expect(saved.chart.chartOptions).toEqual({
    version: 2,
    initial: { hidden: 'SUDDEN', changeHS: 'NAZO' },
    cues: [
      { timeUs: 2000000, state: { hidden: 'STEALTH', changeHS: 'NAZO' } },
      { timeUs: 4000000, state: { hidden: 'STEALTH', changeHS: 'NAZO', crazyWave: 'XWAVE' } },
      { timeUs: 5000000, state: { changeHS: 'NAZO', crazyWave: 'XWAVE' } },
    ],
  });
});

test('a version-1 recorded program plays without the version-2 families the source now declares', async () => {
  const states: (object | undefined)[] = [];
  await observePlay({
    driver: 'manual',
    chart: parseBMS(source),
    options: { replayInputs: [], chartOptionProgram: { version: 1, initial: {}, cues: [] } },
    onFrame: (frame) => states.push(frame.chartOptions),
  });
  expect(states.length).toBeGreaterThan(0);
  expect(states.every((state) => state === undefined)).toBe(true);
});

test('backwards seek reproduces the visual state statelessly', async () => {
  const frames: { seconds: number; generation: number; hidden?: string }[] = [];
  await observePlay({
    driver: 'auto',
    chart: parseBMS(source),
    script: [{ atMs: 2600, command: { kind: 'seek', seconds: 1 } }],
    onFrame: (frame) =>
      frames.push({
        seconds: frame.currentSeconds,
        generation: frame.generation ?? 0,
        hidden: frame.chartOptions?.hidden,
      }),
  });
  expect(frames.find((frame) => frame.generation === 0 && frame.seconds >= 2.1)?.hidden).toBe('STEALTH');
  expect(frames.find((frame) => frame.generation === 1)?.hidden).toBe('SUDDEN');
});

test('NONSTOP places a visual-only stage program and releases it at the next stage', async () => {
  const { stitchNonstopCourse } = await import('../course/nonstop/compose.ts');
  const first = parseBMS('#BPM 120\n#OPTION 774:HIDDEN_HIDDEN\n#00211:01');
  const plain = parseBMS('#BPM 120\n#00211:01');
  const stitched = stitchNonstopCourse([{ chart: first }, { chart: plain }], { connections: ['cut'] });
  if (!stitched.ok) throw new Error(stitched.reason);
  expect(stitched.map.chartOptions?.version).toBe(2);
  expect(stitched.map.chartOptions?.initial).toEqual({ hidden: 'HIDDEN' });
  const next = stitched.map.stages[1]!.windowStart;
  const states: { seconds: number; hidden?: string }[] = [];
  await observePlay({
    driver: 'auto',
    chart: stitched.chart,
    options: { chartOptionProgram: structuredClone(stitched.map.chartOptions) },
    onFrame: (frame) => states.push({ seconds: frame.currentSeconds, hidden: frame.chartOptions?.hidden }),
  });
  expect(states.find((state) => state.seconds >= 0.1)?.hidden).toBe('HIDDEN');
  expect(states.find((state) => state.seconds >= next + 0.1)?.hidden).toBeUndefined();
});
