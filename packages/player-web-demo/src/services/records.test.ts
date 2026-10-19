import { computeChartFileHashes, type BrowserSongCollection } from '@be-music/player-web/collection';
import type { RecordPlay } from '@be-music/player/records';
import type { PlaylogRulesetId } from '@be-music/player/ruleset';
import type { LibraryChart } from '@be-music/scene-model';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import { RecordsService } from './records.ts';

vi.mock('@be-music/player-web/collection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@be-music/player-web/collection')>();
  return { ...actual, computeChartFileHashes: vi.fn(actual.computeChartFileHashes) };
});

const hashChart = vi.mocked(computeChartFileHashes);

// The SHA-256 and MD5 of the bytes `abc`.
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const ABC_MD5 = '900150983cd24fb0d6963f7d28e17f72';

function chart(id: string, chartPath = `${id}.bms`): LibraryChart {
  return {
    id,
    sourceId: 'src',
    sourceLabel: 'src',
    sourceKind: 'files',
    chartPath,
    directoryLabel: 'src',
    fileLabel: chartPath,
    title: id.toUpperCase(),
    totalNotes: 1,
    chart: {} as LibraryChart['chart'],
  };
}

/** A library whose one source holds `files` (path → text). */
function library(files: Record<string, string>, charts: LibraryChart[] = []): BrowserSongCollection {
  const encoded = new Map(Object.entries(files).map(([path, text]) => [path, new TextEncoder().encode(text)]));
  return { sources: [{ id: 'src', kind: 'files', label: 'src', files: encoded }], charts, errors: [] };
}

/** `localStorage` as the records see it through `window`. */
function stubStorage(entries: Record<string, string> = {}): Map<string, string> {
  const values = new Map(Object.entries(entries));
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    },
  });
  return values;
}

function records(
  collection: BrowserSongCollection,
  ruleset: { current: PlaylogRulesetId } = { current: 'lr2' },
): RecordsService {
  return new RecordsService({ collection: () => collection, judgeRuleset: () => ruleset.current });
}

const PLAY: RecordPlay = { lamp: 'HARD', exScore: 100, maxCombo: 50, missCount: 3 };

beforeEach(() => {
  hashChart.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RecordsService chart hashes', () => {
  test("hashes a chart's file once, however often and however soon after it is asked again", async () => {
    const service = records(library({ 'a.bms': 'abc' }));
    const song = chart('a');
    const [first, second] = await Promise.all([service.resolveChartHashes(song), service.resolveChartHashes(song)]);
    const third = await service.resolveChartHashes(song);
    expect(first).toEqual({ sha256: ABC_SHA256, md5: ABC_MD5 });
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(await service.resolveChartSHA256(song)).toBe(ABC_SHA256);
    expect(hashChart).toHaveBeenCalledTimes(1);
  });

  test('keeps a chart that cannot be hashed as unhashed, without hashing it again', async () => {
    const service = records(library({}));
    const song = chart('missing');
    expect(await service.resolveChartHashes(song)).toBeUndefined();
    expect(await service.resolveChartHashes(song)).toBeUndefined();
    expect(hashChart).toHaveBeenCalledTimes(1);
  });

  test('hashes each chart from the library as it is when the chart is first asked for', async () => {
    let collection = library({});
    const service = new RecordsService({ collection: () => collection, judgeRuleset: () => 'lr2' });
    collection = library({ 'b.bms': 'abc' });
    expect((await service.resolveChartHashes(chart('b')))?.md5).toBe(ABC_MD5);
  });
});

describe('RecordsService record lookups', () => {
  test('answers no record, and hashes nothing, while no record is kept', () => {
    stubStorage();
    const service = records(library({ 'a.bms': 'abc' }));
    expect(service.lookupSongRecord(chart('a'))).toBeUndefined();
    expect(hashChart).not.toHaveBeenCalled();
  });

  test("answers from the chart's path until it is hashed, then from its hash, under the current judge ruleset", async () => {
    const ruleset: { current: PlaylogRulesetId } = { current: 'lr2' };
    const service = records(library({ 'a.bms': 'abc' }), ruleset);
    service.songRecords.set('lr2:path:a.bms', { lamp: 'EASY' });
    service.songRecords.set(`lr2:sha256:${ABC_SHA256}`, { lamp: 'HARD' });
    service.songRecords.set(`beatoraja:sha256:${ABC_SHA256}`, { lamp: 'EX_HARD' });
    const song = chart('a');
    // The first lookup starts hashing the chart and answers from its path meanwhile.
    expect(service.lookupSongRecord(song)?.lamp).toBe('EASY');
    expect(hashChart).toHaveBeenCalledTimes(1);
    await service.resolveChartHashes(song);
    expect(service.lookupSongRecord(song)?.lamp).toBe('HARD');
    expect(hashChart).toHaveBeenCalledTimes(1);
    // Each judge ruleset keeps its own records.
    ruleset.current = 'beatoraja';
    expect(service.lookupSongRecord(song)?.lamp).toBe('EX_HARD');
    expect(service.currentRulesetRecords().get(`sha256:${ABC_SHA256}`)?.lamp).toBe('EX_HARD');
    ruleset.current = 'iidx';
    expect(service.lookupSongRecord(song)).toBeUndefined();
  });
});

describe('RecordsService record peeks', () => {
  test('answers from what is hashed already and hashes nothing: by path until the chart is hashed, then by hash', async () => {
    const ruleset: { current: PlaylogRulesetId } = { current: 'lr2' };
    const service = records(library({ 'a.bms': 'abc' }), ruleset);
    service.songRecords.set('lr2:path:a.bms', { lamp: 'EASY' });
    service.songRecords.set(`lr2:sha256:${ABC_SHA256}`, { lamp: 'HARD' });
    service.songRecords.set(`beatoraja:sha256:${ABC_SHA256}`, { lamp: 'EX_HARD' });
    const song = chart('a');
    expect(service.peekSongRecord(song)?.lamp).toBe('EASY');
    expect(service.peekSongRecord(song)?.lamp).toBe('EASY');
    expect(hashChart).not.toHaveBeenCalled();
    await service.resolveChartHashes(song);
    expect(service.peekSongRecord(song)?.lamp).toBe('HARD');
    ruleset.current = 'beatoraja';
    expect(service.peekSongRecord(song)?.lamp).toBe('EX_HARD');
    expect(hashChart).toHaveBeenCalledTimes(1);
  });

  test('keeps answering by path for a chart that could not be hashed', async () => {
    const service = records(library({}));
    service.songRecords.set('lr2:path:missing.bms', { lamp: 'NORMAL' });
    const song = chart('missing');
    await service.resolveChartHashes(song);
    expect(service.peekSongRecord(song)?.lamp).toBe('NORMAL');
    expect(hashChart).toHaveBeenCalledTimes(1);
  });
});

describe('RecordsService record latches', () => {
  test('records a play under the key latched at its start, once, and keeps the records for the next visit', () => {
    const stored = stubStorage();
    const service = records(library({}));
    service.activePlayRecordKey = 'lr2:path:a.bms';
    service.recordActivePlay(PLAY);
    expect(service.activePlayRecordKey).toBeUndefined();
    expect(service.songRecords.get('lr2:path:a.bms')).toEqual({ ...PLAY, playCount: 1 });
    // The latch is spent: the same result recorded again (a second result screen) changes nothing.
    service.recordActivePlay({ ...PLAY, exScore: 200 });
    expect(service.songRecords.get('lr2:path:a.bms')?.exScore).toBe(100);

    expect(stored.has('be-music-demo.song-records')).toBe(true);
    expect(records(library({})).songRecords.get('lr2:path:a.bms')).toEqual({ ...PLAY, playCount: 1 });
  });

  test('records nothing for a play that latched no key (AUTO, a replay, another tempo)', () => {
    const stored = stubStorage();
    const service = records(library({}));
    service.recordActivePlay(PLAY);
    service.recordActiveCourseStage(PLAY);
    expect(service.songRecords.size).toBe(0);
    expect(stored.size).toBe(0);
  });

  test("folds a course stage into its chart's record as LR2 does, under the stage's latched key, once", () => {
    stubStorage();
    const service = records(library({}));
    service.songRecords.set('lr2:path:a.bms', { lamp: 'EASY', exScore: 80, maxCombo: 60, missCount: 5, playCount: 2 });
    service.activeStageRecordKey = 'lr2:path:a.bms';
    service.recordActiveCourseStage(PLAY);
    expect(service.activeStageRecordKey).toBeUndefined();
    // The stage keeps the chart's lamp and play count, and takes the better EX score, combo and BP.
    expect(service.songRecords.get('lr2:path:a.bms')).toEqual({
      lamp: 'EASY',
      exScore: 100,
      maxCombo: 60,
      missCount: 3,
      playCount: 2,
    });
    service.recordActiveCourseStage({ ...PLAY, exScore: 300 });
    expect(service.songRecords.get('lr2:path:a.bms')?.exScore).toBe(100);
  });

  test("keeps a course run's record when the run keeps one", () => {
    stubStorage();
    const service = records(library({}));
    service.recordCourseResult(undefined);
    expect(service.songRecords.size).toBe(0);
    service.recordCourseResult({ key: 'lr2:course:abc', play: PLAY });
    service.recordCourseResult({ key: 'lr2:course:abc', play: { ...PLAY, lamp: 'EASY', exScore: 150 } });
    expect(service.songRecords.get('lr2:course:abc')).toEqual({
      lamp: 'HARD',
      exScore: 150,
      maxCombo: 50,
      missCount: 3,
      playCount: 2,
    });
  });
});
