import { expect, test } from 'vite-plus/test';
import { parseBMS, parseBmson } from '@be-music/chart-parser';
import { buildBmsonBGAEventTimeline, computePlayFingerprint, resolveChart } from '@be-music/chart-model';
import type { BeMusicJSON } from '@be-music/chart-source';
import { stringifyBmson } from './index.ts';

function chart() {
  return parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120, resolution: 240, mode_hint: 'beat-7k', ln_type: 3 },
      lines: [
        { y: 0, vendor: 'start' },
        { y: 960, vendor: 'end' },
      ],
      bpm_events: [{ y: 480, bpm: 180 }],
      stop_events: [{ y: 600, duration: 120 }],
      scroll_events: [{ y: 720, rate: 0.5 }],
      sound_channels: [
        { name: 'head.wav', notes: [{ x: 1, y: 240, l: 480, t: 3, vendor: { pulse: 240 } }] },
        { name: 'end.wav', notes: [{ x: 1, y: 720, up: true, c: true }] },
        {
          name: 'bgm.wav',
          notes: [
            { x: 0, y: 0 },
            { x: 0, y: 480, c: true },
            { x: 0, y: 960, c: true },
          ],
        },
      ],
      key_channels: [{ name: 'hidden.wav', notes: [{ x: 2, y: 480 }] }],
      mine_channels: [{ name: 'mine.wav', notes: [{ x: 3, y: 840, damage: 5 }] }],
      bga: {
        bga_header: [
          { id: 1, name: 'a.png' },
          { id: 2, name: 'b.png' },
        ],
        bga_sequence: [{ id: 10, sequence: [{ time: 0, id: 0 }, { time: 125, id: 1 }, { time: 300 }] }],
        bga_events: [
          { y: 240, id: 1 },
          { y: 720, id: 2 },
        ],
        layer_events: [
          { y: 480, id: 1 },
          { y: 600, id_set: [10], condition: 'play', interval: 125, vendor: { pulse: 600 } },
        ],
        poor_events: [{ y: 720, id: 2 }],
      },
    }),
  );
}
function facts(json: BeMusicJSON) {
  const resolved = resolveChart(json);
  return JSON.parse(
    JSON.stringify(
      {
        notes: resolved.notes.map((note) => [
          note.channel,
          note.seconds,
          note.endSeconds,
          note.lnMode,
          note.endSoundEvent && json.resources.wav[note.endSoundEvent.value],
        ]),
        audio: resolved.sampleTriggers
          .map((trigger) => [
            trigger.samplePath,
            trigger.seconds,
            trigger.sampleOffsetSeconds,
            trigger.sampleDurationSeconds,
          ])
          .map((row) =>
            JSON.stringify(row, (_key, value) => (typeof value === 'number' ? Math.round(value * 1e9) / 1e9 : value)),
          )
          .sort(),
        hidden: resolved.invisibleNotes.map((note) => [note.channel, note.seconds]),
        mines: resolved.mines.map((mine) => [mine.channel, mine.seconds, mine.damage]),
        bars: resolved.barLines,
        scroll: resolved.scroll,
        bga: Object.fromEntries(
          Object.entries(resolved.bga).map(([plane, cues]) => [
            plane,
            cues.map((cue: { seconds: number; key?: string }) => [cue.seconds, cue.key && json.resources.bmp[cue.key]]),
          ]),
        ),
        sequences: buildBmsonBGAEventTimeline(json, resolved.timing),
      },
      (_key, value) => (typeof value === 'number' ? Math.round(value * 1e9) / 1e9 : value),
    ),
  );
}

for (const resolution of [120, 240, 480, 960])
  test.each([false, true])(
    `resolution ${resolution} retains LN tails, slices and every BGA clock (skip validation: %s)`,
    (skipPreservationValidation) => {
      const source = chart();
      // A resolution request always rebuilds from current events, including when a caller trusts stale source arrays.
      source.preservation.bmson.soundChannels[0]!.notes[0]!.l = 777;
      const before = JSON.stringify(source);
      const output = JSON.parse(stringifyBmson(source, { resolution, skipPreservationValidation }));
      const restored = parseBmson(JSON.stringify(output));
      expect(facts(restored)).toEqual(facts(source));
      expect(computePlayFingerprint(restored, { chartPath: 'resolution.bmson' })).toBe(
        computePlayFingerprint(source, { chartPath: 'resolution.bmson' }),
      );
      expect(output.info.resolution).toBe(resolution);
      expect(output.bga.bga_sequence).toEqual([
        { id: 10, sequence: [{ time: 0, id: 0 }, { time: 125, id: 1 }, { time: 300 }] },
      ]);
      expect(output.bga.layer_events[1].interval).toBe(125);
      expect(output.bga.layer_events[1].vendor).toEqual({ pulse: 600 });
      expect(
        output.sound_channels.find((channel: { name: string }) => channel.name === 'head.wav').notes[0].vendor,
      ).toEqual({ pulse: 240 });
      expect(JSON.stringify(source)).toBe(before);
    },
  );

test('rounds a long note’s absolute endpoint so its release keysound stays attached', () => {
  const source = parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120, resolution: 240 },
      sound_channels: [
        { name: 'head.wav', notes: [{ x: 1, y: 1, l: 1 }] },
        { name: 'end.wav', notes: [{ x: 1, y: 2, up: true }] },
      ],
    }),
  );
  const output = JSON.parse(stringifyBmson(source, { resolution: 360 }));
  expect(output.sound_channels[0].notes[0]).toMatchObject({ y: 2, l: 1 });
  const restored = resolveChart(parseBmson(JSON.stringify(output)));
  expect(restored.notes).toHaveLength(1);
  expect(restored.notes[0]?.endBeat).toBeCloseTo(2 / 240);
  expect(restored.notes[0]?.endSoundEvent).toBeDefined();
  expect(restored.sampleTriggers.map((trigger) => trigger.samplePath)).toEqual(['head.wav', 'end.wav']);
});

test('rejects a resolution that would collapse a positive LN into a tap', () => {
  const source = parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120, resolution: 240 },
      sound_channels: [{ name: 'a.wav', notes: [{ x: 1, y: 1, l: 1 }] }],
    }),
  );
  const before = JSON.stringify(source);
  expect(() => stringifyBmson(source, { resolution: 120 })).toThrow(/higher resolution/);
  expect(JSON.stringify(source)).toBe(before);
});

test.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
  'invalid output resolution %s retains the positive source default',
  (resolution) => {
    const source = chart();
    const output = JSON.parse(stringifyBmson(source, { resolution }));
    expect(output.info.resolution).toBe(240);
    expect(facts(parseBmson(JSON.stringify(output)))).toEqual(facts(source));
  },
);

test('missing source resolution uses bmson’s 240 default for LN, barline labels and BGA pulses', () => {
  const source = chart();
  delete source.bmson.info.resolution;
  const output = JSON.parse(stringifyBmson(source, { resolution: 480 }));
  expect(output.lines).toEqual([
    { y: 0, vendor: 'start' },
    { y: 1920, vendor: 'end' },
  ]);
  expect(facts(parseBmson(JSON.stringify(output)))).toEqual(facts(source));
});

test('BGA-only charts change pulse units while keeping their cue time', () => {
  const source = parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120, resolution: 240 },
      bga: { bga_header: [{ id: 1, name: 'a.png' }], bga_events: [{ y: 240, id: 1 }] },
    }),
  );
  const restored = parseBmson(stringifyBmson(source, { resolution: 480 }));
  expect(resolveChart(restored).bga.base[0]?.seconds).toBe(0.5);
});

test.each(['#LNOBJ ZZ\n#00111:01\n#00211:ZZ', '#LNTYPE 1\n#00151:01\n#00251:01'])(
  'BMS long-note conversion keeps its existing endpoint rule: %s',
  (notes) => {
    const source = parseBMS(`#BPM 120\n#WAV01 a.wav\n${notes}`);
    for (const resolution of [120, 480]) {
      const restored = resolveChart(parseBmson(stringifyBmson(source, { resolution })));
      expect(restored.notes[0]).toMatchObject({ seconds: 2, endSeconds: 4 });
    }
  },
);

for (const resolution of [undefined, 480])
  test.each([false, true])(
    `explicit empty lines remain suppressed at resolution ${resolution} (skip validation: %s)`,
    (skipPreservationValidation) => {
      const source = parseBmson(
        JSON.stringify({
          version: '1.0.0',
          info: { init_bpm: 120, resolution: 240 },
          lines: [],
          sound_channels: [{ name: 'a.wav', notes: [{ x: 1, y: 240, l: 240 }] }],
        }),
      );
      const before = JSON.stringify(source);
      const output = JSON.parse(stringifyBmson(source, { resolution, skipPreservationValidation }));
      expect(output.lines).toEqual([]);
      const restored = parseBmson(JSON.stringify(output));
      expect(resolveChart(restored).barLines).toEqual([]);
      expect(computePlayFingerprint(restored, { chartPath: 'barless.bmson' })).toBe(
        computePlayFingerprint(source, { chartPath: 'barless.bmson' }),
      );
      expect(JSON.stringify(source)).toBe(before);
    },
  );
