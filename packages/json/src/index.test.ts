import { expect, test } from 'vitest';
import {
  base36ToInt,
  beatToMeasurePosition,
  cloneJson,
  createBeatResolver,
  createEmptyJson,
  DEFAULT_BPM,
  ensureMeasure,
  eventToBeat,
  getMeasureBeats,
  getMeasureLength,
  intToBase36,
  isMeasureLengthChannel,
  isPlayableChannel,
  isSampleTriggerChannel,
  isStopChannel,
  isTempoChannel,
  listPlayableChannels,
  measureToBeat,
  normalizeChannel,
  normalizeObjectKey,
  parseBpmFrom03Token,
  sortEvents,
  type BmsEvent,
} from './index.ts';

test('json: createEmptyJson は既定値で初期化する', () => {
  const json = createEmptyJson();
  expect(json.sourceFormat).toBe('bms');
  expect(json.metadata.bpm).toBe(DEFAULT_BPM);
  expect(json.events).toEqual([]);
  expect(json.bmson.bga.layerEvents).toEqual([]);
});

test('json: createEmptyJson は sourceFormat を指定できる', () => {
  const json = createEmptyJson('bmson');
  expect(json.sourceFormat).toBe('bmson');
});

test('json: cloneJson はディープコピーを返す', () => {
  const source = createEmptyJson('json');
  source.metadata.title = 'original';
  source.events.push({
    measure: 0,
    channel: '11',
    position: [0, 1],
    value: '01',
  });

  const cloned = cloneJson(source);
  cloned.metadata.title = 'changed';
  cloned.events[0].value = '02';

  expect(source.metadata.title).toBe('original');
  expect(source.events[0].value).toBe('01');
});

test('json: normalizeObjectKey / normalizeChannel', () => {
  expect(normalizeObjectKey('')).toBe('00');
  expect(normalizeObjectKey('a')).toBe('0A');
  expect(normalizeObjectKey(' abc ')).toBe('AB');
  expect(normalizeObjectKey('xyz')).toBe('XY');
  expect(normalizeChannel('1a')).toBe('1A');
});

test('json: intToBase36 / base36ToInt / parseBpmFrom03Token', () => {
  expect(intToBase36(0)).toBe('00');
  expect(intToBase36(35)).toBe('0Z');
  expect(intToBase36(36)).toBe('10');
  expect(intToBase36(-1)).toBe('00');
  expect(intToBase36(1, 4)).toBe('0001');

  expect(base36ToInt('ZZ')).toBe(1295);
  expect(base36ToInt('??')).toBe(0);

  expect(parseBpmFrom03Token('7F')).toBe(127);
  expect(parseBpmFrom03Token('GG')).toBe(0);
});

test('json: ensureMeasure / getMeasureLength / getMeasureBeats', () => {
  const json = createEmptyJson();
  expect(getMeasureLength(json, 0)).toBe(1);

  const created = ensureMeasure(json, 2);
  created.length = 0.75;
  const found = ensureMeasure(json, 2);
  expect(found).toBe(created);
  expect(getMeasureLength(json, 2)).toBe(0.75);
  expect(getMeasureBeats(0.75)).toBe(3);
});

test('json: measureToBeat / eventToBeat は小節長を反映する', () => {
  const json = createEmptyJson();
  json.measures = [
    { index: 0, length: 1 },
    { index: 1, length: 0.5 },
  ];

  expect(measureToBeat(json, 0, 0)).toBe(0);
  expect(measureToBeat(json, 1, 0)).toBe(4);
  expect(measureToBeat(json, 1, 0.5)).toBe(5);
  expect(measureToBeat(json, 1, -1)).toBe(4);
  expect(measureToBeat(json, 1, 1)).toBeCloseTo(5.999999998, 9);

  const event: BmsEvent = {
    measure: 1,
    channel: '11',
    position: [1, 2],
    value: '01',
  };
  expect(eventToBeat(json, event)).toBe(5);
});

test('json: createBeatResolver は measureToBeat/eventToBeat を高速解決する', () => {
  const json = createEmptyJson();
  json.measures = [
    { index: 0, length: 1 },
    { index: 1, length: 0.5 },
    { index: 3, length: 2 },
  ];
  const resolver = createBeatResolver(json);

  expect(resolver.measureToBeat(1, 0.5)).toBe(5);
  expect(resolver.measureToBeat(5, 0)).toBe(22);
  expect(resolver.measureToBeat(-4, 0.5)).toBe(2);

  const event: BmsEvent = {
    measure: 3.9,
    channel: '11',
    position: [1, 4],
    value: '01',
  };
  expect(resolver.eventToBeat(event)).toBe(12);
});

test('json: beatToMeasurePosition は beat を小節位置に戻せる', () => {
  const json = createEmptyJson();
  json.measures = [{ index: 1, length: 0.5 }];

  expect(beatToMeasurePosition(json, -1)).toEqual({ measure: 0, position: 0 });
  expect(beatToMeasurePosition(json, 5)).toEqual({ measure: 1, position: 0.5 });
  expect(beatToMeasurePosition(json, 6)).toEqual({ measure: 2, position: 0 });
});

test('json: sortEvents は measure/position/channel/value 順で安定化する', () => {
  const events: BmsEvent[] = [
    { measure: 1, channel: '12', position: [1, 3], value: '02' },
    { measure: 0, channel: '11', position: [1, 2], value: '02' },
    { measure: 0, channel: '11', position: [1, 2], value: '01' },
    { measure: 0, channel: '12', position: [0, 1], value: '01' },
    { measure: 0, channel: '11', position: [1, 3], value: '01' },
  ];

  const sorted = sortEvents(events);
  expect(sorted.map((event) => `${event.measure}:${event.channel}:${event.position[0]}/${event.position[1]}:${event.value}`)).toEqual([
    '0:12:0/1:01',
    '0:11:1/3:01',
    '0:11:1/2:01',
    '0:11:1/2:02',
    '1:12:1/3:02',
  ]);
});

test('json: sortEvents は大きい分母でも比較できる (BigInt 経路)', () => {
  const events: BmsEvent[] = [
    { measure: 0, channel: '11', position: [1, Number.MAX_SAFE_INTEGER], value: '01' },
    { measure: 0, channel: '11', position: [1, Number.MAX_SAFE_INTEGER - 1], value: '02' },
  ];
  const sorted = sortEvents(events);
  expect(sorted[0].value).toBe('01');
  expect(sorted[1].value).toBe('02');
});

test('json: チャンネル種別判定', () => {
  expect(isMeasureLengthChannel('02')).toBe(true);
  expect(isMeasureLengthChannel('11')).toBe(false);

  expect(isTempoChannel('03')).toBe(true);
  expect(isTempoChannel('08')).toBe(true);
  expect(isTempoChannel('11')).toBe(false);

  expect(isStopChannel('09')).toBe(true);
  expect(isStopChannel('19')).toBe(false);

  expect(isSampleTriggerChannel('01')).toBe(true);
  expect(isSampleTriggerChannel('00')).toBe(false);
  expect(isSampleTriggerChannel('03')).toBe(false);
  expect(isSampleTriggerChannel('09')).toBe(false);
  expect(isSampleTriggerChannel('11')).toBe(true);

  expect(isPlayableChannel('11')).toBe(true);
  expect(isPlayableChannel('21')).toBe(true);
  expect(isPlayableChannel('31')).toBe(false);
  expect(isPlayableChannel('01')).toBe(false);
});

test('json: listPlayableChannels はユニークでソート済みのチャンネルを返す', () => {
  const json = createEmptyJson();
  json.events = [
    { measure: 0, channel: '21', position: [0, 1], value: '01' },
    { measure: 0, channel: '11', position: [0, 1], value: '01' },
    { measure: 0, channel: '11', position: [1, 2], value: '02' },
    { measure: 0, channel: '03', position: [0, 1], value: '64' },
  ];

  expect(listPlayableChannels(json)).toEqual(['11', '21']);
});
