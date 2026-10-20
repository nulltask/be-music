import { describe, expect, it } from 'vite-plus/test';
import { resolveChart } from '@be-music/chart-model';
import type { BeMusicJSON } from '@be-music/chart-source';
import { parseBMS } from '@be-music/chart-parser';
import { preparePlaybackChart } from '@be-music/player-engine';
import { flipDPChannel as flipPreparedChannel } from '../../session/play/play-chart.ts';
import { flipDPChannel, flipDPChart } from './dp-flip.ts';

describe('flipDPChannel', () => {
  it('swaps the side digit on visible (1X ↔ 2X) channels', () => {
    expect(flipDPChannel('11')).toBe('21');
    expect(flipDPChannel('15')).toBe('25');
    expect(flipDPChannel('19')).toBe('29');
    expect(flipDPChannel('21')).toBe('11');
    expect(flipDPChannel('29')).toBe('19');
    // Scratch lane 6 — same swap rule applies, beatoraja DP flip mirrors scratches too.
    expect(flipDPChannel('16')).toBe('26');
    expect(flipDPChannel('26')).toBe('16');
  });

  it('swaps invisible (3X ↔ 4X) channels', () => {
    expect(flipDPChannel('31')).toBe('41');
    expect(flipDPChannel('48')).toBe('38');
  });

  it('swaps LN (5X ↔ 6X) channels', () => {
    expect(flipDPChannel('51')).toBe('61');
    expect(flipDPChannel('69')).toBe('59');
  });

  it('swaps landmine (DX ↔ EX) channels', () => {
    expect(flipDPChannel('D1')).toBe('E1');
    expect(flipDPChannel('E5')).toBe('D5');
  });

  it('leaves non-flippable channels (BPM 03, BGA 04, sound 01) alone', () => {
    expect(flipDPChannel('01')).toBe('01'); // BGM key sound
    expect(flipDPChannel('03')).toBe('03'); // BPM
    expect(flipDPChannel('04')).toBe('04'); // BGA
    expect(flipDPChannel('06')).toBe('06'); // POOR BGA
    expect(flipDPChannel('07')).toBe('07'); // BGA layer
    expect(flipDPChannel('09')).toBe('09'); // STOP
  });

  it('returns the original string for short / malformed channels', () => {
    expect(flipDPChannel('')).toBe('');
    expect(flipDPChannel('1')).toBe('1');
    expect(flipDPChannel('111')).toBe('111');
  });
});

describe('flipDPChart', () => {
  function makeChart(events: ReadonlyArray<{ channel: string; value?: string }>): BeMusicJSON {
    return {
      events: events.map((e, i) => ({
        measure: 0,
        channel: e.channel,
        position: { numerator: i, denominator: 1 },
        value: e.value ?? '01',
      })),
    } as unknown as BeMusicJSON;
  }

  it('flips every flippable channel and leaves others alone', () => {
    const original = makeChart([
      { channel: '11' }, // 1P key 1
      { channel: '25' }, // 2P key 5
      { channel: '03' }, // BPM (unchanged)
      { channel: '52' }, // 1P LN key 2
      { channel: 'D7' }, // 1P landmine key 7
    ]);
    const flipped = flipDPChart(original);
    const channels = flipped.events.map((e: { channel: string }) => e.channel);
    expect(channels).toEqual(['21', '15', '03', '62', 'E7']);
  });

  it('returns the SAME object reference when no flippable channel exists (fast-path)', () => {
    const original = makeChart([{ channel: '01' }, { channel: '03' }, { channel: '04' }]);
    const flipped = flipDPChart(original);
    expect(flipped).toBe(original);
  });

  it('is idempotent only over double-flip (flip twice == original)', () => {
    const original = makeChart([{ channel: '11' }, { channel: '29' }, { channel: 'D5' }]);
    const twice = flipDPChart(flipDPChart(original));
    const channels = twice.events.map((e: { channel: string }) => e.channel);
    expect(channels).toEqual(['11', '29', 'D5']);
  });

  it('does not mutate the input chart', () => {
    const original = makeChart([{ channel: '11' }]);
    const originalChannelsBefore = original.events.map((e: { channel: string }) => e.channel);
    flipDPChart(original);
    const originalChannelsAfter = original.events.map((e: { channel: string }) => e.channel);
    expect(originalChannelsAfter).toEqual(originalChannelsBefore);
  });
});

/**
 * The play session applies DP FLIP to the prepared notes (`prepareChart`) where the beatoraja play used to flip the chart
 * before preparing it: both must give the same notes, lanes and timing.
 */
describe('DP FLIP on the prepared notes', () => {
  const DP_CHART = [
    '#PLAYER 3',
    '#BPM 150',
    '#LNTYPE 1',
    '#WAV01 a.wav',
    '#WAV02 b.wav',
    '#00111:0102000001',
    '#00116:01000000',
    '#00121:00010200',
    '#00126:00000001',
    '#00128:0100',
    '#00151:01000001',
    '#00162:00010001',
    '#00131:00000100',
    '#00142:01000000',
    '#001D3:00010000',
    '#001E5:00000001',
    '#00211:01010101',
    '#00229:01000000',
  ].join('\n');

  type Prepared = ReturnType<typeof preparePlaybackChart>;

  function prepare(json: BeMusicJSON): Prepared {
    return preparePlaybackChart(resolveChart(json, { playVariant: '14', inferBmsLNTypeWhenMissing: true }), {}, 0);
  }

  function lanes(notes: Prepared['notes']): string[] {
    return notes
      .map(
        (note) => `${note.channel}@${note.beat}${note.endBeat !== undefined ? `-${note.endBeat}` : ''}:${note.seconds}`,
      )
      .sort();
  }

  it('flipping the chart before preparing it gives the notes flipping the prepared notes does', () => {
    const chart = parseBMS(DP_CHART);
    const fromFlippedChart = prepare(flipDPChart(chart));
    const flippedNotes = prepare(chart);
    for (const list of [flippedNotes.notes, flippedNotes.landmineNotes, flippedNotes.invisibleNotes]) {
      for (const note of list) note.channel = flipPreparedChannel(note.channel);
    }
    expect(lanes(flippedNotes.notes)).toEqual(lanes(fromFlippedChart.notes));
    expect(lanes(flippedNotes.landmineNotes)).toEqual(lanes(fromFlippedChart.landmineNotes));
    expect(lanes(flippedNotes.invisibleNotes)).toEqual(lanes(fromFlippedChart.invisibleNotes));
    // The chart has notes on both sides of every kind, so the flip moved something of each.
    expect(lanes(flippedNotes.notes)).not.toEqual(lanes(prepare(chart).notes));
    expect(fromFlippedChart.landmineNotes.length).toBeGreaterThan(0);
    expect(fromFlippedChart.invisibleNotes.length).toBeGreaterThan(0);
    expect(fromFlippedChart.notes.some((note) => note.endBeat !== undefined)).toBe(true);
  });
});
