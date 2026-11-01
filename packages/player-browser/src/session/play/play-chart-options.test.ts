import { parseBMS } from '@be-music/chart-parser';
import type { LibraryChart } from '@be-music/player-scene-model';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { resolveReplayRecording } from './play-engine.ts';
import { prepareChart } from './play-chart.ts';
import type { PlaySessionOptions } from './play-options.ts';
import { PlaySession } from './play-session.ts';

/** Chart-authored RANDOM and ADDMINE (#844) replace the player's lane and mine options when the chart is prepared. */

const entry = (source: string, chartPath = 'song/chart.bme'): LibraryChart => ({
  id: 'chart',
  sourceId: 'source',
  sourceKind: 'directory',
  sourceLabel: 'Source',
  chartPath,
  directoryLabel: 'song',
  fileLabel: 'chart.bme',
  title: 'Chart',
  totalNotes: 0,
  chart: parseBMS(source),
});

const SP = (option: string) => `#BPM 120\n#OPTION ${option}\n#00111:01020000\n#00112:00000300\n#00113:00000004\n`;

function prepare(source: string, options: PlaySessionOptions = {}): PlaySession {
  const play = new PlaySession(options);
  prepareChart(play, entry(source));
  return play;
}

afterEach(() => vi.restoreAllMocks());

test('chart MIRROR wins over the player S-RANDOM and is recorded as played', () => {
  const play = prepare(SP('774:RANDOM_MIRROR'), { random1P: 'S-RANDOM', randomFixedLane1P: 3 });
  expect(play.chartPlay?.program).toEqual({ version: 1, options: { random: 'MIRROR' } });
  expect(play.chartPlay?.selection).toMatchObject({ random1P: 'MIRROR', random2P: 'MIRROR' });
  // A 5 KEY chart's MIRROR: 11 → 15, 12 → 14, 13 stays.
  expect(play.notes.map((note) => note.channel).sort()).toEqual(['13', '14', '15', '15']);
  const recording = resolveReplayRecording(
    { ...play.options, ...play.chartPlay?.selection } as PlaySessionOptions,
    undefined,
    {},
  );
  expect(recording.randomLane).toEqual({ p1: 'MIRROR', p2: 'MIRROR' });
});

test('a chart without gameplay options leaves the player choices', () => {
  const play = prepare('#BPM 120\n#00111:01\n', { random1P: 'MIRROR', mineModifier: 'OFF' });
  expect(play.chartPlay?.program).toEqual({ version: 1, options: {} });
  expect(play.chartPlay?.selection).toMatchObject({ random1P: 'MIRROR', mineModifier: 'OFF' });
  expect(play.notes[0]!.channel).toBe('15');
});

test('chart ALL shuffles across both sides of a DP chart', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const source = '#BPM 120\n#OPTION 774:RANDOM_ALL\n#00111:01\n#00112:01\n#00113:01\n#00114:01\n#00115:01\n';
  const play = new PlaySession({ random1P: 'OFF', random2P: 'OFF' });
  prepareChart(play, entry(`${source}#00121:01\n`));
  expect(play.chartPlay?.selection).toMatchObject({ random1P: 'OFF', random2P: 'OFF' });
  const channels = play.notes.map((note) => note.channel);
  expect(channels).toHaveLength(6);
  // Every note stays on a key lane of either side, and the shuffle moved some 1P notes to the 2P side.
  expect(channels.every((channel) => /^[12][1-589]$/.test(channel))).toBe(true);
  expect(channels.filter((channel) => channel.startsWith('2')).length).toBeGreaterThan(1);
});

test('chart ADDMINE wins over the player mine option', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.95);
  const play = prepare(SP('774:CRAZY_ADDMINE'), { mineModifier: 'REMOVE' });
  expect(play.chartPlay?.selection.mineModifier).toBe('ADD_RANDOM');
  expect(play.mineNotes.length).toBeGreaterThan(0);
});
