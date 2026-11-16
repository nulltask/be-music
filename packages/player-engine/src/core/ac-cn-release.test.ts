import { expect, test } from 'vite-plus/test';
import { parseBMS } from '@be-music/chart-parser';
import { parseReplay, serializeReplay } from '../replay/format.ts';
import { simulateReplay } from '../replay/simulate.ts';
import { observePlay } from './characterization/harness.ts';

// One charge note held from 2 s to 3 s (120 BPM, a measure is 2 s).
const chart = () => parseBMS(['#BPM 120', '#LNTYPE 1', '#WAV01 note.wav', '#00151:0101', ''].join('\n'));

test.each([
  // Released 150 ms early: inside the borrowed GOOD bound, so a PGREAT, where beatoraja's own windows give a GREAT.
  [2850, 'PGREAT'],
  // 195 ms late, still inside the GOOD bound.
  [3195, 'PGREAT'],
  // Released 210 ms early: past the GOOD bound, inside the BAD one.
  [2790, 'BAD'],
] as const)(
  'That-Which-Must-Not-Be-Named: a CN released at %i ms has only PGREAT inside the GOOD window, live and on replay (#1189)',
  async (releaseMs, tail) => {
    const result = await observePlay({
      driver: 'manual',
      chart: chart(),
      options: { judgeRuleset: '____' },
      reportsKeyReleases: true,
      script: [
        { atMs: 2000, down: ['11'] },
        { atMs: releaseMs, up: ['11'] },
      ],
    });
    const expected = tail === 'PGREAT' ? { perfect: 2, bad: 0 } : { perfect: 1, bad: 1 };
    expect(result.summary).toMatchObject(expected);
    const saved = parseReplay(serializeReplay(result.replay!));
    const judge = simulateReplay(saved, { ruleset: '____' }).judge;
    expect(judge).toMatchObject(tail === 'PGREAT' ? { pgreat: 2, bad: 0 } : { pgreat: 1, bad: 1 });
  },
);
