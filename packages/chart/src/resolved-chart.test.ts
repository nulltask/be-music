import { describe, expect, test } from 'vite-plus/test';
import { createEmptyJson, type BeMusicEvent, type BeMusicJson } from '../../json/src/index.ts';
import { resolveChart } from './index.ts';

function event(measure: number, channel: string, value: string, position: [number, number] = [0, 1]): BeMusicEvent {
  return { measure, channel, position, value };
}

function bmsChart(events: BeMusicEvent[]): BeMusicJson {
  const json = createEmptyJson('bms');
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

  test('gives FREE ZONE notes their fixed tail only in the IIDX families', () => {
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

  test('takes the play variant from the host when given', () => {
    const resolved = resolveChart(bmsChart([event(0, '11', '01')]), { playVariant: '14' });
    expect(resolved.playVariant).toBe('14');
    expect(resolved.layouts.map((layout) => layout.id)).toEqual(['14']);
  });

  test('reads bmson long notes with the per-note type over info.ln_type', () => {
    const json = createEmptyJson('bmson');
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
    expect(resolveChart(json).barLines).toEqual([0, 2, 6]);
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
});
