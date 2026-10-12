import { describe, expect, test } from 'vite-plus/test';
import { drawRandomOutcomes, type RandomDraws } from '../../../chart/src/index.ts';
import type { BeMusicJson } from '../../../json/src/index.ts';
import { parseChart, resolveBmsControlFlowWithDraws } from '../../../parser/src/index.ts';
import type { BeMusicPlaylog } from '../playlog/index.ts';
import { autoPlay, manualPlay, type PlayerOptions } from './engine.ts';

// Branch 1 puts a note on lane 11, branch 2 one on lane 12; the trailing `#SETRANDOM 3` only shows up in the summary.
const SOURCE = parseChart(
  [
    '#BPM 120',
    '#WAV01 one.wav',
    '#RANDOM 2',
    '#IF 1',
    '#00111:01',
    '#ENDIF',
    '#IF 2',
    '#00112:01',
    '#ENDIF',
    '#ENDRANDOM',
    '#SETRANDOM 3',
    '#ENDRANDOM',
  ].join('\n'),
  'bms',
);

const drawsFor = (value: number): RandomDraws => [
  { command: 'RANDOM', range: 2, value },
  { command: 'SETRANDOM', range: 1, value: 3 },
];

interface PlayResult {
  notes: string[];
  output: string;
  resolved: BeMusicJson | undefined;
}

async function play(
  run: typeof autoPlay,
  chart: BeMusicJson,
  options: Pick<PlayerOptions, 'randomDraws'>,
): Promise<PlayResult> {
  let playlog: BeMusicPlaylog | undefined;
  let output = '';
  let resolved: BeMusicJson | undefined;
  await run(chart, {
    ...options,
    speed: 64,
    leadInMs: 0,
    audio: false,
    tui: false,
    laneModeExtension: '.bme',
    writeOutput: (text) => {
      output += text;
    },
    onResolvedChart: (json) => {
      resolved = json;
    },
    onPlaylogRecorded: (recorded) => {
      playlog = recorded;
    },
  });
  return { notes: playlog!.chart.notes.map((note) => note.channel), output, resolved };
}

describe('engine control flow', () => {
  for (const [name, run] of [
    ['autoPlay', autoPlay],
    ['manualPlay', manualPlay],
  ] as const) {
    test(`${name} plays exactly the branch of the draws it is handed with a source chart`, async () => {
      for (const value of [1, 2]) {
        const result = await play(run, SOURCE, { randomDraws: drawsFor(value) });
        expect(result.notes).toEqual([value === 1 ? '11' : '12']);
        expect(result.resolved?.bms.controlFlow).toEqual([]);
        expect(result.output).toContain(`RANDOM #1 ${value}/2  #2 3/3`);
      }
    });

    test(`${name} plays a resolved chart as is and reports the draws it was resolved with`, async () => {
      const draws = drawRandomOutcomes(SOURCE, () => 0.9);
      const resolved = resolveBmsControlFlowWithDraws(SOURCE, draws);
      const result = await play(run, resolved, { randomDraws: draws });
      expect(result.notes).toEqual(['12']);
      expect(result.resolved).toEqual(resolved);
      expect(result.output).toContain('RANDOM #1 2/2  #2 3/3');
    });
  }

  for (const run of [autoPlay, manualPlay]) {
    test(`${run.name} refuses a chart that still carries control flow without draws instead of rolling it`, async () => {
      await expect(play(run, SOURCE, {})).rejects.toThrow(/randomDraws/u);
    });
  }

  test('plays a chart without control flow without draws', async () => {
    const plain = parseChart(['#BPM 120', '#WAV01 one.wav', '#00111:01'].join('\n'), 'bms');
    const result = await play(autoPlay, plain, {});
    expect(result.notes).toEqual(['11']);
    expect(result.output).not.toContain('RANDOM');
  });

  test('rejects draws that do not belong to the source chart', async () => {
    await expect(play(autoPlay, SOURCE, { randomDraws: drawsFor(3) })).rejects.toThrow(RangeError);
  });
});
