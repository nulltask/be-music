import { expect, test } from 'vite-plus/test';
import { parseBMS } from '@be-music/chart-parser';
import { checkReplayEligibility } from '../replay/eligibility.ts';
import { parseReplay, serializeReplay } from '../replay/format.ts';
import { observePlay, tap } from './characterization/harness.ts';

// Profile version 3 (#931): M-SUDDEN, the skin-level CRAZY options and the legacy aliases.
const source = `#BPM 120
#WAV01 note.wav
#OPTION 774:HIDDEN_M-SUDDEN
#OPTION 774:CRA-STAR
#CHANGEOPTION01 774:CRAZY_REVERSE
#CHANGEOPTION02 774:CRAZY_HIDJUDGE
#CHANGEOPTION03 774:CRAZY_OFF
#CHANGEOPTION04 774:CRA-DARK
#001A6:01
#002A6:0203
#003A6:04
#00011:0001
#00111:0001
`;

test('M-SUDDEN and the skin-level CRAZY options reach engine frames and leave judging, simulation and eligibility alone', async () => {
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
  plain.events.push({ measure: 3, channel: '99', position: [0, 1], value: '01' });
  const baseline = await observePlay({
    driver: 'manual',
    chart: plain,
    script: [...tap(1000, '11'), ...tap(3000, '11')],
  });
  expect(result.outcome).toBe('completed');
  expect(frames.find((frame) => frame.seconds >= 0)?.state).toEqual({ hidden: 'M-SUDDEN', crazyColor: 'STAR' });
  expect(frames.find((frame) => frame.seconds >= 2.01)?.state).toEqual({
    hidden: 'M-SUDDEN',
    crazyColor: 'STAR',
    crazyReverse: 'REVERSE',
  });
  expect(frames.find((frame) => frame.seconds >= 4.01)?.state).toMatchObject({ crazyJudge: 'HIDJUDGE' });
  // CRAZY_OFF clears every visual CRAZY field but not HIDDEN; the timed legacy CRA-DARK is initial-only and ignored.
  expect(frames.find((frame) => frame.seconds >= 5.01)?.state).toEqual({ hidden: 'M-SUDDEN' });
  expect(frames.find((frame) => frame.seconds >= 6.01)?.state).toEqual({ hidden: 'M-SUDDEN' });
  expect(result.summary).toEqual(baseline.summary);
  expect(result.simulated).toEqual(baseline.simulated);
  expect(checkReplayEligibility(result.replay!)).toEqual(checkReplayEligibility(baseline.replay!));
  const saved = parseReplay(serializeReplay(result.replay!));
  expect(saved.chart.chartOptions?.version).toBe(3);
  expect(saved.chart.chartOptions?.initial).toEqual({ hidden: 'M-SUDDEN', crazyColor: 'STAR' });
});

test('a version-2 recorded program plays without the version-3 families the source now declares', async () => {
  const states: (object | undefined)[] = [];
  await observePlay({
    driver: 'manual',
    chart: parseBMS(source),
    options: { replayInputs: [], chartOptionProgram: { version: 2, initial: {}, cues: [] } },
    onFrame: (frame) => states.push(frame.chartOptions),
  });
  expect(states.length).toBeGreaterThan(0);
  expect(states.every((state) => state === undefined)).toBe(true);
});

test('backwards seek reproduces the skin-level state statelessly', async () => {
  const frames: { seconds: number; generation: number; reverse?: string }[] = [];
  await observePlay({
    driver: 'auto',
    chart: parseBMS(source),
    script: [{ atMs: 2600, command: { kind: 'seek', seconds: 1 } }],
    onFrame: (frame) =>
      frames.push({
        seconds: frame.currentSeconds,
        generation: frame.generation ?? 0,
        reverse: frame.chartOptions?.crazyReverse,
      }),
  });
  expect(frames.find((frame) => frame.generation === 0 && frame.seconds >= 2.1)?.reverse).toBe('REVERSE');
  expect(frames.find((frame) => frame.generation === 1)?.reverse).toBeUndefined();
});

test('NONSTOP places a version-3 stage program and releases it at the next stage', async () => {
  const { stitchNonstopCourse } = await import('../course/nonstop/compose.ts');
  const first = parseBMS('#BPM 120\n#OPTION 774:CRAZY_REVERSE\n#OPTION 774:HIDDEN_M-SUDDEN\n#00211:01');
  const plain = parseBMS('#BPM 120\n#00211:01');
  const stitched = stitchNonstopCourse([{ chart: first }, { chart: plain }], { connections: ['cut'] });
  if (!stitched.ok) throw new Error(stitched.reason);
  expect(stitched.map.chartOptions?.version).toBe(3);
  expect(stitched.map.chartOptions?.initial).toEqual({ crazyReverse: 'REVERSE', hidden: 'M-SUDDEN' });
  const next = stitched.map.stages[1]!.windowStart;
  const states: { seconds: number; reverse?: string }[] = [];
  await observePlay({
    driver: 'auto',
    chart: stitched.chart,
    options: { chartOptionProgram: structuredClone(stitched.map.chartOptions) },
    onFrame: (frame) => states.push({ seconds: frame.currentSeconds, reverse: frame.chartOptions?.crazyReverse }),
  });
  expect(states.find((state) => state.seconds >= 0.1)?.reverse).toBe('REVERSE');
  expect(states.find((state) => state.seconds >= next + 0.1)?.reverse).toBeUndefined();
});
