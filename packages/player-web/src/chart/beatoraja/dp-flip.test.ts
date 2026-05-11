import { describe, expect, it } from 'vitest';
import type { BeMusicJson } from '@be-music/json';
import { flipDpChannel, flipDpChart } from './dp-flip.ts';

describe('flipDpChannel', () => {
  it('swaps the side digit on visible (1X ↔ 2X) channels', () => {
    expect(flipDpChannel('11')).toBe('21');
    expect(flipDpChannel('15')).toBe('25');
    expect(flipDpChannel('19')).toBe('29');
    expect(flipDpChannel('21')).toBe('11');
    expect(flipDpChannel('29')).toBe('19');
    // Scratch lane 6 — same swap rule applies, beatoraja DP flip mirrors scratches too.
    expect(flipDpChannel('16')).toBe('26');
    expect(flipDpChannel('26')).toBe('16');
  });

  it('swaps invisible (3X ↔ 4X) channels', () => {
    expect(flipDpChannel('31')).toBe('41');
    expect(flipDpChannel('48')).toBe('38');
  });

  it('swaps LN (5X ↔ 6X) channels', () => {
    expect(flipDpChannel('51')).toBe('61');
    expect(flipDpChannel('69')).toBe('59');
  });

  it('swaps landmine (DX ↔ EX) channels', () => {
    expect(flipDpChannel('D1')).toBe('E1');
    expect(flipDpChannel('E5')).toBe('D5');
  });

  it('leaves non-flippable channels (BPM 03, BGA 04, sound 01) alone', () => {
    expect(flipDpChannel('01')).toBe('01'); // BGM key sound
    expect(flipDpChannel('03')).toBe('03'); // BPM
    expect(flipDpChannel('04')).toBe('04'); // BGA
    expect(flipDpChannel('06')).toBe('06'); // POOR BGA
    expect(flipDpChannel('07')).toBe('07'); // BGA layer
    expect(flipDpChannel('09')).toBe('09'); // STOP
  });

  it('returns the original string for short / malformed channels', () => {
    expect(flipDpChannel('')).toBe('');
    expect(flipDpChannel('1')).toBe('1');
    expect(flipDpChannel('111')).toBe('111');
  });
});

describe('flipDpChart', () => {
  function makeChart(events: ReadonlyArray<{ channel: string; value?: string }>): BeMusicJson {
    return {
      events: events.map((e, i) => ({
        measure: 0,
        channel: e.channel,
        position: { numerator: i, denominator: 1 },
        value: e.value ?? '01',
      })),
    } as unknown as BeMusicJson;
  }

  it('flips every flippable channel and leaves others alone', () => {
    const original = makeChart([
      { channel: '11' }, // 1P key 1
      { channel: '25' }, // 2P key 5
      { channel: '03' }, // BPM (unchanged)
      { channel: '52' }, // 1P LN key 2
      { channel: 'D7' }, // 1P landmine key 7
    ]);
    const flipped = flipDpChart(original);
    const channels = flipped.events.map((e: { channel: string }) => e.channel);
    expect(channels).toEqual(['21', '15', '03', '62', 'E7']);
  });

  it('returns the SAME object reference when no flippable channel exists (fast-path)', () => {
    const original = makeChart([{ channel: '01' }, { channel: '03' }, { channel: '04' }]);
    const flipped = flipDpChart(original);
    expect(flipped).toBe(original);
  });

  it('is idempotent only over double-flip (flip twice == original)', () => {
    const original = makeChart([{ channel: '11' }, { channel: '29' }, { channel: 'D5' }]);
    const twice = flipDpChart(flipDpChart(original));
    const channels = twice.events.map((e: { channel: string }) => e.channel);
    expect(channels).toEqual(['11', '29', 'D5']);
  });

  it('does not mutate the input chart', () => {
    const original = makeChart([{ channel: '11' }]);
    const originalChannelsBefore = original.events.map((e: { channel: string }) => e.channel);
    flipDpChart(original);
    const originalChannelsAfter = original.events.map((e: { channel: string }) => e.channel);
    expect(originalChannelsAfter).toEqual(originalChannelsBefore);
  });
});
