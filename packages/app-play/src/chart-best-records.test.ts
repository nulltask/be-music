import { describe, expect, it } from 'vite-plus/test';
import { parseBMS } from '@be-music/chart-parser';
import type { LibraryChart } from '@be-music/player-scene-model';
import {
  chartCopiesItself,
  courseStageRecordKey,
  parseChartBestRecords,
  playRecordKey,
  recordKeyRuleset,
  rulesetRecordKey,
  rulesetRecords,
  serializeChartBestRecords,
  slotRecordKey,
  chartBestRecordKey,
} from './chart-best-records.ts';

describe('chartBestRecordKey', () => {
  it('prefers the chart SHA-256 and falls back to the chart path', () => {
    expect(chartBestRecordKey({ chartPath: 'a/b.bms' }, 'abc123')).toBe('sha256:abc123');
    expect(chartBestRecordKey({ chartPath: 'a/b.bms' }, undefined)).toBe('path:a/b.bms');
    expect(chartBestRecordKey({ chartPath: 'a/b.bms' }, '')).toBe('path:a/b.bms');
  });
});

describe('rulesetRecordKey / rulesetRecords', () => {
  it('keys a chart’s or course’s record by the judge ruleset first', () => {
    expect(rulesetRecordKey('lr2', 'sha256:abc')).toBe('lr2:sha256:abc');
    expect(rulesetRecordKey('beatoraja', 'course:grade::a,b')).toBe('beatoraja:course:grade::a,b');
  });

  it('reads the ruleset back, and keys an LR2 separate lamp beside the ordinary record', () => {
    expect(recordKeyRuleset('lr2:sha256:abc')).toBe('lr2');
    expect(recordKeyRuleset('____:path:a.bms')).toBe('____');
    expect(recordKeyRuleset('sha256:abc')).toBeUndefined();
    expect(slotRecordKey('lr2:sha256:abc', 'main')).toBe('lr2:sha256:abc');
    expect(slotRecordKey('lr2:sha256:abc', 'd-battle')).toBe('lr2:d-battle:sha256:abc');
    expect(slotRecordKey('lr2:path:a.bms', 'extra')).toBe('lr2:extra:path:a.bms');
    // A slot key still parses as its ruleset's record.
    const stored = serializeChartBestRecords(new Map([['lr2:sp-to-dp:sha256:abc', { lamp: 'HARD' as const }]]));
    expect(parseChartBestRecords(stored).get('lr2:sp-to-dp:sha256:abc')).toEqual({ lamp: 'HARD' });
    expect(
      parseChartBestRecords(
        serializeChartBestRecords(new Map([['beatoraja:sha256:abc', { lamp: 'LIGHT_ASSIST_EASY' as const }]])),
      ).get('beatoraja:sha256:abc'),
    ).toEqual({ lamp: 'LIGHT_ASSIST_EASY' });
  });

  it('reads one ruleset’s records by the chart’s or course’s own key', () => {
    const records = new Map([
      ['lr2:sha256:abc', { lamp: 'FULL_COMBO' as const }],
      ['beatoraja:sha256:abc', { lamp: 'MAX' as const }],
    ]);
    expect(rulesetRecords(records, 'lr2').get('sha256:abc')?.lamp).toBe('FULL_COMBO');
    expect(rulesetRecords(records, 'beatoraja').get('sha256:abc')?.lamp).toBe('MAX');
    expect(rulesetRecords(records, '____').get('sha256:abc')).toBeUndefined();
  });
});

describe('parseChartBestRecords / serializeChartBestRecords', () => {
  it('round-trips records of every ruleset', () => {
    const records = new Map([
      ['lr2:sha256:abc', { lamp: 'FULL_COMBO' as const, exScore: 900, maxCombo: 450, missCount: 0, playCount: 2 }],
      ['beatoraja:sha256:abc', { lamp: 'MAX' as const, exScore: 910, playCount: 1 }],
      ['____:path:x.bms', { lamp: 'FAILED' as const, playCount: 1 }],
    ]);
    expect(JSON.parse(serializeChartBestRecords(records)).version).toBe(0);
    expect(parseChartBestRecords(serializeChartBestRecords(records))).toEqual(records);
    const current = new Map([['beatoraja:a', { lamp: 'EX_HARD' as const }]]);
    expect(parseChartBestRecords(serializeChartBestRecords(current))).toEqual(current);
  });

  it('yields no records for missing, unreadable, or older data', () => {
    expect(parseChartBestRecords(null).size).toBe(0);
    expect(parseChartBestRecords('{not json').size).toBe(0);
    expect(parseChartBestRecords('[]').size).toBe(0);
    for (const version of [1, 2, 3, 4]) {
      expect(parseChartBestRecords(JSON.stringify({ version, records: { 'lr2:a': { lamp: 'MAX' } } })).size).toBe(0);
    }
  });

  it('drops entries whose key names no judge ruleset, whose lamp is unknown, or whose counts are malformed', () => {
    const raw = JSON.stringify({
      version: 0,
      records: {
        'sha256:abc': { lamp: 'HARD' },
        'lr2:bad': { lamp: 'SUPER_CLEAR', exScore: 10 },
        'lr2:ok': { lamp: 'HARD', exScore: -1, maxCombo: 1.5, missCount: '3', playCount: 4 },
      },
    });
    expect([...parseChartBestRecords(raw)]).toEqual([['lr2:ok', { lamp: 'HARD', playCount: 4 }]]);
  });
});

describe('playRecordKey', () => {
  const chartEntry = { chartPath: 'Songs/a/main.bms' };
  const played = { autoPlay: false, replay: false, course: false, tempo: 1, judgeRuleset: 'lr2' as const };

  it('records a played chart under its hash and the judge ruleset it ran under', () => {
    expect(playRecordKey(chartEntry, 'abc', played)).toBe('lr2:sha256:abc');
    expect(playRecordKey(chartEntry, undefined, played)).toBe('lr2:path:Songs/a/main.bms');
    expect(playRecordKey(chartEntry, 'abc', { ...played, judgeRuleset: '____' })).toBe('____:sha256:abc');
  });

  it('leaves the records alone for auto play, a replay, a course stage and another tempo', () => {
    expect(playRecordKey(chartEntry, 'abc', { ...played, autoPlay: true })).toBeUndefined();
    expect(playRecordKey(chartEntry, 'abc', { ...played, replay: true })).toBeUndefined();
    expect(playRecordKey(chartEntry, 'abc', { ...played, course: true })).toBeUndefined();
    expect(playRecordKey(chartEntry, 'abc', { ...played, tempo: 1.1 })).toBeUndefined();
  });
});

describe('course stage records', () => {
  const chartEntry = { chartPath: 'Songs/a/main.bms' };

  it('keys an EXPERT / GRADE stage under its chart, not when auto-played, replayed or at another tempo', () => {
    const played = { autoPlay: false, replay: false, tempo: 1, judgeRuleset: 'beatoraja' as const };
    expect(courseStageRecordKey(chartEntry, 'abc', played)).toBe('beatoraja:sha256:abc');
    expect(courseStageRecordKey(chartEntry, 'abc', { ...played, autoPlay: true })).toBeUndefined();
    expect(courseStageRecordKey(chartEntry, 'abc', { ...played, replay: true })).toBeUndefined();
    expect(courseStageRecordKey(chartEntry, 'abc', { ...played, tempo: 0.9 })).toBeUndefined();
  });
});

describe('chartCopiesItself', () => {
  const entry = (header: string, chartPath = 'song/chart.bms') =>
    ({ chartPath, chart: parseBMS(`#BPM 120\n${header}\n#00111:01\n#00116:01\n`) }) as LibraryChart;

  it('is true for a single-play chart whose NOTES COPY / DBLCOPY makes it double play (#932)', () => {
    expect(chartCopiesItself(entry('#OPTION 774:NOTES_COPY'))).toBe(true);
    expect(chartCopiesItself(entry('#OPTION 774:NOTES_DBLCOPY'))).toBe(true);
  });

  it('is false without a copy, or where a copy does nothing', () => {
    expect(chartCopiesItself(entry(''))).toBe(false);
    expect(chartCopiesItself(entry('#OPTION 774:NOTES_DOUBLE'))).toBe(false);
    expect(chartCopiesItself(entry('#OPTION 774:NOTES_COPY\n#OPTION 774:NOTES_OFF'))).toBe(false);
    expect(chartCopiesItself(entry('#OPTION 774:NOTES_COPY', 'song/chart.pms'))).toBe(false);
  });
});
