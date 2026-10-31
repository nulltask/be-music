import { expect, test } from 'vite-plus/test';
import { parseBmson, parseChart } from '@be-music/chart-parser';
import { cloneJSON } from '@be-music/chart-source';
import { computePlayFingerprint, resolveChart } from '@be-music/chart-model';
import { stringifyBmson } from './index.ts';

const annotation = (label: string) => ({ nested: { tags: [label, null, false] } });
function document() {
  return {
    version: '1.0.0',
    vendor: annotation('root'),
    extraFields: 'source-key',
    info: { init_bpm: 120, resolution: 240, mode_hint: 'beat-7k', vendor: annotation('info') },
    lines: [
      { y: 0, vendor: annotation('line') },
      { y: 960, vendor: 'end' },
    ],
    bpm_events: [{ y: 240, bpm: 180, vendor: annotation('bpm') }],
    stop_events: [{ y: 480, duration: 120, vendor: annotation('stop') }],
    scroll_events: [{ y: 720, rate: 0.5, vendor: annotation('scroll') }],
    sound_channels: [
      {
        name: 'a.wav',
        vendor: annotation('channel'),
        notes: [
          { x: 1, y: 0, l: 240, c: false, t: 3, vendor: annotation('long') },
          { x: 2, y: 480, vendor: annotation('tap') },
          { x: 0, y: 600, vendor: 'bgm' },
        ],
      },
    ],
    key_channels: [
      { name: 'hidden.wav', vendor: 'hidden-channel', notes: [{ x: 3, y: 600, damage: 0, vendor: 'hidden' }] },
    ],
    mine_channels: [{ name: 'mine.wav', vendor: 'mine-channel', notes: [{ x: 4, y: 720, damage: 8, vendor: 'mine' }] }],
    bga: {
      vendor: annotation('bga'),
      bga_header: [{ id: 1, name: 'a.png', vendor: annotation('header') }],
      bga_events: [{ y: 0, id: 1, vendor: 'base' }],
      layer_events: [{ y: 0, id_set: [1], condition: 'play', interval: 100, vendor: 'layer' }],
      poor_events: [{ y: 0, id: 1, vendor: 'poor' }],
      bga_sequence: [
        {
          id: 1,
          vendor: 'sequence',
          sequence: [
            { time: 0, id: 0, vendor: 'frame' },
            { time: 100, vendor: 'end-frame' },
          ],
        },
      ],
    },
  };
}
const parse = () => parseBmson(JSON.stringify(document()));

test.each([false, true])('all populated scopes survive direct and Be-Music JSON output (IR reparse: %s)', (viaJSON) => {
  let chart = parse();
  if (viaJSON) chart = parseChart(JSON.stringify(chart), 'json');
  const output = JSON.parse(stringifyBmson(chart));
  const source = document();
  expect(output.vendor).toEqual(source.vendor);
  expect(output.extraFields).toBe('source-key');
  expect(output.info.vendor).toEqual(source.info.vendor);
  expect(output.lines.map((line: { vendor: unknown }) => line.vendor)).toEqual(source.lines.map((line) => line.vendor));
  for (const key of ['bpm_events', 'stop_events', 'scroll_events'] as const)
    expect(output[key][0].vendor).toEqual(source[key][0]!.vendor);
  expect(output.sound_channels[0].vendor).toEqual(source.sound_channels[0]!.vendor);
  expect(output.sound_channels[0].notes.map((note: { vendor: unknown }) => note.vendor)).toEqual(
    source.sound_channels[0]!.notes.map((note) => note.vendor),
  );
  expect(output.key_channels[0]).toMatchObject(source.key_channels[0]!);
  expect(output.mine_channels[0]).toMatchObject(source.mine_channels[0]!);
  // An omitted event id stays omitted (#855).
  expect(output.bga).toEqual(source.bga);
});

test('annotations follow edited notes, removed notes disappear, and channel containers keep their own data', () => {
  const chart = parse();
  const tap = chart.events.find(
    (event) =>
      event.bmson?.extraFields?.vendor && typeof event.bmson.extraFields.vendor === 'object' && event.channel === '12',
  )!;
  tap.channel = '15';
  tap.position = [3, 4];
  chart.events = chart.events.filter((event) => event.channel !== '11').reverse();
  const output = JSON.parse(stringifyBmson(chart));
  const note = output.sound_channels[0].notes.find((note: { vendor?: unknown }) => typeof note.vendor === 'object');
  expect(note).toMatchObject({ x: 5, y: 720, vendor: annotation('tap') });
  expect(output.sound_channels[0].notes).toHaveLength(2);
  expect(output.sound_channels[0].vendor).toEqual(annotation('channel'));
});

test('opaque edits invalidate preservation rather than restoring stale source annotations', () => {
  const chart = parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120 },
      sound_channels: [{ name: 'a.wav', vendor: 'old-channel', notes: [{ x: 1, y: 0, vendor: 'old-note' }] }],
    }),
  );
  chart.bmson.channelExtraFields!['01']!.vendor = 'new-channel';
  chart.events[0]!.bmson!.extraFields!.vendor = 'new-note';
  expect(JSON.parse(stringifyBmson(chart)).sound_channels[0]).toMatchObject({
    vendor: 'new-channel',
    notes: [{ vendor: 'new-note' }],
  });
});

test('unknown-only BGA and empty annotated channels remain available after canonical rewriting', () => {
  const chart = parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120 },
      sound_channels: [{ name: 'unused.wav', vendor: 'sound', notes: [] }],
      key_channels: [{ name: 'hidden.wav', vendor: 'key', notes: [] }],
      mine_channels: [{ name: 'mine.wav', vendor: 'mine', notes: [] }],
      bga: { vendor: 'container' },
    }),
  );
  const output = JSON.parse(stringifyBmson(chart));
  expect(output.sound_channels[0]).toMatchObject({ vendor: 'sound', notes: [] });
  expect(output.key_channels[0]).toMatchObject({ vendor: 'key', notes: [] });
  expect(output.mine_channels[0]).toMatchObject({ vendor: 'mine', notes: [] });
  expect(output.bga.vendor).toBe('container');
});

test('cloning owns annotations throughout nodes, preservation arrays and channel maps', () => {
  const source = parse();
  const before = JSON.stringify(source);
  const copy = cloneJSON(source);
  const fields = [
    copy.bmson.extraFields,
    copy.bmson.info.extraFields,
    copy.bmson.bga.extraFields,
    copy.bmson.bga.header[0]!.extraFields,
    copy.bmson.channelExtraFields!['01'],
    copy.events.find((event) => event.channel === '11')!.bmson!.extraFields,
    copy.preservation.bmson.soundChannels[0]!.extraFields,
    copy.preservation.bmson.soundChannels[0]!.notes[0]!.extraFields,
  ];
  for (const extra of fields) (extra!.vendor as { nested: { tags: unknown[] } }).nested.tags.push('changed');
  expect(JSON.stringify(source)).toBe(before);
});

test('unknown data never changes effective notes, audio slices or fingerprints', () => {
  const chart = parse();
  const plain = parseBmson(
    JSON.stringify(document(), (key, value) => (key === 'vendor' || key === 'extraFields' ? undefined : value)),
  );
  const project = (chart: ReturnType<typeof parse>) => {
    const resolved = resolveChart(chart);
    return {
      notes: resolved.notes.map((note) => [note.channel, note.beat, note.endBeat, note.lnMode]),
      triggers: resolved.sampleTriggers.map((trigger) => [
        trigger.samplePath,
        trigger.seconds,
        trigger.sampleOffsetSeconds,
        trigger.sampleDurationSeconds,
      ]),
    };
  };
  expect(project(chart)).toEqual(project(plain));
  expect(computePlayFingerprint(chart, { chartPath: 'chart.bmson' })).toBe(
    computePlayFingerprint(plain, { chartPath: 'chart.bmson' }),
  );
});

test('supported fields cannot be injected through envelopes, including omitted or invalid known values', () => {
  const chart = parse();
  chart.bmson.extraFields!.version = '9.0.0';
  chart.bmson.info.extraFields!.init_bpm = -1;
  chart.bmson.info.extraFields!.total = 999;
  chart.bmson.bga.extraFields!.bga_header = [];
  const event = chart.events.find((event) => event.channel === '12')!;
  event.bmson!.extraFields!.x = 70;
  event.bmson!.extraFields!.l = 999;
  const output = JSON.parse(stringifyBmson(chart));
  expect(output.version).toBe('1.0.0');
  expect(output.info.init_bpm).toBe(120);
  expect(output.info.total).not.toBe(999);
  expect(output.sound_channels[0].notes.find((note: { x: number }) => note.x === 2).l).toBe(0);
  expect(output.bga.bga_header).toHaveLength(1);
});

test('same-filename channels keep independent annotations when canonical emission changes their order', () => {
  const chart = parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120 },
      sound_channels: [
        { name: 'shared.wav', vendor: 'first', notes: [{ x: 1, y: 480, vendor: 'late' }] },
        { name: 'shared.wav', vendor: 'second', notes: [{ x: 2, y: 0, vendor: 'early' }] },
      ],
    }),
  );
  chart.events[0]!.position = [1, 4];
  const output = JSON.parse(stringifyBmson(chart));
  expect(
    output.sound_channels
      .map((channel: { vendor: string; notes: Array<{ vendor: string }> }) => [
        channel.vendor,
        channel.notes[0]?.vendor,
      ])
      .sort(),
  ).toEqual([
    ['first', 'late'],
    ['second', 'early'],
  ]);
});

test('native output preserves literal prototype-looking keys without executing or applying them', () => {
  const source =
    '{"version":"1.0.0","info":{"init_bpm":120},"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"toString":"annotation"}';
  const output = JSON.parse(stringifyBmson(parseChart(JSON.stringify(parseBmson(source)), 'json')));
  expect(Object.hasOwn(output, '__proto__')).toBe(true);
  expect(output.__proto__).toEqual({ polluted: true });
  expect(output.constructor).toEqual({ prototype: { polluted: true } });
  expect(output.toString).toBe('annotation');
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});

test('a note moved from an annotated hidden channel does not duplicate its container metadata', () => {
  const chart = parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120 },
      key_channels: [{ name: 'a.wav', vendor: 'channel', notes: [{ x: 1, y: 240, vendor: 'note' }] }],
    }),
  );
  chart.events[0]!.channel = '11';
  const output = JSON.parse(stringifyBmson(chart));
  expect(output.sound_channels[0]).toMatchObject({ vendor: 'channel', notes: [{ vendor: 'note' }] });
  expect(output.key_channels).toBeUndefined();
});

test('barline annotations follow the writer’s explicit resolution conversion', () => {
  const output = JSON.parse(stringifyBmson(parse(), { resolution: 480 }));
  expect(output.lines).toEqual([
    { y: 0, vendor: annotation('line') },
    { y: 1920, vendor: 'end' },
  ]);
});
