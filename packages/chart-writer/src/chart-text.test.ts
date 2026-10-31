import { expect, test } from 'vite-plus/test';
import { parseBMS, parseChart } from '@be-music/chart-parser';
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
