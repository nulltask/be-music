import { expect, test } from 'vite-plus/test';
import { parseBmson, parseChart } from '@be-music/chart-parser';
import { cloneJSON } from '@be-music/chart-source';
import { resolveChart } from '@be-music/chart-model';
import { stringifyBmson, stringifyBMS } from './index.ts';

function chart(endFirst = false) {
  const channels = [
    { name: 'head.wav', notes: [{ x: 1, y: 0, l: 240, t: 3, up: false }] },
    { name: 'end.wav', notes: [{ x: 1, y: 240, c: true, up: true }] },
  ];
  return parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120, resolution: 240, ln_type: 2 },
      sound_channels: endFirst ? channels.reverse() : channels,
    }),
  );
}

test.each([false, true])('pairs up definitions independently of sound-channel order (end first: %s)', (endFirst) => {
  const source = chart(endFirst);
  const resolved = resolveChart(source);
  expect(resolved.notes).toHaveLength(1);
  expect(resolved.notes[0]).toMatchObject({ kind: 'ln', endSeconds: 0.5, lnMode: 3 });
  const end = resolved.notes[0]!.endSoundEvent!;
  expect(end.bmson).toMatchObject({ up: true, c: true });
  expect(source.resources.wav[end.value]).toBe('end.wav');
  expect(resolved.sampleTriggers.map((trigger) => trigger.samplePath)).toEqual(['head.wav', 'end.wav']);
});

test('preserves up, explicit false and t through bmson, clone and Be-Music JSON round trips', () => {
  for (const source of [chart(), cloneJSON(chart()), parseChart(JSON.stringify(chart()), 'json')]) {
    for (const canonical of [false, true]) {
      if (canonical) source.metadata.title = 'Edited';
      const output = JSON.parse(stringifyBmson(source));
      expect(output.sound_channels[0].notes[0]).toMatchObject({ t: 3, up: false });
      expect(output.sound_channels[1].notes[0]).toMatchObject({ up: true, c: true });
      expect(resolveChart(parseBmson(JSON.stringify(output))).notes).toHaveLength(1);
    }
  }
});

test('editing only the up flag invalidates the preservation fast path', () => {
  const source = chart();
  source.events.find((event) => event.bmson?.up === true)!.bmson!.up = false;
  const output = JSON.parse(stringifyBmson(source));
  expect(output.sound_channels[1].notes[0].up).toBe(false);
  expect(resolveChart(parseBmson(JSON.stringify(output))).notes).toHaveLength(2);
});

test('unmatched and overwritten up definitions stay preserved without becoming judged or audible taps', () => {
  const source = chart();
  source.resources.wav['03'] = 'later-end.wav';
  source.events.push(
    { measure: 0, channel: '11', position: [1, 4], value: '03', bmson: { up: true } },
    { measure: 0, channel: '12', position: [1, 2], value: '03', bmson: { up: true } },
  );
  const resolved = resolveChart(source);
  expect(resolved.notes).toHaveLength(1);
  expect(resolved.notes[0]!.endSoundEvent!.value).toBe('03');
  expect(resolved.sampleTriggers.map((trigger) => trigger.samplePath)).toEqual(['head.wav', 'later-end.wav']);
  expect(
    JSON.parse(stringifyBmson(source))
      .sound_channels.flatMap((channel: { notes: { up?: boolean }[] }) => channel.notes)
      .filter((note: { up?: boolean }) => note.up),
  ).toHaveLength(3);
});

test('up on BGM remains BGM, while nonboolean up is ignored', () => {
  const source = parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120 },
      sound_channels: [
        {
          name: 'bgm.wav',
          notes: [
            { x: 0, y: 0, up: true },
            { x: 1, y: 240, up: 'true' },
          ],
        },
      ],
    }),
  );
  expect(resolveChart(source).notes).toHaveLength(1);
  expect(resolveChart(source).sampleTriggers).toHaveLength(2);
  expect(source.events.find((event) => event.channel === '11')?.bmson?.up).toBeUndefined();
});

test('lossy BMS conversion drops the end sound instead of creating an extra tap', () => {
  const converted = parseChart(stringifyBMS(chart()), 'bms');
  expect(resolveChart(converted).notes).toHaveLength(1);
  expect(resolveChart(converted).notes[0]?.kind).toBe('ln');
});
