import { describe, expect, test } from 'vite-plus/test';
import { parseBMS, parseChart, resolveBMSControlFlow } from '@be-music/chart-parser';
import { buildChartTextTimeline } from '@be-music/chart-model';
import { stringifyBMS } from './index.ts';

const source =
  '#TITLE Text\n#BPM 120\n#TEXT00 "MISS!!"\n#TEXT01 "こんにちは  世界"\n#TEXT02 ""\n#FUTURE_TEXT arbitrary payload\n#00199:0102\n';

test.each([false, true])(
  'native BMS text definitions, clear cues and unknown headers survive %s canonical output',
  (canonical) => {
    const chart = parseBMS(source);
    const before = buildChartTextTimeline(chart);
    const output = stringifyBMS(chart, canonical ? { maxResolution: 192 } : {});
    const reloaded = parseBMS(output);
    expect(buildChartTextTimeline(reloaded)).toEqual(before);
    expect(reloaded.resources.text).toEqual(chart.resources.text);
    expect(reloaded.metadata.extras.FUTURE_TEXT).toBe('arbitrary payload');
    expect(output).toContain('#TEXT02 ""');
  },
);

test('Be-Music JSON retains raw quoting while model text is decoded for presentation', () => {
  const chart = parseChart(JSON.stringify(parseBMS(source)), 'json');
  expect(chart.resources.text['01']).toBe('"こんにちは  世界"');
  expect(buildChartTextTimeline(chart).cues[0]!.text).toBe('こんにちは  世界');
});

describe('pomu #SONGxx', () => {
  const songs =
    '#TITLE Song\n#BPM 120\n#SONG01 "old one"\n#TEXT01 "new one"\n#SONG02 "only song"\n#00199:01020300\n#TEXT03 "text after"\n#SONG03 "song after"\n';

  test('fills only the indices #TEXTxx leaves undefined, whichever line comes first', () => {
    const chart = parseBMS(songs);
    expect(chart.bms.songText).toEqual({ '01': '"old one"', '02': '"only song"', '03': '"song after"' });
    expect(chart.metadata.extras).not.toHaveProperty('SONG01');
    expect(buildChartTextTimeline(chart).cues.map((cue) => cue.text)).toEqual(['new one', 'only song', 'text after']);
  });

  test('is written back as #SONGxx and round-trips through BMS and Be-Music JSON', () => {
    const chart = parseBMS(songs);
    const output = stringifyBMS(chart);
    expect(output).toContain('#SONG02 "only song"');
    expect(output).not.toContain('#TEXT02');
    expect(parseBMS(output).bms.songText).toEqual(chart.bms.songText);
    expect(parseChart(JSON.stringify(chart), 'json').bms.songText).toEqual(chart.bms.songText);
  });

  test('applies inside a taken #RANDOM branch only, and keeps base-62 case', () => {
    const source = parseBMS(
      '#TITLE R\n#BPM 120\n#RANDOM 2\n#IF 1\n#SONG01 "one"\n#ENDIF\n#IF 2\n#SONG01 "two"\n#ENDIF\n#ENDRANDOM\n#00199:01\n',
    );
    expect(source.bms.songText).toEqual({});
    expect(resolveBMSControlFlow(source, { random: () => 0 }).bms.songText).toEqual({ '01': '"one"' });
    expect(resolveBMSControlFlow(source, { random: () => 0.99 }).bms.songText).toEqual({ '01': '"two"' });
    const base62 = parseBMS('#TITLE B\n#BPM 120\n#BASE 62\n#SONGaa "lower"\n#SONGAA "upper"\n#00199:aaAA\n');
    expect(buildChartTextTimeline(base62).cues.map((cue) => cue.text)).toEqual(['lower', 'upper']);
  });

  test('moves #SONGxx out of the extras of older Be-Music JSON', () => {
    const legacy = JSON.parse(JSON.stringify(parseBMS(songs)));
    delete legacy.bms.songText;
    legacy.metadata.extras = { ...legacy.metadata.extras, SONG02: '"only song"' };
    const migrated = parseChart(JSON.stringify(legacy), 'json');
    expect(migrated.bms.songText).toEqual({ '02': '"only song"' });
  });
});
