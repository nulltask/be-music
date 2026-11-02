import { parseBMS } from '@be-music/chart-parser';
import type { LibraryChart } from '@be-music/player-scene-model';
import { expect, test } from 'vite-plus/test';
import type { PlaySessionOptions } from './play-options.ts';
import { PlaySession } from './play-session.ts';

/** The gauge a play shows and hands the engine: a chart's GAMELEVEL / EXTRA (#845) wins over the player's pick. */

const chartEntry = (options: string[]): LibraryChart => ({
  id: 'chart',
  sourceId: 'source',
  sourceKind: 'directory',
  sourceLabel: 'Source',
  chartPath: 'song/chart.bms',
  directoryLabel: 'song',
  fileLabel: 'chart.bms',
  title: 'Chart',
  totalNotes: 1,
  chart: parseBMS(['#BPM 120', ...options.map((option) => `#OPTION ${option}`), '#00111:01', ''].join('\n')),
});

function gaugeOf(options: string[], session: PlaySessionOptions): string {
  const play = new PlaySession(session);
  Object.assign(play, { chart: chartEntry(options) });
  return play.resolveSelectedGauge();
}

test('the chart gauge wins over the player pick, per ruleset', () => {
  expect(gaugeOf(['774:GAMELEVEL_HYPER'], { gauge: 'EASY' })).toBe('HARD');
  expect(gaugeOf(['774:GAMELEVEL_DANGER'], { gauge: 'EASY', judgeRuleset: '____' })).toBe('EX-HARD');
  expect(gaugeOf([], { gauge: 'EASY' })).toBe('EASY');
});

test('a course, beatoraja PRACTICE and a replay keep their own gauge', () => {
  expect(gaugeOf(['774:GAMELEVEL_HYPER'], { gauge: 'EASY', course: { kind: 'grade' } })).toBe('EASY');
  expect(
    gaugeOf(['774:GAMELEVEL_HYPER'], {
      gauge: 'EASY',
      judgeRuleset: 'beatoraja',
      practiceRange: { startMs: 0, endMs: 1000, gauge: 'NORMAL', startGauge: 20 },
    }),
  ).toBe('EASY');
  expect(
    gaugeOf(['774:GAMELEVEL_HYPER'], {
      gauge: 'EASY',
      replay: { play: { gauge: 'GROOVE' } } as PlaySessionOptions['replay'],
    }),
  ).toBe('GROOVE');
});
