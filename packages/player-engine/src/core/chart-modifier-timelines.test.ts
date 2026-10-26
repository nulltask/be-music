import { expect, test } from 'vite-plus/test';
import { parseChart } from '@be-music/chart-parser';
import { resolveChart } from '@be-music/chart-model';
import { collectModifierTimelines, resolveModifierLanes } from './chart-modifier-timelines.ts';

test('source rows include empty sections, BGM and valid hidden channels but exclude POOR subframes and unsupported lanes', () => {
  const resolved = resolveChart(parseChart('#BPM 120\n#00001:0001\n#00131:0001\n#00106:000001\n#00217:000001', 'bms'), {
    playVariant: '7',
  });
  const lanes = resolveModifierLanes(resolved);
  expect(lanes).toEqual(['11', '12', '13', '14', '15', '18', '19', '16']);
  expect(collectModifierTimelines(resolved, lanes).map((row) => row.beat)).toEqual([0, 2, 4, 6, 8]);
});

test('source modes preserve DP key/scratch and keyboard wheel ordering', () => {
  const json = parseChart('#BPM 120', 'bms');
  expect(resolveModifierLanes(resolveChart(json, { playVariant: '14' })).slice(7, 10)).toEqual(['16', '21', '22']);
  expect(resolveModifierLanes(resolveChart(json, { playVariant: '24' })).slice(-2)).toEqual(['1P', '1Q']);
  expect(resolveModifierLanes(resolveChart(json, { playVariant: '9' }), '.pms')).toEqual([
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
});
