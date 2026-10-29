import { expect, test } from 'vite-plus/test';
import { parseBmson } from '@be-music/chart-parser';
import { resolveChart } from '@be-music/chart-model';
import {
  createLaneBindings,
  resolveLaneOptionChannels,
  resolveLR2LaneIndex,
  resolveSideKeySlot,
  resolvePlayVariantLaneChannels,
} from './lane-layout.ts';
import { parseReplay } from '../replay/format.ts';
import { observePlay, tap } from './characterization/harness.ts';

function source(count: number) {
  return parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120, mode_hint: `generic-${count}keys` },
      sound_channels: [
        {
          name: 'note.wav',
          notes: [
            { x: Math.min(6, count), y: 480 },
            { x: count, y: 960 },
          ],
        },
      ],
    }),
  );
}

test.each([6, 8, 9, 10, 24, 36, 70])(
  'binds all %s generic keys in declared order on one side, including unused keys',
  (count) => {
    const resolved = resolveChart(source(count));
    const channels = resolvePlayVariantLaneChannels(resolved.notes, resolved.playVariant);
    const bindings = createLaneBindings(channels, { playVariant: resolved.playVariant });
    expect(bindings).toHaveLength(count);
    expect(bindings.map((binding) => binding.channel)).toEqual(resolved.layouts[0]!.lanes.map((lane) => lane.channel));
    expect(bindings.every((binding) => binding.side === '1P' && !binding.isScratch)).toBe(true);
    expect(new Set(bindings.flatMap((binding) => binding.inputTokens)).size).toBe(count);
    expect(resolveLaneOptionChannels('1P', resolved.playVariant, bindings)).toEqual(channels);
    expect(resolveLaneOptionChannels('2P', resolved.playVariant, bindings)).toEqual([]);
    for (const [index, binding] of bindings.entries()) {
      expect(resolveSideKeySlot(binding.channel, resolved.playVariant)).toBe(index + 1);
      expect(resolveLR2LaneIndex(binding.channel, resolved.playVariant)).toBe(-1);
    }
    if (count === 70) expect(bindings.at(-1)?.inputTokens).toEqual(['f24']);
  },
);

test.each([6, 8, 36, 70])(
  'judges generic %s keys manually, in AUTO and replay without scratch assistance',
  async (count) => {
    const chart = source(count);
    const notes = resolveChart(chart).notes;
    const script = notes.flatMap((note) => tap(note.seconds * 1000, note.channel));
    const manual = await observePlay({
      driver: 'manual',
      chart,
      script,
      options: { autoScratch: true, battleMode: 'OFF' },
    });
    const auto = await observePlay({ driver: 'auto', chart });
    expect(manual.outcome).toBe('completed');
    expect(auto.outcome).toBe('completed');
    expect(manual.summary).toMatchObject({ total: 2, perfect: 2, poor: 0 });
    const unplayed = await observePlay({ driver: 'manual', chart, options: { autoScratch: true, battleMode: 'OFF' } });
    expect(unplayed.summary).toMatchObject({ total: 2, perfect: 0, poor: 2 });
    expect(manual.summary).toEqual(auto.summary);
    expect(manual.replay?.chart.laneMode).toBe(`${count} KEY GENERIC`);
    const replay = await observePlay({
      driver: 'manual',
      chart,
      options: { replayInputs: parseReplay(JSON.stringify(manual.replay)).inputs },
    });
    expect(replay.summary).toEqual(manual.summary);
  },
);

test('NONSTOP retains one generic keyboard and rejects incompatible stage layouts explicitly', async () => {
  const { stitchNonstopCourse } = await import('../course/nonstop/compose.ts');
  const { parseBMS } = await import('@be-music/chart-parser');
  const stitched = stitchNonstopCourse([{ chart: source(36) }, { chart: source(36) }], { connections: ['cut'] });
  if (!stitched.ok) throw new Error(stitched.reason);
  expect(resolveChart(stitched.chart).playVariant).toBe('generic-36');
  const play = await observePlay({ driver: 'auto', chart: stitched.chart });
  expect(play.outcome).toBe('completed');
  expect(play.summary?.poor).toBe(0);
  for (const next of [source(8), parseBMS('#BPM 120\n#00111:01')]) {
    expect(stitchNonstopCourse([{ chart: source(36) }, { chart: next }], { connections: ['cut'] })).toEqual({
      ok: false,
      reason: 'generic-layout-mismatch',
      stage: 1,
    });
  }
});

test('empty generic charts retain the declared binding count and display label', async () => {
  const { resolveLaneDisplayMode } = await import('./lane-layout.ts');
  for (const count of [1, 8, 70]) {
    expect(createLaneBindings([], { playVariant: `generic-${count}` })).toHaveLength(count);
    expect(resolveLaneDisplayMode([], { playVariant: `generic-${count}` })).toBe(`${count} KEY GENERIC`);
  }
});
