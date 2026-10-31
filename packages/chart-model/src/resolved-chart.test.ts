import { describe, expect, test } from 'vite-plus/test';
import { createEmptyJSON, type BeMusicEvent, type BeMusicJSON } from '../../chart-source/src/index.ts';
import { countScoredNotes, isInvisibleNoteChannel, resolveChart } from './index.ts';

function event(measure: number, channel: string, value: string, position: [number, number] = [0, 1]): BeMusicEvent {
  return { measure, channel, position, value };
}

function bmsChart(events: BeMusicEvent[]): BeMusicJSON {
  const json = createEmptyJSON('bms');
  json.metadata.bpm = 120;
  json.events = events;
  return json;
}

describe('resolveChart', () => {
  test('resolves taps, #LNOBJ long notes, mines and invisible objects onto their lanes', () => {
    const json = bmsChart([
      event(1, '11', '01'),
      event(1, '12', '02'),
      event(2, '12', 'ZZ'),
      event(1, 'D3', '0A'),
      event(1, '34', '03'),
    ]);
    json.bms.lnObjs = ['ZZ'];
    json.bms.lnMode = 2;
    const resolved = resolveChart(json);
    expect(resolved.notes).toEqual([
      expect.objectContaining({ kind: 'tap', channel: '11', beat: 4, seconds: 2, sampleKey: '01' }),
      expect.objectContaining({ kind: 'ln', channel: '12', beat: 4, endBeat: 8, endSeconds: 4, lnMode: 2 }),
    ]);
    expect(resolved.mines).toEqual([
      expect.objectContaining({ kind: 'mine', channel: '13', seconds: 2, sampleKey: '0A', damage: 10 }),
    ]);
    expect(resolved.invisibleNotes).toEqual([
      expect.objectContaining({ kind: 'invisible', channel: '14', seconds: 2, sampleKey: '03' }),
    ]);
    expect(resolved.lnMode).toBe(2);
    expect(resolved.lastNoteSeconds).toBe(4);
  });

  test('keeps one judged note per lane and position and reports the shadowed keysounds', () => {
    const resolved = resolveChart(bmsChart([event(0, '11', '02'), event(0, '11', '01'), event(0, '11', '01')]));
    expect(resolved.notes.map((note) => note.sampleKey)).toEqual(['01']);
    expect(resolved.shadowedNotes.map((note) => note.sampleKey)).toEqual(['02']);
  });

  test('gives FREE ZONE notes their fixed tail only in the That-Which-Must-Not-Be-Named families', () => {
    const json = bmsChart([event(0, '11', '01'), event(0, '16', '01'), event(0, '17', '01')]);
    expect(resolveChart(json).notes.find((note) => note.channel === '17')).toMatchObject({
      kind: 'ln',
      freeZone: true,
      endBeat: 1,
    });
    // Under POPN-9 (`.pms`) channel 17 is an ordinary key.
    const popn = resolveChart(json, { chartPath: 'chart.pms' });
    expect(popn.playVariant).toBe('9');
    expect(popn.notes.find((note) => note.channel === '17')).toMatchObject({ kind: 'tap' });
  });

  test('countScoredNotes counts the resolved notes without FREE ZONE ones, with the variant that decided it', () => {
    const json = bmsChart([event(0, '11', '01'), event(0, '16', '01'), event(0, '17', '01'), event(1, '51', '02')]);
    json.events.push(event(2, '51', '02'));
    const scored = (options: Parameters<typeof countScoredNotes>[1]) => {
      const resolved = resolveChart(json, options);
      return {
        notes: resolved.notes.filter((note) => note.freeZone !== true).length,
        playVariant: resolved.playVariant,
      };
    };
    // That-Which-Must-Not-Be-Named 7 KEY: `17` is FREE ZONE and not scored; the `51` pair is one long note.
    expect(countScoredNotes(json, { inferBmsLNTypeWhenMissing: true })).toEqual(
      scored({ inferBmsLNTypeWhenMissing: true }),
    );
    expect(countScoredNotes(json, { inferBmsLNTypeWhenMissing: true }).notes).toBe(3);
    // POPN 9 (`.pms`): `17` is an ordinary key and counts.
    expect(countScoredNotes(json, { chartPath: 'chart.pms', inferBmsLNTypeWhenMissing: true })).toEqual({
      notes: 4,
      playVariant: '9',
    });
    // A variant the host decided wins over the chart's.
    expect(countScoredNotes(json, { playVariant: '9' }).playVariant).toBe('9');
  });

  test('takes the play variant from the host when given', () => {
    const resolved = resolveChart(bmsChart([event(0, '11', '01')]), { playVariant: '14' });
    expect(resolved.playVariant).toBe('14');
    expect(resolved.layouts.map((layout) => layout.id)).toEqual(['14']);
  });

  test('reads bmson long notes with the per-note type over info.ln_type', () => {
    const json = createEmptyJSON('bmson');
    json.metadata.bpm = 120;
    json.bmson.info.resolution = 240;
    json.bmson.info.lnType = 2;
    json.events = [
      { measure: 0, channel: '11', position: [0, 1], value: '01', bmson: { l: 480 } },
      { measure: 0, channel: '12', position: [0, 1], value: '01', bmson: { l: 240, t: 3 } },
    ];
    const resolved = resolveChart(json);
    expect(resolved.notes.map((note) => [note.channel, note.endBeat, note.lnMode])).toEqual([
      ['11', 2, 2],
      ['12', 1, 3],
    ]);
    expect(resolved.total).toEqual({ unit: 'percent' });
  });

  test('collects the judge-rank inputs and TOTAL as authored', () => {
    const json = bmsChart([event(1, 'A0', '01')]);
    json.metadata.rank = 3;
    json.metadata.total = 300;
    json.bms.defExRank = 120;
    json.bms.exRank['01'] = '50';
    const resolved = resolveChart(json);
    expect(resolved.judgeRank).toEqual({ rank: 3, exRank: 120, changes: [{ seconds: 2, exRankValue: 50 }] });
    expect(resolved.total).toEqual({ value: 300, unit: 'absolute' });
  });

  test('lists bar lines unless the chart suppresses them', () => {
    const json = bmsChart([event(1, '11', '01')]);
    json.measures = [{ index: 0, length: 0.5 }];
    // One line per measure start, 0..1 — none after the last measure.
    expect(resolveChart(json).barLines).toEqual([0, 2]);
    json.bmson.barlinesSuppressed = true;
    const suppressed = resolveChart(json);
    expect(suppressed.barLinesSuppressed).toBe(true);
    expect(suppressed.barLines).toEqual([]);
  });

  test('collects sample triggers, SCROLL / SPEED keyframes and BGA cues', () => {
    const json = bmsChart([event(0, '01', '01'), event(0, '04', '02'), event(1, 'SC', '01'), event(1, 'SP', '01')]);
    json.resources.wav['01'] = 'bgm.wav';
    json.bms.scroll['01'] = 0.5;
    json.bms.speed['01'] = 2;
    const resolved = resolveChart(json);
    expect(resolved.sampleTriggers.map((trigger) => [trigger.channel, trigger.samplePath])).toEqual([
      ['01', 'bgm.wav'],
    ]);
    expect(resolved.scroll).toEqual([{ beat: 4, speed: 0.5 }]);
    expect(resolved.speed).toEqual([{ beat: 4, speed: 2 }]);
    expect(resolved.bga.base).toEqual([{ seconds: 0, key: '02' }]);
  });

  test('records the draws and flags control flow left on the chart', () => {
    const json = bmsChart([event(0, '11', '01')]);
    const draws = [{ command: 'RANDOM' as const, range: 2, value: 1 }];
    const resolved = resolveChart(json, { randomDraws: draws });
    expect(resolved.randomDraws).toBe(draws);
    expect(resolved.hasUnresolvedControlFlow).toBe(false);
    json.bms.controlFlow = [{ kind: 'directive', command: 'RANDOM', value: '2' }];
    expect(resolveChart(json).hasUnresolvedControlFlow).toBe(true);
  });

  test('is deterministic and computes each part once', () => {
    const json = bmsChart([event(0, '11', '01'), event(0, 'D1', '02')]);
    const resolved = resolveChart(json);
    expect(resolved.notes).toBe(resolved.notes);
    expect(resolved.mines).toBe(resolved.mines);
    expect(resolveChart(json).notes).toEqual(resolved.notes);
  });
  test('lists BMS dynamic volume changes per bus', () => {
    const json = bmsChart([event(1, '97', '40'), event(2, '98', 'FF'), event(3, '97', 'ZZ')]);
    const resolved = resolveChart(json);
    expect(resolved.volumeChanges.map((change) => [change.seconds, change.bus])).toEqual([
      [2, 'bgm'],
      [4, 'play'],
    ]);
    expect(resolved.volumeChanges[1]!.gain).toBe(1);
  });

  test('isInvisibleNoteChannel matches 3x / 4x lane channels only', () => {
    expect(['31', '49', '3A', '4z', '11', 'D1', '30', '3'].map((channel) => isInvisibleNoteChannel(channel))).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe('bmson layered sound events', () => {
  function layered(lengths: number[]) {
    const json = createEmptyJSON('bmson');
    json.metadata.bpm = 120;
    json.bmson.info.resolution = 240;
    json.events = lengths.map((l, index) => ({ ...event(0, '11', `0${index + 1}`), bmson: { l, c: index === 1 } }));
    return resolveChart(json);
  }

  test.each([0, 240])('keeps all source slices on one judged note of length %s', (length) => {
    const resolved = layered([length, length]);
    expect(resolved.notes).toHaveLength(1);
    expect(resolved.notes[0]?.soundEvents?.map((event) => event.value)).toEqual(['01', '02']);
    expect(resolved.shadowedNotes).toHaveLength(1);
    expect(resolved.sampleTriggers).toHaveLength(2);
    expect(resolved.notes[0]?.endBeat).toBe(length ? 1 : undefined);
  });

  test.each([
    [0, 240],
    [240, 480],
    [240, 0],
  ])('keeps the first channel and drops a layer of another length %s / %s, as beatoraja does', (a, b) => {
    const resolved = layered([a, b]);
    expect(resolved.notes).toHaveLength(1);
    expect(resolved.notes[0]?.event.value).toBe('01');
    expect(resolved.notes[0]?.endBeat).toBe(a ? a / 240 : undefined);
    expect(resolved.notes[0]?.soundEvents?.map((event) => event.value)).toEqual(['01']);
    expect(resolved.sampleTriggers.map((trigger) => trigger.sampleKey)).toEqual(['01']);
  });

  test('layers only the notes that match the first channel length', () => {
    const resolved = layered([240, 0, 240]);
    expect(resolved.notes[0]?.soundEvents?.map((event) => event.value)).toEqual(['01', '03']);
    expect(resolved.sampleTriggers.map((trigger) => trigger.sampleKey).sort()).toEqual(['01', '03']);
  });
});

test('pairs bmson LN end sounds by pulse despite floating-point beat addition', () => {
  const source = createEmptyJSON('bmson');
  source.bmson.info.resolution = 10;
  source.events = [
    { ...event(0, '11', '01', [1, 40]), bmson: { l: 2 } },
    { ...event(0, '11', '02', [3, 40]), bmson: { up: true } },
  ];
  const note = resolveChart(source).notes[0]!;
  expect(note.endBeat).not.toBe(0.3);
  expect(note.endSoundEvent).toBe(source.events[1]);
});
