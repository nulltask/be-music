import { describe, expect, test } from 'vitest';
import {
  collectLnobjEndEvents,
  mapBmsLongNoteChannelToPlayable,
  resolveBmsLongNotes,
  cloneJson,
  createBeatResolver,
  createEmptyJson,
  DEFAULT_BPM,
  ensureMeasure,
  eventToBeat,
  getMeasureBeats,
  intToBase36,
  isLandmineChannel,
  isPlayableChannel,
  isBmsLongNoteChannel,
  isSampleTriggerChannel,
  isScrollChannel,
  isStopChannel,
  isTempoChannel,
  measureToBeat,
  normalizeChannel,
  normalizeObjectKey,
  parseBpmFrom03Token,
  sortEvents,
  type BeMusicEvent,
} from './index.ts';
describe('json', () => {


  test('json: createEmptyJson initializes defaults', () => {
    const json = createEmptyJson();
    expect(json.sourceFormat).toBe('bms');
    expect(json.metadata.bpm).toBe(DEFAULT_BPM);
    expect(json.events).toEqual([]);
    expect(json.bmson.bga.layerEvents).toEqual([]);
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

test('json: intToBase36 / parseBpmFrom03Token', () => {
  expect(intToBase36(0)).toBe('00');
  expect(intToBase36(35)).toBe('0Z');
  expect(intToBase36(36)).toBe('10');
  expect(intToBase36(-1)).toBe('00');
  expect(intToBase36(1, 4)).toBe('0001');

  expect(parseBpmFrom03Token('7F')).toBe(127);
  expect(parseBpmFrom03Token('GG')).toBe(0);
});

test('json: ensureMeasure / getMeasureBeats', () => {
  const json = createEmptyJson();
  const created = ensureMeasure(json, 2);
  created.length = 0.75;
  const found = ensureMeasure(json, 2);
  expect(found).toBe(created);
  expect(json.measures.find((measure) => measure.index === 2)?.length).toBe(0.75);
  expect(getMeasureBeats(0.75)).toBe(3);
});

  test('json: measureToBeat/eventToBeat reflect measure lengths', () => {
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

    const event: BeMusicEvent = {
      measure: 1,
      channel: '11',
      position: [1, 2],
      value: '01',
    };
    expect(eventToBeat(json, event)).toBe(5);
  });

  test('json: createBeatResolver resolves measureToBeat/eventToBeat efficiently', () => {
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

    const event: BeMusicEvent = {
      measure: 3.9,
      channel: '11',
      position: [1, 4],
      value: '01',
    };
    expect(resolver.eventToBeat(event)).toBe(12);
  });

test('json: sortEvents stabilizes by measure/position/channel/value order', () => {
    const events: BeMusicEvent[] = [
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

  test('json: sortEvents compares large denominators via BigInt path', () => {
    const events: BeMusicEvent[] = [
      { measure: 0, channel: '11', position: [1, Number.MAX_SAFE_INTEGER], value: '01' },
      { measure: 0, channel: '11', position: [1, Number.MAX_SAFE_INTEGER - 1], value: '02' },
    ];
    const sorted = sortEvents(events);
    expect(sorted[0].value).toBe('01');
    expect(sorted[1].value).toBe('02');
  });

test('json: classifies channel types', () => {
  expect(isTempoChannel('03')).toBe(true);
  expect(isTempoChannel('08')).toBe(true);
  expect(isTempoChannel('11')).toBe(false);

    expect(isStopChannel('09')).toBe(true);
    expect(isStopChannel('19')).toBe(false);

    expect(isScrollChannel('SC')).toBe(true);
    expect(isScrollChannel('11')).toBe(false);

    expect(isLandmineChannel('D1')).toBe(true);
    expect(isLandmineChannel('E9')).toBe(true);
    expect(isLandmineChannel('11')).toBe(false);
    expect(isLandmineChannel('D0')).toBe(false);

    expect(isSampleTriggerChannel('01')).toBe(true);
    expect(isSampleTriggerChannel('00')).toBe(false);
    expect(isSampleTriggerChannel('03')).toBe(false);
    expect(isSampleTriggerChannel('09')).toBe(false);
    expect(isSampleTriggerChannel('SC')).toBe(false);
    expect(isSampleTriggerChannel('11')).toBe(true);

  expect(isPlayableChannel('11')).toBe(true);
  expect(isPlayableChannel('21')).toBe(true);
  expect(isPlayableChannel('31')).toBe(false);
  expect(isPlayableChannel('01')).toBe(false);

  expect(isBmsLongNoteChannel('51')).toBe(true);
  expect(isBmsLongNoteChannel('69')).toBe(true);
  expect(isBmsLongNoteChannel('5A')).toBe(false);
  expect(isBmsLongNoteChannel('11')).toBe(false);
  expect(mapBmsLongNoteChannelToPlayable('51')).toBe('11');
  expect(mapBmsLongNoteChannelToPlayable('69')).toBe('29');
  expect(mapBmsLongNoteChannelToPlayable('5A')).toBeUndefined();
});

test('json: collectLnobjEndEvents returns only paired LNOBJ end markers', () => {
  const json = createEmptyJson('bms');
  json.bms.lnObj = 'AA';
  const startA: BeMusicEvent = { measure: 0, channel: '11', position: [0, 1], value: '01' };
  const endA: BeMusicEvent = { measure: 0, channel: '11', position: [1, 4], value: 'AA' };
  const sameBeatLnobj: BeMusicEvent = { measure: 0, channel: '12', position: [0, 1], value: 'AA' };
  const startB: BeMusicEvent = { measure: 0, channel: '12', position: [1, 2], value: '02' };
  const endB: BeMusicEvent = { measure: 0, channel: '12', position: [3, 4], value: 'AA' };
  const invisibleLnobj: BeMusicEvent = { measure: 0, channel: '31', position: [1, 1], value: 'AA' };
  json.events = [startA, endA, sameBeatLnobj, startB, endB, invisibleLnobj];

  const endEvents = collectLnobjEndEvents(json);
  expect(endEvents.size).toBe(2);
  expect(endEvents.has(endA)).toBe(true);
  expect(endEvents.has(endB)).toBe(true);
  expect(endEvents.has(sameBeatLnobj)).toBe(false);
  expect(endEvents.has(invisibleLnobj)).toBe(false);
});

test('json: resolveBmsLongNotes pairs 51-59/61-69 in LNTYPE=1 and suppresses end triggers', () => {
  const json = createEmptyJson('bms');
  json.metadata.bpm = 120;
  json.bms.lnType = 1;
  const startA: BeMusicEvent = { measure: 0, channel: '51', position: [0, 4], value: '01' };
  const endA: BeMusicEvent = { measure: 0, channel: '51', position: [2, 4], value: '02' };
  const orphanA: BeMusicEvent = { measure: 0, channel: '51', position: [3, 4], value: '03' };
  const startB: BeMusicEvent = { measure: 0, channel: '61', position: [1, 4], value: '04' };
  const endB: BeMusicEvent = { measure: 1, channel: '61', position: [1, 4], value: '05' };
  json.events = [startA, endA, orphanA, startB, endB];

  const resolved = resolveBmsLongNotes(json);
  expect(resolved.notes).toHaveLength(3);
  expect(resolved.notes[0]).toMatchObject({
    event: startA,
    sourceChannel: '51',
    channel: '11',
    beat: 0,
  });
  expect(resolved.notes[0]?.endBeat).toBeCloseTo(2, 6);
  expect(resolved.notes[1]).toMatchObject({
    event: startB,
    sourceChannel: '61',
    channel: '21',
    beat: 1,
  });
  expect(resolved.notes[1]?.endBeat).toBeCloseTo(5, 6);
  expect(resolved.notes[2]).toMatchObject({
    event: orphanA,
    sourceChannel: '51',
    channel: '11',
    beat: 3,
  });
  expect(resolved.notes[2]?.endBeat).toBeUndefined();
  expect(resolved.suppressedTriggerEvents.has(endA)).toBe(true);
  expect(resolved.suppressedTriggerEvents.has(endB)).toBe(true);
  expect(resolved.suppressedTriggerEvents.has(startA)).toBe(false);
});

test('json: resolveBmsLongNotes defaults to LNTYPE=1 when #LNTYPE is omitted', () => {
  const json = createEmptyJson('bms');
  json.metadata.bpm = 120;
  const start: BeMusicEvent = { measure: 0, channel: '51', position: [0, 4], value: '01' };
  const end: BeMusicEvent = { measure: 0, channel: '51', position: [2, 4], value: '02' };
  json.events = [start, end];

  const resolved = resolveBmsLongNotes(json);
  expect(resolved.notes).toHaveLength(1);
  expect(resolved.notes[0]).toMatchObject({
    event: start,
    channel: '11',
    beat: 0,
  });
  expect(resolved.notes[0]?.endBeat).toBeCloseTo(2, 6);
  expect(resolved.suppressedTriggerEvents.has(end)).toBe(true);
});

test('json: resolveBmsLongNotes expands continuous tokens in LNTYPE=2 and suppresses continuation triggers', () => {
  const json = createEmptyJson('bms');
  json.metadata.bpm = 120;
  json.bms.lnType = 2;
  const runStart: BeMusicEvent = { measure: 0, channel: '51', position: [0, 4], value: '01' };
  const runContinue: BeMusicEvent = { measure: 0, channel: '51', position: [1, 4], value: '01' };
  const secondRun: BeMusicEvent = { measure: 0, channel: '51', position: [3, 4], value: '01' };
  const crossStart: BeMusicEvent = { measure: 1, channel: '61', position: [3, 4], value: '02' };
  const crossContinue: BeMusicEvent = { measure: 2, channel: '61', position: [0, 4], value: '02' };
  json.events = [runStart, runContinue, secondRun, crossStart, crossContinue];

  const resolved = resolveBmsLongNotes(json);
  expect(resolved.notes).toHaveLength(3);
  expect(resolved.notes[0]).toMatchObject({
    event: runStart,
    sourceChannel: '51',
    channel: '11',
    beat: 0,
  });
  expect(resolved.notes[0]?.endBeat).toBeCloseTo(2, 6);
  expect(resolved.notes[1]).toMatchObject({
    event: secondRun,
    sourceChannel: '51',
    channel: '11',
    beat: 3,
  });
  expect(resolved.notes[1]?.endBeat).toBeCloseTo(4, 6);
  expect(resolved.notes[2]).toMatchObject({
    event: crossStart,
    sourceChannel: '61',
    channel: '21',
    beat: 7,
  });
  expect(resolved.notes[2]?.endBeat).toBeCloseTo(9, 6);

  expect(resolved.suppressedTriggerEvents.has(runContinue)).toBe(true);
  expect(resolved.suppressedTriggerEvents.has(crossContinue)).toBe(true);
  expect(resolved.suppressedTriggerEvents.has(runStart)).toBe(false);
  expect(resolved.suppressedTriggerEvents.has(secondRun)).toBe(false);
});

test('json: resolveBmsLongNotes can infer LNTYPE=2 when #LNTYPE is omitted', () => {
  const json = createEmptyJson('bms');
  json.metadata.bpm = 120;
  const start: BeMusicEvent = { measure: 0, channel: '61', position: [0, 4], value: '01' };
  const contA: BeMusicEvent = { measure: 0, channel: '61', position: [1, 4], value: '01' };
  const contB: BeMusicEvent = { measure: 0, channel: '61', position: [2, 4], value: '01' };
  json.events = [start, contA, contB];

  const defaultResolved = resolveBmsLongNotes(json);
  expect(defaultResolved.notes).toHaveLength(2);
  expect(defaultResolved.notes[0]?.endBeat).toBeCloseTo(1, 6);
  expect(defaultResolved.notes[1]?.endBeat).toBeUndefined();

  const inferredResolved = resolveBmsLongNotes(json, { inferLnTypeWhenMissing: true });
  expect(inferredResolved.notes).toHaveLength(1);
  expect(inferredResolved.notes[0]).toMatchObject({
    event: start,
    sourceChannel: '61',
    channel: '21',
    beat: 0,
  });
  expect(inferredResolved.notes[0]?.endBeat).toBeCloseTo(3, 6);
  expect(inferredResolved.suppressedTriggerEvents.has(contA)).toBe(true);
  expect(inferredResolved.suppressedTriggerEvents.has(contB)).toBe(true);
});
});
