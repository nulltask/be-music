import { expect, test } from 'vite-plus/test';
import { parseBmson, parseChart } from '@be-music/chart-parser';
import { stringifyBmson, stringifyBMS } from '@be-music/chart-writer';
import {
  MAX_GENERIC_BMSON_KEYS,
  resolveGenericBmsonKeyCount,
  resolveBmsonModeHintLayout,
  resolveChart,
  getPlayModeLayouts,
  createPlayFingerprintDocument,
  computePlayFingerprint,
  computeChartFingerprint,
} from './index.ts';

function chart(count: number, xs: number[] = [1]) {
  return parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120, mode_hint: `generic-${count}keys` },
      sound_channels: [
        { name: 'note.wav', notes: xs.map((x, index) => ({ x, y: index * 240, l: index === 1 ? 120 : 0 })) },
      ],
    }),
  );
}

test('recognizes numeric generic hints without accepting unsupported counts or truncating huge values', () => {
  expect(MAX_GENERIC_BMSON_KEYS).toBe(70);
  expect(resolveGenericBmsonKeyCount(' generic-8keys ')).toBe(8);
  expect(resolveGenericBmsonKeyCount('generic-1key')).toBe(1);
  expect(resolveGenericBmsonKeyCount('generic-070keys')).toBe(70);
  for (const value of [undefined, null, 8, 'beat-7k']) expect(resolveGenericBmsonKeyCount(value)).toBeUndefined();
  for (const value of ['generic-0keys', 'generic-71keys', 'generic-99keys', `generic-${'9'.repeat(1000)}keys`]) {
    expect(() => resolveGenericBmsonKeyCount(value)).toThrow(RangeError);
    expect(() =>
      parseBmson(JSON.stringify({ version: '1.0.0', info: { init_bpm: 120, mode_hint: value }, sound_channels: [] })),
    ).toThrow(RangeError);
  }
});

test.each([1, 6, 7, 8, 9, 10, 14, 24, 35, 36, 48, 70])(
  'retains a sparse %s-key generic keyboard as its own variant with every key and no FREE ZONE',
  (count) => {
    const xs = [...new Set([1, Math.min(6, count), Math.min(7, count), count])];
    const json = chart(count, xs);
    const resolved = resolveChart(json);
    expect(resolved.playVariant).toBe(`generic-${count}`);
    expect(resolved.layouts).toHaveLength(1);
    const layout = resolved.layouts[0]!;
    expect(layout.label).toBe(`${count} KEY GENERIC`);
    expect(layout.lanes).toHaveLength(count);
    expect(layout.freeZones).toEqual([]);
    expect(new Set(layout.lanes.map((lane) => lane.channel)).size).toBe(count);
    expect(layout.lanes.every((lane) => lane.kind === 'key' && lane.side === '1P')).toBe(true);
    expect(layout.lanes.map((lane) => lane.slot)).toEqual(Array.from({ length: count }, (_, index) => index + 1));
    expect(resolved.notes).toHaveLength(xs.length);
    expect(resolved.notes.every((note) => !note.freeZone)).toBe(true);
    const mapping = resolveBmsonModeHintLayout(`generic-${count}keys`)!;
    expect(mapping.channelByX.size).toBe(count);
    if (count >= 36) expect(mapping.channelByX.get(36)).toBe('21');
    if (count === 70) expect(mapping.channelByX.get(70)).toBe('2Z');
    const canonical = structuredClone(json);
    canonical.preservation.bmson.soundChannels = [];
    for (const rebuilt of [parseChart(JSON.stringify(json), 'json'), parseBmson(stringifyBmson(canonical))]) {
      expect(resolveChart(rebuilt).playVariant).toBe(resolved.playVariant);
      expect(resolveChart(rebuilt).notes.map((note) => [note.channel, note.seconds, note.endSeconds])).toEqual(
        resolved.notes.map((note) => [note.channel, note.seconds, note.endSeconds]),
      );
    }
  },
);

test('generic layout identity contributes to chart and play fingerprints even with identical sparse notes', () => {
  const a = chart(6),
    b = chart(8);
  expect(createPlayFingerprintDocument(a, { chartPath: undefined }).laneMode).toBe('generic-6');
  expect(createPlayFingerprintDocument(b, { chartPath: undefined }).laneMode).toBe('generic-8');
  expect(computePlayFingerprint(a, { chartPath: undefined })).not.toBe(
    computePlayFingerprint(b, { chartPath: undefined }),
  );
  expect(computeChartFingerprint(a, { chartPath: undefined })).not.toBe(
    computeChartFingerprint(b, { chartPath: undefined }),
  );
});

test('rejects BMS export rather than changing generic keys into scratch and FREE ZONE', () => {
  for (const skipPreservationValidation of [false, true])
    expect(() => stringifyBMS(chart(8, [6, 7]), { skipPreservationValidation })).toThrow(/Generic bmson layouts/);
});

test('rejects unsupported generic host variants explicitly', () => {
  for (const variant of ['generic-0', 'generic-71', 'generic-1.5'] as const)
    expect(() => getPlayModeLayouts(variant)).toThrow();
});

test.each(['generic-foo', 'generic-1.5keys', 'generic--1keys', 'generic-Infinitykeys'])(
  'rejects malformed generic syntax %s without beat-mode fallback',
  (hint) => {
    expect(() => resolveGenericBmsonKeyCount(hint)).toThrow(TypeError);
    expect(() =>
      parseBmson(JSON.stringify({ version: '1.0.0', info: { init_bpm: 120, mode_hint: hint }, sound_channels: [] })),
    ).toThrow(TypeError);
  },
);
