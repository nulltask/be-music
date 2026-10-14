import { describe, expect, test } from 'vite-plus/test';
import { makeChart } from '../../test/support.ts';
import { excerptLanes, scoreCardExcerpt } from './score-card-excerpt.ts';

describe('score card excerpt', () => {
  test('lanes run as skins draw them, the scratch red and the black keys blue', () => {
    expect(excerptLanes('7 KEY SP')).toEqual([
      { channel: '16', tone: 'red' },
      { channel: '11', tone: 'white' },
      { channel: '12', tone: 'blue' },
      { channel: '13', tone: 'white' },
      { channel: '14', tone: 'blue' },
      { channel: '15', tone: 'white' },
      { channel: '18', tone: 'blue' },
      { channel: '19', tone: 'white' },
    ]);
    // The play logs' labels, play variants and the older `7keys` form all name a layout.
    expect(excerptLanes('7')).toEqual(excerptLanes('7 KEY SP'));
    expect(excerptLanes('7keys')).toEqual(excerptLanes('7 KEY SP'));
    expect(excerptLanes('5 KEY SP')).toHaveLength(6);
    expect(excerptLanes('9 KEY (PMS-STD)').map((lane) => lane.channel)).toEqual([
      '11',
      '12',
      '13',
      '14',
      '15',
      '22',
      '23',
      '24',
      '25',
    ]);
    expect(excerptLanes('9 KEY (PMS-COMPAT)')).toHaveLength(9);
    expect(excerptLanes('5 KEY DP')).toHaveLength(12);
    expect(excerptLanes('14 KEY DP')).toHaveLength(16);
    expect(excerptLanes('14 KEY DP').filter((lane) => lane.tone === 'red')).toHaveLength(2);
    expect(excerptLanes('UNKNOWN')).toEqual([]);
  });

  test("reads a chart's stored fingerprint document", () => {
    const chart = makeChart(['#00111:01', '#00311:01010101', '#00316:01', '#00412:0101']);
    const excerpt = scoreCardExcerpt(chart.chartDocument, '7 KEY SP');
    expect(excerpt?.notes).toEqual([
      { lane: 1, beat: 0 },
      { lane: 0, beat: 0 },
      { lane: 1, beat: 1 },
      { lane: 1, beat: 2 },
      { lane: 1, beat: 3 },
      { lane: 2, beat: 4 },
      { lane: 2, beat: 6 },
    ]);
  });

  test('keeps the decorative playfield when the document or the lane mode cannot be drawn', () => {
    const chart = makeChart(['#00111:01']);
    expect(scoreCardExcerpt(chart.chartDocument, null)).toBeNull();
    // 24 KEY has 26 lanes, too many to read on the card.
    expect(scoreCardExcerpt(chart.chartDocument, '24 KEY SP')).toBeNull();
    expect(scoreCardExcerpt('not a document', '7')).toBeNull();
    expect(scoreCardExcerpt({ notes: 'x' }, '7')).toBeNull();
  });
});
