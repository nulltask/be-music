import { describe, expect, test } from 'vite-plus/test';
import type { BeMusicEvent } from '@be-music/chart-source';
import { PackedEventStrings, packEvents, unpackEvents } from './packed-events.ts';

const EVENTS: BeMusicEvent[] = [
  { measure: 0, channel: '01', position: [0, 1], value: '0A' },
  { measure: 3, channel: '11', position: [3, 16], value: '01' },
  { measure: 3, channel: '11', position: [5, 16], value: '01' },
];

describe('PackedEventStrings', () => {
  test('assigns one id per distinct string', () => {
    const strings = new PackedEventStrings();
    expect(strings.idOf('01')).toBe(0);
    expect(strings.idOf('11')).toBe(1);
    expect(strings.idOf('01')).toBe(0);
    expect(strings.valueOf(1)).toBe('11');
  });
});

describe('PackedEventStrings on a large load', () => {
  test('keeps every id across the switch to the character-code table', () => {
    const strings = new PackedEventStrings();
    const vocabulary = ['01', '11', 'ZZ', 'zz', 'A0', '1', 'long-value', 'é1'];
    const first = vocabulary.map((value) => strings.idOf(value));
    // Enough lookups to cross the threshold, with fresh string objects as the parser makes them.
    for (let index = 0; index < 5000; index += 1) {
      const value = vocabulary[index % vocabulary.length]!;
      expect(strings.idOf(String.fromCharCode(...[...value].map((char) => char.charCodeAt(0))))).toBe(
        first[index % vocabulary.length],
      );
    }
    // New values after the switch get the next ids, and every id reads back its value.
    expect(strings.idOf('99')).toBe(vocabulary.length);
    expect(strings.idOf('another')).toBe(vocabulary.length + 1);
    for (const [index, value] of [...vocabulary, '99', 'another'].entries()) {
      expect(strings.valueOf(index)).toBe(value);
    }
  });
});

describe('packEvents / unpackEvents', () => {
  test('round-trips events with the same fields and order', () => {
    const strings = new PackedEventStrings();
    const packed = packEvents(EVENTS, strings)!;
    expect(packed.length).toBe(3);
    // Small values take a byte each.
    for (const column of [packed.measures, packed.numerators, packed.denominators]) {
      expect(column).toBeInstanceOf(Int8Array);
    }
    for (const column of [packed.channels, packed.values]) expect(column).toBeInstanceOf(Uint8Array);
    const events = unpackEvents(packed, strings);
    expect(events).toEqual(EVENTS);
    expect(Object.keys(events[0]!)).toEqual(['measure', 'channel', 'position', 'value']);
  });

  test('widens a column only as far as its values need', () => {
    const strings = new PackedEventStrings();
    for (let id = 0; id < 300; id += 1) strings.idOf(`filler-${id}`);
    const events: BeMusicEvent[] = [
      { measure: -1, channel: '01', position: [0, 192], value: 'filler-0' },
      { measure: 999, channel: '11', position: [-40000, 7], value: '01' },
      { measure: 127, channel: '11', position: [70000, 0x7fffffff], value: 'filler-299' },
    ];
    const packed = packEvents(events, strings)!;
    expect(packed.measures).toBeInstanceOf(Int16Array);
    expect(packed.numerators).toBeInstanceOf(Int32Array);
    expect(packed.denominators).toBeInstanceOf(Int32Array);
    expect(packed.channels).toBeInstanceOf(Uint16Array);
    expect(packed.values).toBeInstanceOf(Uint16Array);
    expect(unpackEvents(packed, strings)).toEqual(events);

    const many = new PackedEventStrings();
    for (let id = 0; id < 70000; id += 1) many.idOf(`filler-${id}`);
    const wide = packEvents([{ measure: 0, channel: 'new', position: [128, 32768], value: 'filler-1' }], many)!;
    expect(wide.channels).toBeInstanceOf(Uint32Array);
    expect(wide.values).toBeInstanceOf(Uint8Array);
    expect(wide.numerators).toBeInstanceOf(Int16Array);
    expect(wide.denominators).toBeInstanceOf(Int32Array);
    expect(unpackEvents(wide, many)).toEqual([
      { measure: 0, channel: 'new', position: [128, 32768], value: 'filler-1' },
    ]);
  });

  test.each([
    [-128, Int8Array],
    [-129, Int16Array],
    [-32768, Int16Array],
    [-32769, Int32Array],
  ])('uses the smallest signed column for %i', (value, Column) => {
    const strings = new PackedEventStrings();
    const events: BeMusicEvent[] = [{ measure: value, channel: '11', position: [value, 1], value: '01' }];
    const packed = packEvents(events, strings)!;
    expect(packed.measures).toBeInstanceOf(Column);
    expect(packed.numerators).toBeInstanceOf(Column);
    expect(unpackEvents(packed, strings)).toEqual(events);
  });

  test('stores non-integer positions as doubles', () => {
    const strings = new PackedEventStrings();
    const events: BeMusicEvent[] = [{ measure: 1, channel: '01', position: [0.5, 3], value: '01' }];
    const packed = packEvents(events, strings)!;
    expect(packed.numerators).toBeInstanceOf(Float64Array);
    expect(unpackEvents(packed, strings)).toEqual(events);
  });

  test('keeps bmson extensions by index', () => {
    const strings = new PackedEventStrings();
    const events: BeMusicEvent[] = [
      { measure: 0, channel: '11', position: [0, 1], value: '01' },
      { measure: 0, channel: '51', position: [1, 2], value: '01', bmson: { l: 240, c: true } },
    ];
    const unpacked = unpackEvents(packEvents(events, strings)!, strings);
    expect(unpacked).toEqual(events);
    expect(unpacked[1]!.bmson).toBe(events[1]!.bmson);
  });

  test('keeps LRX extensions by index', () => {
    const strings = new PackedEventStrings();
    const events: BeMusicEvent[] = [
      { measure: 0, channel: '11', position: [0, 1], value: '01', lrx: { length: 480, volume: 64 } },
      { measure: 0, channel: '01', position: [1, 2], value: '02' },
    ];
    const packed = packEvents(events, strings)!;
    expect(packed.lrx?.size).toBe(1);
    const unpacked = unpackEvents(packed, strings);
    expect(unpacked).toEqual(events);
    expect(unpacked[0]!.lrx).toBe(events[0]!.lrx);
  });

  test('refuses events with fields it does not model', () => {
    const events = [{ ...EVENTS[0]!, extra: true }] as unknown as BeMusicEvent[];
    expect(packEvents(events, new PackedEventStrings())).toBeUndefined();
  });

  test('handles an empty list', () => {
    const strings = new PackedEventStrings();
    expect(unpackEvents(packEvents([], strings)!, strings)).toEqual([]);
  });
});
