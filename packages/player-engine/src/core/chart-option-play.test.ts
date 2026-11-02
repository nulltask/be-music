import { checkReplayEligibility } from '../replay/eligibility.ts';
import { expect, test } from 'vite-plus/test';
import { parseBMS } from '@be-music/chart-parser';
import { parseReplay, serializeReplay } from '../replay/format.ts';
import { observePlay, tap } from './characterization/harness.ts';

const chart = () =>
  parseBMS(`#BPM 120
#WAV01 note.wav
#OPTION 774:HI-SPEED_x0.77
#CHANGEOPTION01 774:HI-SPEED_x100.00
#CHANGEOPTION02 774:HI-SPEED_x0.25
#001A6:01
#002A6:02
#00011:0001
#00111:0001
`);

test('authored display changes reach engine frames exactly and preserve judging, audio and replay simulation', async () => {
  const frames: { seconds: number; speed?: number }[] = [];
  const source = chart();
  const result = await observePlay({
    driver: 'manual',
    chart: source,
    script: [...tap(1000, '11'), ...tap(3000, '11')],
    onFrame: (frame) => frames.push({ seconds: frame.currentSeconds, speed: frame.chartOptions?.hiSpeed }),
  });
  const plain = chart();
  delete plain.bms.options;
  delete plain.bms.option;
  plain.bms.changeOption = {};
  plain.events = plain.events.filter((event) => event.channel !== 'A6');
  // A silent text clear holds the baseline open through the same presentation horizon.
  plain.events.push({ measure: 2, channel: '99', position: [0, 1], value: '01' });
  const baseline = await observePlay({
    driver: 'manual',
    chart: plain,
    script: [...tap(1000, '11'), ...tap(3000, '11')],
  });
  expect(result.outcome).toBe('completed');
  expect(frames.find((frame) => frame.seconds >= 0)?.speed).toBe(0.77);
  expect(frames.find((frame) => frame.seconds >= 2.01)?.speed).toBe(100);
  expect(frames.find((frame) => frame.seconds >= 4.01)?.speed).toBe(0.25);
  expect(result.summary).toEqual(baseline.summary);
  expect(result.audio).toEqual(baseline.audio);
  expect(result.simulated).toEqual(baseline.simulated);
  expect(checkReplayEligibility(result.replay!)).toEqual(checkReplayEligibility(baseline.replay!));
  const saved = parseReplay(serializeReplay(result.replay!));
  expect(saved.chart.chartOptions).toEqual({
    version: 3,
    initial: { hiSpeed: 0.77 },
    cues: [
      { timeUs: 2000000, state: { hiSpeed: 100 } },
      { timeUs: 4000000, state: { hiSpeed: 0.25 } },
    ],
  });
});

test.each(['auto', 'replay'] as const)(
  '%s pause and backwards seek reproduce the effective authored state',
  async (driver) => {
    const frames: { seconds: number; speed?: number; generation: number; paused: boolean }[] = [];
    await observePlay({
      driver: driver === 'auto' ? 'auto' : 'manual',
      chart: chart(),
      options: driver === 'replay' ? { replayInputs: [] } : {},
      script: [
        { atMs: 2200, command: { kind: 'toggle-pause' } },
        { atMs: 2400, command: { kind: 'toggle-pause' } },
        { atMs: 2600, command: { kind: 'seek', seconds: 1.5 } },
      ],
      onFrame: (frame) =>
        frames.push({
          seconds: frame.currentSeconds,
          speed: frame.chartOptions?.hiSpeed,
          generation: frame.generation ?? 0,
          paused: frame.clock?.paused ?? false,
        }),
    });
    const paused = frames.filter((frame) => frame.paused && frame.seconds > 0);
    expect(paused.length).toBeGreaterThan(1);
    expect(paused.every((frame) => frame.speed === 100)).toBe(true);
    expect(frames.find((frame) => frame.generation === 1)?.speed).toBe(0.77);
    expect(frames.find((frame) => frame.generation === 1 && frame.seconds >= 2.01)?.speed).toBe(100);
  },
);

test('recorded effective programs override later source changes and can restore user speed explicitly', async () => {
  const source = chart();
  source.bms.options = ['774:HI-SPEED_x10.00'];
  const frames: (number | undefined)[] = [];
  await observePlay({
    driver: 'manual',
    chart: source,
    options: {
      replayInputs: [],
      chartOptionProgram: {
        version: 1,
        initial: { hiSpeed: 0.25 },
        cues: [{ timeUs: 2000000, state: {} }],
      },
    },
    onFrame: (frame) => {
      if (frame.currentSeconds < 0.1 || frame.currentSeconds > 2.1) frames.push(frame.chartOptions?.hiSpeed);
    },
  });
  expect(frames[0]).toBe(0.25);
  expect(frames.at(-1)).toBeUndefined();
});

test('unsupported and missing declarations emit diagnostics without blocking a valid chart', async () => {
  const source = chart();
  source.bms.options!.push('unknown:thing');
  source.events.push({ measure: 0, channel: 'A6', position: [0, 1], value: 'ZZ' });
  const result = await observePlay({ driver: 'auto', chart: source });
  expect(result.outcome).toBe('completed');
  expect(result.log.some((entry) => entry.includes('unsupported-option'))).toBe(true);
  expect(result.log.some((entry) => entry.includes('missing-reference'))).toBe(true);
});

test('compulsory chart speed blocks user high-speed commands without changing their baseline', async () => {
  const command = { atMs: 1000, command: { kind: 'high-speed' as const, action: 'increase' as const } };
  const forced = await observePlay({ driver: 'auto', chart: chart(), script: [command] });
  expect(forced.host.some((entry) => entry.includes('high-speed'))).toBe(false);
  const plain = chart();
  delete plain.bms.options;
  delete plain.bms.option;
  plain.events = plain.events.filter((event) => event.channel !== 'A6');
  const ordinary = await observePlay({ driver: 'auto', chart: plain, script: [command] });
  expect(ordinary.host.some((entry) => entry.includes('high-speed'))).toBe(true);
});

test('a play owns its effective override program independently of later host edits', async () => {
  const program = { version: 1 as const, initial: { hiSpeed: 0.25 }, cues: [] };
  const values: (number | undefined)[] = [];
  await observePlay({
    driver: 'auto',
    chart: chart(),
    options: { chartOptionProgram: program },
    onFrame: (frame) => {
      values.push(frame.chartOptions?.hiSpeed);
      program.initial.hiSpeed = 100;
    },
  });
  expect(values.length).toBeGreaterThan(1);
  expect(values.every((value) => value === 0.25)).toBe(true);
});

test('negative-BPM reversal freezes effective display operations at the same chart cutoff as playback', async () => {
  const source = chart();
  source.resources.bpm['01'] = -120;
  source.events.push({ measure: 1, channel: '08', position: [1, 4], value: '01' });
  const values: number[] = [];
  await observePlay({
    driver: 'auto',
    chart: source,
    onFrame: (frame) => {
      if (frame.currentSeconds > 2.5 && frame.chartOptions?.hiSpeed !== undefined)
        values.push(frame.chartOptions.hiSpeed);
    },
  });
  expect(values.length).toBeGreaterThan(0);
  expect(values.every((value) => value === 100)).toBe(true);
});

test.each(['auto', 'replay'] as const)(
  'NONSTOP %s owns stage programs and restores them after backwards seek',
  async (driver) => {
    const { stitchNonstopCourse } = await import('../course/nonstop/compose.ts');
    const first = parseBMS('#BPM 120\n#OPTION 774:HI-SPEED_x0.77\n#00211:01\n#00411:01');
    const second = parseBMS(
      '#BPM 60\n#OPTION 774:HI-SPEED_x100.00\n#CHANGEOPTION01 774:HI-SPEED_x0.25\n#003A6:01\n#00211:01\n#00411:01',
    );
    const plain = parseBMS('#BPM 120\n#00211:01\n#00411:01');
    const stitched = stitchNonstopCourse([{ chart: first }, { chart: second }, { chart: plain }], {
      connections: ['cut-fit', 'cut'],
    });
    if (!stitched.ok) throw new Error(stitched.reason);
    const start = stitched.map.stages[1]!.windowStart;
    const clear = stitched.map.stages[2]!.windowStart;
    const frames: { seconds: number; generation: number; speed?: number }[] = [];
    const result = await observePlay({
      driver: driver === 'auto' ? 'auto' : 'manual',
      chart: stitched.chart,
      options: {
        chartOptionProgram: structuredClone(stitched.map.chartOptions),
        ...(driver === 'replay' ? { replayInputs: [] } : {}),
      },
      script: [{ atMs: (clear + 0.3) * 1000, command: { kind: 'seek', seconds: start + 1 } }],
      onFrame: (frame) =>
        frames.push({
          seconds: frame.currentSeconds,
          generation: frame.generation ?? 0,
          speed: frame.chartOptions?.hiSpeed,
        }),
    });
    expect(result.outcome).toBe('completed');
    expect(frames.find((frame) => frame.seconds >= start + 1)?.speed).toBe(100);
    expect(frames.find((frame) => frame.seconds >= start + 2.1)?.speed).toBe(0.25);
    expect(frames.find((frame) => frame.seconds >= clear + 0.1)?.speed).toBeUndefined();
    expect(frames.find((frame) => frame.generation === 1)?.speed).toBe(100);
    expect(frames.find((frame) => frame.generation === 1 && frame.seconds >= start + 2.1)?.speed).toBe(0.25);
  },
);

test('host-compiled NONSTOP diagnostics reach the engine without losing stage provenance', async () => {
  const { stitchNonstopCourse } = await import('../course/nonstop/compose.ts');
  const source = parseBMS('#BPM 120\n#OPTION unknown:stage option\n#00111:01');
  const stitched = stitchNonstopCourse([{ chart: source }], { connections: [] });
  if (!stitched.ok) throw new Error(stitched.reason);
  const result = await observePlay({
    driver: 'auto',
    chart: stitched.chart,
    options: { chartOptionDiagnostics: stitched.map.chartOptionDiagnostics },
  });
  expect(result.log.some((entry) => entry.includes('unsupported-option') && entry.includes('"stage":0'))).toBe(true);
});
