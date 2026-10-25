import { expect, test } from 'vite-plus/test';
import { parseChart } from '@be-music/chart-parser';
import { createReplayRecorder, parseReplay, serializeReplay } from '@be-music/player-engine/replay';
import type { LibraryChart } from '@be-music/player-scene-model';
import { createEmptyScore } from '@be-music/player-engine/ruleset';
import { resolveNoteDrawWindow } from '../../chart/note-draw-window.ts';
import { PlaySession } from './play-session.ts';
import { prepareChart } from './play-chart.ts';

const source = parseChart(
  '#BPM 120\n#BPM01 240\n#STOP01 192\n#LNOBJ AA\n#00011:01\n#00108:01\n#00109:01\n#00112:01\n#00212:AA\n#00311:01',
  'bms',
);
source.bms.scroll['01'] = -2;
source.bms.speed['01'] = 3;
source.events.push(
  { measure: 0, channel: 'SC', position: [0, 1], value: '01' },
  { measure: 0, channel: 'SP', position: [0, 1], value: '01' },
);
const entry: LibraryChart = {
  id: 'constant',
  sourceId: 'constant',
  sourceLabel: 'Constant',
  sourceKind: 'directory',
  chartPath: 'constant.bme',
  fileLabel: 'constant.bme',
  directoryLabel: '',
  title: 'Constant',
  totalNotes: 3,
  chart: source,
};
function prepare(options: ConstructorParameters<typeof PlaySession>[0] = {}) {
  const play = new PlaySession({ judgeRuleset: 'lr2', hsFix: 'CONSTANT', ...options });
  play.chart = entry;
  prepareChart(play, entry);
  return play;
}

test('LR2 CONSTANT replaces SCROLL/SPEED with the 150-BPM map without rewriting chart or judgment timing', () => {
  const original = structuredClone(source);
  const play = prepare();
  expect(play.scrollMapper?.distanceBetween(0, 4)).toBeCloseTo(5);
  expect(play.scrollMapper?.distanceBetween(4, 8)).toBeCloseTo(2.5);
  expect(play.scrollMapper?.hasBidirectionalScrollWithinLookahead(0)).toBe(false);
  expect(play.playState.view.hiSpeed).toMatchObject({ player: 2, drawn: 2, multiplier: 1 });
  expect(play.playState.view.hsFix).toBe('CONSTANT');
  expect(play.currentBeat(2.2)).toBe(4);
  expect(play.currentBeat(2.8)).toBe(4);
  expect(play.notes.find((note) => note.endSeconds !== undefined)).toMatchObject({
    beat: 4,
    seconds: 2,
    endBeat: 8,
    endSeconds: 4,
  });
  expect(play.resolvedPlayChart?.barLines).toContain(8);
  expect(source).toEqual(original);
});

test('LR2 drawing keeps its culling rule with a finite distance-based window at changed BPM', () => {
  const play = prepare();
  const window = resolveNoteDrawWindow({
    rules: 'lr2',
    currentBeat: 4,
    nowSeconds: 2,
    reachedBeat: 4,
    laneBeats: 2,
    overscanBeats: 0.5,
    stageBottomY: 1000,
    mapper: play.scrollMapper,
  });
  expect(window.rules).toBe('lr2');
  expect(window.lastBeat).toBeCloseTo(8);
});

test('CONSTANT setup restores from a recorded replay instead of falling back to AVERAGE', () => {
  const first = prepare();
  const recorder = createReplayRecorder({
    json: source,
    chart: first.preparedChart!,
    play: { mode: 'auto', autoScratch: false, gauge: 'GROOVE', judgeRuleset: 'lr2', options: { hsFix: 'CONSTANT' } },
  });
  const replay = parseReplay(
    serializeReplay(
      recorder.finalize({ summary: { ...createEmptyScore(3), fast: 0, slow: 0, gauge: first.gaugeState } }),
    ),
  );
  const restored = prepare({ hsFix: 'OFF', replay });
  expect(restored.scrollMapper?.distanceBetween(0, 8)).toBeCloseTo(7.5);
  expect(restored.playState.view.hiSpeed.multiplier).toBe(1);
  const own = prepare({
    hsFix: 'OFF',
    replay,
    replayView: { hiSpeed: false, covers: false, lift: false, tempo: false },
  });
  expect(own.scrollMapper?.distanceBetween(0, 4)).toBeCloseTo(-24);
});

test('beatoraja CONSTANT remains a separate visibility setting', () => {
  expect(() => prepare({ judgeRuleset: 'beatoraja' })).toThrow(/LR2 option/);
  const beatoraja = prepare({ judgeRuleset: 'beatoraja', hsFix: 'OFF', visualConstant: true });
  expect(beatoraja.scrollMapper?.distanceBetween(0, 4)).toBeCloseTo(-8);
});

test('a negative BPM mirrors the fixed distance instead of the unconverted beat axis', () => {
  const reversedEntry = { ...entry, chart: parseChart('#BPM 120\n#BPM01 -240\n#00108:01\n#00311:01', 'bms') };
  const play = new PlaySession({ judgeRuleset: 'lr2', hsFix: 'CONSTANT' });
  play.chart = reversedEntry;
  prepareChart(play, reversedEntry);
  expect(play.currentBeat(3)).toBeCloseTo(2);
  expect(play.currentBeat(6)).toBeCloseTo(-4);
});
