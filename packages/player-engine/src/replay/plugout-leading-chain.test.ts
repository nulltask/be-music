import { expect, test } from 'vite-plus/test';
import { parseLRX } from '../../../chart-parser/src/index.ts';
import { runRecordedPlay } from '../test-support/recorded-play.ts';
import type { ReplayInputEvent } from './format.ts';
import { simulateReplay } from './simulate.ts';

// BPM 120: 480 ticks is 0.5 s. Lane 1 starts with a chain note at 1 s, then a note at 2 s.
const chart = () =>
  parseLRX({
    lrs: '<LRS><n c="301" s="0" p="120" /><n c="300" s="0" /><n c="1" s="960" p="0" cn="1" /><n c="1" s="1920" p="1" /></LRS>',
  });

const tap = (seq: number, timeUs: number): ReplayInputEvent[] => [
  { seq, timeUs, action: 'down', channels: ['11'], source: 0 },
  { seq: seq + 1, timeUs: timeUs + 50_000, action: 'up', channels: ['11'], source: 0 },
];

test('a chain note that starts its lane is judged, and plugout leaves it out of its note count', async () => {
  const { summary, replay } = await runRecordedPlay(chart(), [...tap(0, 1_000_000), ...tap(2, 2_000_000)], 'plugout');
  expect([summary.perfect, summary.total]).toEqual([2, 1]);
  expect(replay.chart.notes.filter((note) => note.uncounted === true)).toHaveLength(1);
  const simulated = simulateReplay(replay, { ruleset: 'plugout' });
  expect([simulated.judge.pgreat, simulated.noteCount]).toEqual([2, 1]);
  // LR2 has no such rule: it counts every judged note.
  expect(simulateReplay(replay, { ruleset: 'lr2' }).noteCount).toBe(2);
});
