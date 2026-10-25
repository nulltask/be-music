import { expect, test } from 'vite-plus/test';
import { parseBMS } from '@be-music/chart-parser';
import { resolveChart } from '@be-music/chart-model';
import { preparePlaybackChart } from './bootstrap.ts';
import { resolveEffectiveBattleMode } from './battle-mode.ts';

const SOURCE =
  '#BPM 120\n#WAV01 a.wav\n#WAV02 b.wav\n#LNOBJ ZZ\n#00111:01\n#00116:02\n#00112:01\n#00212:ZZ\n#001D3:05\n#00134:02';

for (const [input, output] of [
  ['5', '10'],
  ['7', '14'],
] as const) {
  test(`beatoraja BATTLE copies a ${input}KEY chart positionally onto ${output}KEY`, () => {
    const source = resolveChart(parseBMS(SOURCE), { playVariant: input });
    const prepared = preparePlaybackChart(source, { battleMode: 'BATTLE', judgeRuleset: 'beatoraja' });
    expect(prepared).toMatchObject({ battleMode: 'BATTLE', battleSourceVariant: input });
    expect(prepared.resolvedChart.playVariant).toBe(output);
    expect(prepared.notes.map((note) => [note.channel, note.seconds, note.endSeconds])).toEqual([
      ['11', 2, undefined],
      ['12', 2, 4],
      ['16', 2, undefined],
      ['21', 2, undefined],
      ['22', 2, 4],
      ['26', 2, undefined],
    ]);
    expect(prepared.landmineNotes.map((mine) => mine.channel)).toEqual(['13', '23']);
    expect(prepared.invisibleNotes.map((note) => note.channel)).toEqual(['14', '24']);
    expect(prepared.battleChangedObjectCount).toBe(5);
    // Each copy owns its state and event; the source chart is untouched.
    const copy = prepared.notes.find((note) => note.channel === '22')!;
    expect(copy.event).not.toBe(prepared.notes.find((note) => note.channel === '12')!.event);
    expect(copy.event.channel).toBe('22');
    expect(source.notes.every((note) => note.channel.startsWith('1'))).toBe(true);
    expect(prepared.laneBindings.some((lane) => lane.channel === '26' && lane.side === '2P')).toBe(true);
  });
}

test('BATTLE availability follows each source', () => {
  expect(resolveEffectiveBattleMode('BATTLE', 'beatoraja', '24', false)).toBe('BATTLE');
  expect(resolveEffectiveBattleMode('BATTLE', 'beatoraja', '14', false)).toBe('OFF');
  expect(resolveEffectiveBattleMode('BATTLE', 'beatoraja', '9', false)).toBe('OFF');
  expect(resolveEffectiveBattleMode('BATTLE', 'beatoraja', '7', true)).toBe('BATTLE');
  expect(resolveEffectiveBattleMode('BATTLE', '____', '7', false)).toBe('BATTLE');
  expect(resolveEffectiveBattleMode('BATTLE', '____', '5', false)).toBe('OFF');
  expect(() => resolveEffectiveBattleMode('BATTLE', 'lr2', '7', false)).toThrow(RangeError);
  expect(() => resolveEffectiveBattleMode('SP-TO-DP', 'beatoraja', '7', false)).toThrow(RangeError);
  expect(resolveEffectiveBattleMode('SP-TO-DP', 'lr2', '7', true)).toBe('OFF');
});

test('a DP source keeps its chart under BATTLE', () => {
  const source = resolveChart(parseBMS('#BPM 120\n#00111:01\n#00121:01'), { playVariant: '14' });
  const prepared = preparePlaybackChart(source, { battleMode: 'BATTLE', judgeRuleset: 'beatoraja' });
  expect(prepared.battleMode).toBe('OFF');
  expect(prepared.notes.map((note) => note.channel)).toEqual(['11', '21']);
});
