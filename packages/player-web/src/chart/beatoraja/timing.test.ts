import { createEmptyJson, type BeMusicJson } from '@be-music/json';
import { describe, expect, it } from 'vitest';
import {
  beatorajaEventBeat,
  collectBeatorajaChartTimedEntries,
  collectBeatorajaChartTimingEntries,
  computeBeatorajaMeasureLayout,
  hasBeatorajaEventValue,
  isBeatorajaBpmEventChannel,
  isBeatorajaStopEventChannel,
  resolveBeatorajaBpmEventValue,
  resolveBeatorajaInitialBpm,
  resolveBeatorajaStopDurationBeats,
} from './timing.ts';

type ChartOverrides = Omit<Partial<BeMusicJson>, 'metadata' | 'resources'> & {
  metadata?: Partial<BeMusicJson['metadata']>;
  resources?: Partial<BeMusicJson['resources']>;
};

function chartWith(overrides: ChartOverrides): BeMusicJson {
  const empty = createEmptyJson();
  return {
    ...empty,
    ...overrides,
    metadata: { ...empty.metadata, ...overrides.metadata },
    resources: { ...empty.resources, ...overrides.resources },
  };
}

describe('beatoraja timing helpers', () => {
  it('computes measure base beats with declared lengths and event-referenced trailing measures', () => {
    const chart = chartWith({
      measures: [
        { index: 0, length: 0.5 },
        { index: 2, length: 2 },
      ],
      events: [{ measure: 3, channel: '11', position: [0, 1], value: '01' }],
    });

    expect(computeBeatorajaMeasureLayout(chart)).toEqual({
      measureBaseBeat: [0, 2, 6, 14],
      totalBeats: 18,
    });
  });

  it('computes event beats using the existing standard-measure intra-position approximation', () => {
    const measureBaseBeat = [0, 2, 6];

    expect(beatorajaEventBeat({ measure: 2, position: [1, 2] }, measureBaseBeat)).toBe(8);
    expect(beatorajaEventBeat({ measure: 2, position: [1, 0] }, measureBaseBeat)).toBe(6);
    expect(beatorajaEventBeat({ measure: 9, position: [0, 1] }, measureBaseBeat)).toBeUndefined();
  });

  it('filters empty event values consistently', () => {
    expect(hasBeatorajaEventValue('')).toBe(false);
    expect(hasBeatorajaEventValue('00')).toBe(false);
    expect(hasBeatorajaEventValue('01')).toBe(true);
  });

  it('resolves the initial BPM with beatoraja fallback semantics', () => {
    expect(resolveBeatorajaInitialBpm(chartWith({ metadata: { title: '', bpm: 175 } }))).toBe(175);
    expect(resolveBeatorajaInitialBpm(chartWith({ metadata: { title: '', bpm: 0 } }))).toBe(130);
  });

  it('classifies BPM and STOP timing channels', () => {
    expect(isBeatorajaBpmEventChannel('03')).toBe(true);
    expect(isBeatorajaBpmEventChannel('08')).toBe(true);
    expect(isBeatorajaBpmEventChannel('09')).toBe(false);
    expect(isBeatorajaStopEventChannel('09')).toBe(true);
    expect(isBeatorajaStopEventChannel('08')).toBe(false);
  });

  it('resolves BPM event values from inline hex and case-insensitive table keys', () => {
    expect(resolveBeatorajaBpmEventValue('03', 'F0')).toBe(240);
    expect(resolveBeatorajaBpmEventValue('08', 'aa', { AA: '175.5' })).toBe(175.5);
    expect(resolveBeatorajaBpmEventValue('08', 'BB', { bb: 90 })).toBe(90);
    expect(resolveBeatorajaBpmEventValue('09', 'AA', { AA: 120 })).toBeUndefined();
  });

  it('resolves STOP table values into beat durations', () => {
    expect(resolveBeatorajaStopDurationBeats('XX', { xx: 192 })).toBe(4);
    expect(resolveBeatorajaStopDurationBeats('YY', { YY: '96' })).toBe(2);
    expect(resolveBeatorajaStopDurationBeats('ZZ', { ZZ: 0 })).toBeUndefined();
  });

  it('collects resolved BPM and STOP timing entries in beat order', () => {
    const chart = chartWith({
      metadata: { title: '', bpm: 130 },
      resources: {
        bpm: { AA: 180 },
        stop: { BB: 96 },
      },
      events: [
        { measure: 0, channel: '11', position: [1, 2], value: '01' },
        { measure: 0, channel: '09', position: [1, 2], value: 'BB' },
        { measure: 0, channel: '08', position: [1, 2], value: 'AA' },
        { measure: 1, channel: '03', position: [0, 1], value: '78' },
        { measure: 1, channel: '08', position: [1, 2], value: 'ZZ' },
        { measure: 1, channel: '09', position: [1, 2], value: 'ZZ' },
      ],
    });

    expect(collectBeatorajaChartTimingEntries(chart)).toEqual([
      { beat: 2, kind: 'bpm', bpm: 180 },
      { beat: 2, kind: 'stop', durationBeats: 2 },
      { beat: 4, kind: 'bpm', bpm: 120 },
    ]);
  });

  it('collects note entries after same-beat timing entries', () => {
    const chart = chartWith({
      metadata: { title: '', bpm: 130 },
      resources: {
        bpm: { AA: 180 },
        stop: { BB: 96 },
      },
      events: [
        { measure: 0, channel: '11', position: [1, 2], value: '01' },
        { measure: 0, channel: '09', position: [1, 2], value: 'BB' },
        { measure: 0, channel: '08', position: [1, 2], value: 'AA' },
      ],
    });
    const measureBaseBeat = computeBeatorajaMeasureLayout(chart).measureBaseBeat;

    expect(
      collectBeatorajaChartTimedEntries(chart, measureBaseBeat, (event) =>
        event.channel === '11' ? { channel: event.channel, value: event.value } : undefined,
      ),
    ).toEqual([
      { beat: 2, kind: 'bpm', bpm: 180 },
      { beat: 2, kind: 'stop', durationBeats: 2 },
      { beat: 2, kind: 'note', note: { channel: '11', value: '01' } },
    ]);
  });
});
