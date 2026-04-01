import { describe, expect, test } from 'vitest';
import {
  cloneJson,
  createEmptyJson,
  DEFAULT_BPM,
  ensureMeasure,
  intToBase36,
  normalizeChannel,
  normalizeObjectKey,
} from './index.ts';

describe('json', () => {
  test('json: createEmptyJson initializes defaults and preservation layers', () => {
    const json = createEmptyJson();
    expect(json.sourceFormat).toBe('bms');
    expect(json.metadata.bpm).toBe(DEFAULT_BPM);
    expect(json.events).toEqual([]);
    expect(json.bmson.bga.layerEvents).toEqual([]);
    expect(json.preservation.bms.sourceLines).toEqual([]);
    expect(json.preservation.bmson.soundChannels).toEqual([]);
  });

  test('json: createEmptyJson accepts sourceFormat', () => {
    const json = createEmptyJson('bmson');
    expect(json.sourceFormat).toBe('bmson');
  });

  test('json: cloneJson returns a deep copy', () => {
    const source = createEmptyJson('json');
    source.metadata.title = 'original';
    source.events.push({
      measure: 0,
      channel: '11',
      position: [0, 1],
      value: '01',
    });
    source.preservation.bms.objectLines.push({
      measure: 0,
      channel: '11',
      events: [{ measure: 0, channel: '11', position: [0, 1], value: '01' }],
    });
    source.preservation.bms.sourceLines.push({ kind: 'header', command: 'TITLE', value: 'original' });
    source.preservation.bmson.soundChannels.push({
      name: 'sample.wav',
      notes: [{ x: 1, y: 0, l: 120, c: true }],
    });
    source.bms.speed['01'] = 1.5;

    const cloned = cloneJson(source);
    cloned.metadata.title = 'changed';
    cloned.events[0]!.value = '02';
    cloned.preservation.bms.objectLines[0]!.events[0]!.value = '03';
    cloned.preservation.bms.sourceLines[0] = { kind: 'header', command: 'TITLE', value: 'changed' };
    cloned.preservation.bmson.soundChannels[0]!.notes[0]!.y = 240;
    cloned.bms.speed['01'] = 2;

    expect(source.metadata.title).toBe('original');
    expect(source.events[0]!.value).toBe('01');
    expect(source.preservation.bms.objectLines[0]!.events[0]!.value).toBe('01');
    expect(source.preservation.bms.sourceLines[0]).toEqual({ kind: 'header', command: 'TITLE', value: 'original' });
    expect(source.preservation.bmson.soundChannels[0]!.notes[0]!.y).toBe(0);
    expect(source.bms.speed['01']).toBe(1.5);
  });

  test('json: cloneJson preserves omitted optional fields', () => {
    const source = createEmptyJson('bms');
    source.bms.lnObjs = undefined;
    source.bmson.info.subartists = undefined;

    const cloned = cloneJson(source);
    expect(cloned.bms.lnObjs).toBeUndefined();
    expect(cloned.bmson.info.subartists).toBeUndefined();
  });

  test('json: normalizeObjectKey / normalizeChannel', () => {
    expect(normalizeObjectKey('')).toBe('00');
    expect(normalizeObjectKey('a')).toBe('0A');
    expect(normalizeObjectKey(' a ')).toBe('0A');
    expect(normalizeObjectKey('!')).toBe('0!');
    expect(normalizeObjectKey('a!')).toBe('A!');
    expect(normalizeObjectKey('a1')).toBe('A1');
    expect(normalizeObjectKey(' abc ')).toBe('AB');
    expect(normalizeObjectKey('xyz')).toBe('XY');
    expect(normalizeChannel('1a')).toBe('1A');
    expect(normalizeChannel(' abc ')).toBe('AB');
  });

  test('json: intToBase36 encodes compact identifiers', () => {
    expect(intToBase36(0)).toBe('00');
    expect(intToBase36(35)).toBe('0Z');
    expect(intToBase36(36)).toBe('10');
    expect(intToBase36(37, 1)).toBe('1');
    expect(intToBase36(-1)).toBe('00');
    expect(intToBase36(Number.POSITIVE_INFINITY, 3)).toBe('000');
    expect(intToBase36(1, 4)).toBe('0001');
  });

  test('json: ensureMeasure creates and reuses measures', () => {
    const json = createEmptyJson();
    const created = ensureMeasure(json, 2);
    created.length = 0.75;
    const found = ensureMeasure(json, 2);
    expect(found).toBe(created);
    expect(json.measures.find((measure) => measure.index === 2)?.length).toBe(0.75);
  });

  test('json: ensureMeasure appends after the last measure and finds earlier entries', () => {
    const json = createEmptyJson();
    const early = { index: 1, length: 0.75 };
    const late = { index: 4, length: 1.5 };
    json.measures.push(early, late);

    expect(ensureMeasure(json, 1)).toBe(early);

    const created = ensureMeasure(json, 6);
    expect(created).toEqual({ index: 6, length: 1 });
    expect(json.measures.at(-1)).toBe(created);
  });
});
