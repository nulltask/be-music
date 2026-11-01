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
  // A source-qualified BATTLE builds its source's chart under every ruleset (ADR 0019).
  expect(resolveEffectiveBattleMode('beatoraja:BATTLE', 'lr2', '5', false)).toBe('beatoraja:BATTLE');
  expect(resolveEffectiveBattleMode('beatoraja:BATTLE', '____', '24', false)).toBe('beatoraja:BATTLE');
  expect(resolveEffectiveBattleMode('____:BATTLE', 'lr2', '7', false)).toBe('____:BATTLE');
  expect(resolveEffectiveBattleMode('____:BATTLE', 'beatoraja', '5', false)).toBe('OFF');
  // The chart constructions are offered under every ruleset (#774); BATTLE keeps its LR2 meaning (TWO-PLAYER).
  expect(resolveEffectiveBattleMode('SP-TO-DP', 'beatoraja', '7', false)).toBe('SP-TO-DP');
  expect(resolveEffectiveBattleMode('SP-TO-DP', '____', '14', false)).toBe('SP-TO-DP');
  expect(resolveEffectiveBattleMode('SP-TO-DP', 'lr2', '7', true)).toBe('OFF');
});

test('a source-qualified BATTLE copies the chart onto both sides under another ruleset', () => {
  const source = resolveChart(parseBMS('#BPM 120\n#00111:01'), { playVariant: '7' });
  const prepared = preparePlaybackChart(source, { battleMode: 'beatoraja:BATTLE', judgeRuleset: 'lr2' });
  expect(prepared.battleMode).toBe('beatoraja:BATTLE');
  expect(prepared.notes.map((note) => note.channel)).toEqual(['11', '21']);
});

test('a DP source keeps its chart under BATTLE', () => {
  const source = resolveChart(parseBMS('#BPM 120\n#00111:01\n#00121:01'), { playVariant: '14' });
  const prepared = preparePlaybackChart(source, { battleMode: 'BATTLE', judgeRuleset: 'beatoraja' });
  expect(prepared.battleMode).toBe('OFF');
  expect(prepared.notes.map((note) => note.channel)).toEqual(['11', '21']);
});

test('beatoraja BATTLE AS moves both scratch copies to the background and drops scratch mines', () => {
  const source = resolveChart(parseBMS(`${SOURCE}\n#001D6:05`), { playVariant: '7' });
  const prepared = preparePlaybackChart(source, { battleMode: 'BATTLE-AS', judgeRuleset: 'beatoraja' });
  expect(prepared.battleMode).toBe('BATTLE-AS');
  expect(prepared.notes.map((note) => note.channel)).toEqual(['11', '12', '21', '22']);
  expect(prepared.landmineNotes.map((mine) => mine.channel)).toEqual(['13', '23']);
  expect(
    prepared.resolvedChart.sampleTriggers
      .filter((trigger) => trigger.channel === '01')
      .map((trigger) => [trigger.sampleKey, trigger.samplePath, trigger.seconds]),
  ).toEqual([
    ['02', 'b.wav', 2],
    ['02', 'b.wav', 2],
  ]);
});

test('beatoraja BATTLE AS moves 24KEY wheel objects of both sides', () => {
  const source = resolveChart(parseBMS('#BPM 120\n#WAV01 a.wav\n#0011P:01\n#00111:01'), { playVariant: '24' });
  const prepared = preparePlaybackChart(source, { battleMode: 'BATTLE-AS', judgeRuleset: 'beatoraja' });
  expect(prepared.resolvedChart.playVariant).toBe('48');
  expect(prepared.notes.map((note) => note.channel)).toEqual(['11', '21']);
});

test('LR2 D-BATTLE copies notes but not mines, and plays a scratch mine as WAV00', () => {
  const source = resolveChart(parseBMS(`#WAV00 zero.wav\n${SOURCE}\n#001D6:05`), { playVariant: '7' });
  const prepared = preparePlaybackChart(source, { battleMode: 'D-BATTLE', judgeRuleset: 'lr2' });
  expect(prepared).toMatchObject({ battleMode: 'D-BATTLE', dBattleScratch: false });
  expect(prepared.resolvedChart.playVariant).toBe('14');
  expect(prepared.notes.map((note) => note.channel)).toEqual(['11', '12', '21', '22']);
  expect(prepared.landmineNotes.map((mine) => mine.channel)).toEqual(['13']);
  expect(prepared.invisibleNotes.map((note) => note.channel)).toEqual(['14', '24']);
  expect(
    prepared.resolvedChart.sampleTriggers
      .filter((trigger) => trigger.channel === '01')
      .map((trigger) => [trigger.sampleKey, trigger.samplePath]),
  ).toEqual([
    ['02', 'b.wav'],
    ['02', 'b.wav'],
    ['00', 'zero.wav'],
  ]);
});

test('a held D-BATTLE scratch keeps scratch objects on both sides', () => {
  const source = resolveChart(parseBMS(SOURCE), { playVariant: '5' });
  const prepared = preparePlaybackChart(source, {
    battleMode: 'D-BATTLE',
    dBattleScratch: true,
    judgeRuleset: 'lr2',
  });
  expect(prepared).toMatchObject({ battleMode: 'D-BATTLE', dBattleScratch: true });
  expect(prepared.notes.map((note) => note.channel)).toEqual(['11', '12', '16', '21', '22', '26']);
});

test('D-BATTLE and BATTLE AS keep their source chart support under every ruleset', () => {
  expect(resolveEffectiveBattleMode('D-BATTLE', 'lr2', '7', true)).toBe('D-BATTLE');
  expect(resolveEffectiveBattleMode('D-BATTLE', 'lr2', '9', false)).toBe('OFF');
  expect(resolveEffectiveBattleMode('D-BATTLE', 'lr2', '14', false)).toBe('OFF');
  expect(resolveEffectiveBattleMode('D-BATTLE', 'beatoraja', '7', false)).toBe('D-BATTLE');
  expect(resolveEffectiveBattleMode('D-BATTLE', '____', '9', false)).toBe('OFF');
  expect(resolveEffectiveBattleMode('BATTLE-AS', '____', '7', false)).toBe('BATTLE-AS');
  expect(resolveEffectiveBattleMode('BATTLE-AS', 'lr2', '24', false)).toBe('BATTLE-AS');
  expect(resolveEffectiveBattleMode('BATTLE-AS', 'lr2', '9', false)).toBe('OFF');
});

test('two-player play copies the chart for the second player, with mines under That-Which-Must-Not-Be-Named only', () => {
  const source = resolveChart(parseBMS(SOURCE), { playVariant: '7' });
  const lr2 = preparePlaybackChart(source, { battleMode: 'TWO-PLAYER', judgeRuleset: 'lr2' });
  expect(lr2.battleMode).toBe('TWO-PLAYER');
  expect(lr2.notes.map((note) => note.channel)).toEqual(['11', '12', '16', '21', '22', '26']);
  expect(lr2.landmineNotes.map((mine) => mine.channel)).toEqual(['13']);
  const ac = preparePlaybackChart(resolveChart(parseBMS(SOURCE), { playVariant: '7' }), {
    battleMode: 'TWO-PLAYER',
    judgeRuleset: '____',
  });
  expect(ac.landmineNotes.map((mine) => mine.channel)).toEqual(['13', '23']);
  expect(resolveEffectiveBattleMode('TWO-PLAYER', 'lr2', '7', true)).toBe('OFF');
  expect(resolveEffectiveBattleMode('TWO-PLAYER', '____', '9', false)).toBe('OFF');
  // beatoraja has no two-player play of its own; LR2's BATTLE builds the chart under its rules (#774).
  expect(resolveEffectiveBattleMode('TWO-PLAYER', 'beatoraja', '7', false)).toBe('TWO-PLAYER');
  expect(resolveEffectiveBattleMode('TWO-PLAYER', 'beatoraja', '14', false)).toBe('TWO-PLAYER');
  expect(resolveEffectiveBattleMode('TWO-PLAYER', 'beatoraja', '7', true)).toBe('OFF');
  const beatoraja = preparePlaybackChart(resolveChart(parseBMS(SOURCE), { playVariant: '7' }), {
    battleMode: 'TWO-PLAYER',
    judgeRuleset: 'beatoraja',
  });
  expect(beatoraja.landmineNotes.map((mine) => mine.channel)).toEqual(['13']);
});
