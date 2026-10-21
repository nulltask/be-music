import { expect, test } from 'vite-plus/test';
import { parseBMS } from '@be-music/chart-parser';
import { resolveChart } from '@be-music/chart-model';
import { preparePlaybackChart } from '@be-music/player-engine';
import { preparePlaybackTask } from './preparation.ts';
const TEXT = '#TITLE Worker\n#BPM 120\n#WAV01 kick.wav\n#00111:0101\n#00231:01';
test('play preparation preserves note identity across its serializable arrays', () => {
  const chart = parseBMS(TEXT);
  const input = { chart, randomDraws: [], playVariant: '7' as const, extension: '.bms' };
  const result = structuredClone(preparePlaybackTask(input));
  const { resolvedChart: _, ...expected } = preparePlaybackChart(
    resolveChart(chart, { randomDraws: [], playVariant: '7', inferBmsLNTypeWhenMissing: true }),
    { laneModeExtension: '.bms' },
    0,
  );
  expect(result).toEqual(expected);
  expect(result.notes).toBe(result.renderNotes);
  expect(result.scorableNotes[0]).toBe(result.notes[0]);
  expect(result.laneSoundNotes).toContain(result.notes[0]);
});
