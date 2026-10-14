import { describe, expect, test } from 'vite-plus/test';
import type { PlayInfo } from '../../play-info.ts';
import { messagesFor } from '../i18n/index.ts';
import { pickPlayInfoRows, PLAY_INFO_ROW_IDS, playInfoRows } from './play-info.tsx';

const info: PlayInfo = {
  scoreId: 's1',
  createdAt: Date.UTC(2026, 9, 14, 1, 39),
  playedRuleset: 'lr2',
  gauge: 'GROOVE',
  assistFlags: [],
  laneOption: 'RANDOM',
  durationMs: 125_000,
  verification: 'verified',
  recordedBy: { name: 'be-music', version: '1.0.0' },
  submittedBy: 'be-music/1.0.0 (web)',
  serverEngine: '0.9.0',
};

const labels = (rows: Array<[string, unknown]>) => rows.map(([label]) => label);

describe('playInfoRows', () => {
  const t = messagesFor('en');

  test('lists every row in order, with one app row when the recorder sent the play', () => {
    const p = t.playInfo;
    expect(labels(playInfoRows(info, t))).toEqual([
      p.played,
      p.playedUnder,
      p.gauge,
      p.lanes,
      p.assists,
      p.length,
      p.verified,
      p.app,
      p.scoredBy,
    ]);
  });

  test('leaves out the rows it is told to', () => {
    const p = t.playInfo;
    expect(labels(playInfoRows(info, t, ['played', 'gauge', 'assists', 'verified']))).toEqual([
      p.playedUnder,
      p.lanes,
      p.length,
      p.app,
      p.scoredBy,
    ]);
  });

  test('pickPlayInfoRows gives just the rows asked for, in the list order', () => {
    const p = t.playInfo;
    expect(labels(pickPlayInfoRows(info, t, ['scoredBy', 'lanes']))).toEqual([p.lanes, p.scoredBy]);
    // A row with nothing to show stays out even when asked for.
    expect(pickPlayInfoRows({ ...info, laneOption: null }, t, ['lanes'])).toEqual([]);
    expect(labels(pickPlayInfoRows(info, t, PLAY_INFO_ROW_IDS))).toEqual(labels(playInfoRows(info, t)));
  });

  test('splits the app row in two when another client sent the play', () => {
    const p = t.playInfo;
    const rows = pickPlayInfoRows({ ...info, submittedBy: 'other-uploader/2.0' }, t, ['app', 'sentFrom']);
    expect(rows).toEqual([
      [p.recordedWith, 'be-music 1.0.0'],
      [p.sentFrom, 'other-uploader/2.0'],
    ]);
  });
});
