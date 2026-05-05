import { describe, expect, test } from 'vitest';
import {
  resolveLaneChannels,
  resolveLr2LaneIndex,
  resolveSideKeySlot,
  resolveSideRelativeLaneIndex,
} from './lane-layout.ts';

describe('resolveSideKeySlot', () => {
  test('IIDX-side default — 11..15 → 1..5, 16/26 → 0 (scratch), 18/19 → 6/7', () => {
    expect(resolveSideKeySlot('11')).toBe(1);
    expect(resolveSideKeySlot('15')).toBe(5);
    expect(resolveSideKeySlot('16')).toBe(0);
    expect(resolveSideKeySlot('26')).toBe(0);
    expect(resolveSideKeySlot('18')).toBe(6);
    expect(resolveSideKeySlot('19')).toBe(7);
  });

  test('PMS / 9 KEY (COMPAT) — 11..19 each map to lane slots 1..9', () => {
        // Channels 16, 17, 18, 19 are LANE NOTES under 9KEY-COMPAT (not scratch / FREE ZONE), so they get distinct slots 6,
    // 7, 8, 9 — matching `play_9.lr2skin`'s `#SRC_NOTE,1..9`.
    expect(resolveSideKeySlot('11', '9')).toBe(1);
    expect(resolveSideKeySlot('15', '9')).toBe(5);
    expect(resolveSideKeySlot('16', '9')).toBe(6);
    expect(resolveSideKeySlot('17', '9')).toBe(7);
    expect(resolveSideKeySlot('18', '9')).toBe(8);
    expect(resolveSideKeySlot('19', '9')).toBe(9);
  });

  test('PMS / 9 KEY (STD) — 22..25 map to slots 6..9 of the 1P-side bank', () => {
    expect(resolveSideKeySlot('22', '9')).toBe(6);
    expect(resolveSideKeySlot('23', '9')).toBe(7);
    expect(resolveSideKeySlot('24', '9')).toBe(8);
    expect(resolveSideKeySlot('25', '9')).toBe(9);
    // Channels outside the PMS-STD 22..25 band on the 2P side are rejected — there's no `#SRC_NOTE` slot for them.
    expect(resolveSideKeySlot('21', '9')).toBe(-1);
    expect(resolveSideKeySlot('28', '9')).toBe(-1);
  });
});

describe('resolveLr2LaneIndex', () => {
  test('IIDX-side — 1P stays at 0..7, 2P offsets by 10', () => {
    expect(resolveLr2LaneIndex('11')).toBe(1);
    expect(resolveLr2LaneIndex('16')).toBe(0);
    expect(resolveLr2LaneIndex('19')).toBe(7);
    expect(resolveLr2LaneIndex('21')).toBe(11);
    expect(resolveLr2LaneIndex('26')).toBe(10);
    expect(resolveLr2LaneIndex('29')).toBe(17);
  });

  test('PMS / 9 KEY — single-side; both layouts collapse onto slots 1..9', () => {
    // COMPAT
    expect(resolveLr2LaneIndex('11', '9')).toBe(1);
    expect(resolveLr2LaneIndex('17', '9')).toBe(7);
    expect(resolveLr2LaneIndex('19', '9')).toBe(9);
    // STD
    expect(resolveLr2LaneIndex('22', '9')).toBe(6);
    expect(resolveLr2LaneIndex('25', '9')).toBe(9);
  });
});

describe('resolveLaneChannels', () => {
  test('IIDX default — `17` and unsupported channels are filtered out', () => {
    const notes = [
      { channel: '11' },
      { channel: '15' },
      { channel: '17' }, // FREE ZONE on IIDX-side — should NOT participate
      { channel: '18' },
      { channel: '19' },
    ];
    expect(resolveLaneChannels(notes)).toEqual(['11', '15', '18', '19']);
  });

  test('PMS / 9 KEY — `17` is a lane note and joins the rendered set', () => {
    const notes = [
      { channel: '11' },
      { channel: '12' },
      { channel: '13' },
      { channel: '14' },
      { channel: '15' },
      { channel: '16' },
      { channel: '17' },
      { channel: '18' },
      { channel: '19' },
    ];
    // Order: 11..19 — the 9 lanes of the PMS-COMPAT layout in left-to-right rendering order.
    expect(resolveLaneChannels(notes, '9')).toEqual(['11', '12', '13', '14', '15', '16', '17', '18', '19']);
  });

  test('PMS / 9 KEY (STD) — 22..25 join the 1P-side rendering set', () => {
    const notes = [{ channel: '11' }, { channel: '15' }, { channel: '22' }, { channel: '25' }];
    expect(resolveLaneChannels(notes, '9')).toEqual(['11', '15', '22', '25']);
  });
});

describe('resolveSideRelativeLaneIndex', () => {
  test('IIDX — collapses to side-relative 0..7', () => {
    expect(resolveSideRelativeLaneIndex('11')).toBe(1);
    expect(resolveSideRelativeLaneIndex('21')).toBe(1);
    expect(resolveSideRelativeLaneIndex('19')).toBe(7);
    expect(resolveSideRelativeLaneIndex('29')).toBe(7);
  });

  test('PMS / 9 KEY — both layouts produce slots 1..9', () => {
    expect(resolveSideRelativeLaneIndex('17', '9')).toBe(7);
    expect(resolveSideRelativeLaneIndex('22', '9')).toBe(6);
    expect(resolveSideRelativeLaneIndex('25', '9')).toBe(9);
  });
});
