import { expect, test } from 'vite-plus/test';
import { resolveRandomModes } from '@be-music/player-scene-model';
import {
  battleModeItems,
  bottomShiftableGaugeItems,
  crazyNotesItems,
  gaugeChoices,
  gaugeItems,
  laneOptionItems,
  laneOptionSource,
  menuLaneCovers,
  practiceGaugeItems,
} from './play-option-items.ts';

test('PRACTICE lists the judge ruleset’s own gauges first, named as it names them (#933)', () => {
  const own = (ruleset: 'lr2' | 'beatoraja' | '____', count: number) =>
    practiceGaugeItems(ruleset)
      .slice(0, count)
      .map((item) => item.text);
  expect(own('lr2', 7)).toEqual(['GROOVE', 'HARD', 'HAZARD', 'EASY', 'P.ATTACK', 'G.ATTACK', 'DEATH corrected']);
  expect(practiceGaugeItems('lr2')[2]).toEqual({ text: 'HAZARD', value: 'DEATH' });
  expect(practiceGaugeItems('lr2')[6]).toEqual({ text: 'DEATH corrected', value: 'DEATH-CORRECTED' });
  expect(own('beatoraja', 9)).toEqual([
    'ASSIST EASY',
    'EASY',
    'NORMAL',
    'HARD',
    'EX-HARD',
    'HAZARD',
    'GRADE',
    'EX GRADE',
    'EXHARD GRADE',
  ]);
  expect(own('____', 5)).toEqual(['ASSISTED EASY', 'EASY', 'NORMAL', 'HARD', 'EX-HARD']);
});

test('PRACTICE then lists the other sources’ gauges, qualified and named with their source (ADR 0019)', () => {
  const lr2 = practiceGaugeItems('lr2');
  // LR2's own seven, then beatoraja's nine and AC's five.
  expect(lr2).toHaveLength(7 + 9 + 5);
  expect(lr2[7]).toEqual({ text: 'ASSIST EASY (beatoraja)', value: 'beatoraja:ASSIST-EASY' });
  expect(lr2.at(-1)).toEqual({ text: 'EX-HARD (????)', value: '____:EX-HARD' });
  expect(practiceGaugeItems('beatoraja')).toContainEqual({ text: 'HAZARD (LR2)', value: 'lr2:DEATH' });
  // A pick qualified with the judge ruleset itself is listed after the own gauges only while it is selected.
  expect(lr2.some((item) => item.value === 'lr2:HARD')).toBe(false);
  expect(practiceGaugeItems('lr2', 'lr2:HARD')[7]).toEqual({ text: 'HARD (LR2)', value: 'lr2:HARD' });
});

test('the lowest auto-shift gauge reads as the ruleset’s own gauges; LR2 starts at EASY (#933)', () => {
  expect(bottomShiftableGaugeItems('lr2')).toEqual([
    { text: 'EASY', value: 'EASY' },
    { text: 'GROOVE', value: 'GROOVE' },
  ]);
  expect(bottomShiftableGaugeItems('beatoraja').map((item) => item.text)).toEqual(['ASSIST EASY', 'EASY', 'NORMAL']);
  expect(bottomShiftableGaugeItems('____')[0]).toEqual({ text: 'ASSISTED EASY', value: 'ASSIST-EASY' });
});

test('lane options are grouped by source, the judge ruleset own first, and name their source', () => {
  const items = laneOptionItems('beatoraja', true);
  expect(items.slice(0, 4).map((item) => item.text)).toEqual(['OFF', 'MIRROR', 'RANDOM', 'R-RANDOM (beatoraja)']);
  const sources = items.slice(3).map((item) => laneOptionSource(item.value));
  // One block per source: beatoraja, then LR2, then ????.
  expect([...new Set(sources)]).toEqual(['beatoraja', 'lr2', '____']);
  expect(sources).toEqual(
    [...sources].sort((a, b) => ['beatoraja', 'lr2', '____'].indexOf(a!) - ['beatoraja', 'lr2', '____'].indexOf(b!)),
  );
  expect(items).toContainEqual({ text: 'RANDOM', value: 'RANDOM' });
  expect(items).toContainEqual({ text: 'S-RANDOM (LR2 / ????)', value: 'lr2:S-RANDOM' });
  expect(items.map((item) => item.value)).not.toContain('____:S-RANDOM');
  expect(items).toContainEqual({ text: 'CONVERGE (beatoraja)', value: 'beatoraja:CONVERGE' });
  expect(items).toContainEqual({ text: 'SCATTER 9KEY corrected (LR2)', value: 'SCATTER-CORRECTED' });
});

test('the S-RANDOM AC shares with LR2 sits in the AC group under AC rules', () => {
  const values = laneOptionItems('____').map((item) => item.value);
  expect(values.slice(0, 3)).toEqual(['OFF', 'MIRROR', 'RANDOM']);
  expect(values[3]).toBe('lr2:S-RANDOM');
});

test('every lane option the scene model offers is listed once under every ruleset', () => {
  for (const ruleset of ['lr2', 'beatoraja', '____'] as const)
    for (const duplicated of [false, true]) {
      const values = laneOptionItems(ruleset, duplicated).map((item) => item.value);
      expect([...values].sort()).toEqual([...resolveRandomModes(ruleset, duplicated)].sort());
    }
  expect(laneOptionItems('lr2', true)).toContainEqual({
    text: 'SYNCHRONIZE RANDOM (????)',
    value: 'SYNCHRONIZE-RANDOM',
  });
});

test('battle modes carry their source and two-player play is offered under every ruleset', () => {
  expect(battleModeItems('lr2').map((item) => item.text)).toEqual([
    'OFF',
    'CHART HEADER',
    'BATTLE (LR2)',
    'COUPLE (LR2)',
    'D-BATTLE (LR2)',
    'SP TO DP (LR2)',
    'SP TO DP corrected (LR2)',
    'BATTLE (beatoraja)',
    'BATTLE AS (beatoraja)',
    'BATTLE (????)',
  ]);
  const beatoraja = battleModeItems('beatoraja');
  expect(beatoraja.slice(2, 4).map((item) => item.value)).toEqual(['beatoraja:BATTLE', 'BATTLE-AS']);
  expect(beatoraja).toContainEqual({ text: 'BATTLE (LR2)', value: 'TWO-PLAYER' });
  expect(beatoraja.map((item) => item.value)).not.toContain('COUPLE');
  const ac = battleModeItems('____');
  expect(ac.slice(2, 4)).toEqual([
    { text: 'BATTLE (????)', value: '____:BATTLE' },
    { text: '2P PLAY (????)', value: 'TWO-PLAYER' },
  ]);
  expect(ac.filter((item) => item.value === 'TWO-PLAYER')).toHaveLength(1);
});

test('turns the menu covers into a cover-set that leaves the LIFT alone', () => {
  expect(
    menuLaneCovers({ hiddenSudden1P: 'SUDDEN', hiddenSudden2P: 'HID+SUD', shutter: 0.4, laneCover: true }),
  ).toEqual([
    { side: '1P', sudden: 0.4, suddenOn: true, hidden: 0.4, hiddenOn: false },
    { side: '2P', sudden: 0.4, suddenOn: true, hidden: 0.4, hiddenOn: true },
  ]);
  const hidden = menuLaneCovers({ hiddenSudden1P: 'HIDDEN', hiddenSudden2P: 'OFF', shutter: 0.25, laneCover: false });
  expect(hidden.map((cover) => [cover.suddenOn, cover.hiddenOn])).toEqual([
    [false, false],
    [false, false],
  ]);
  expect(hidden[0]).not.toHaveProperty('lift');
  expect(hidden[0]).not.toHaveProperty('liftOn');
});

test('the gauges list the judge ruleset’s own first, then the other sources’ as qualified picks (ADR 0019, #1171)', () => {
  expect(gaugeItems('lr2')).toEqual([
    { text: 'GROOVE', value: 'GROOVE' },
    { text: 'HARD', value: 'HARD' },
    { text: 'DEATH', value: 'DEATH' },
    { text: 'EASY', value: 'EASY' },
    { text: 'P.ATTACK', value: 'P-ATTACK' },
    { text: 'G.ATTACK', value: 'G-ATTACK' },
    { text: 'DEATH corrected', value: 'DEATH-CORRECTED' },
    { text: 'NORMAL (beatoraja)', value: 'beatoraja:GROOVE' },
    { text: 'HARD (beatoraja)', value: 'beatoraja:HARD' },
    { text: 'EX-HARD (beatoraja)', value: 'beatoraja:EX-HARD' },
    { text: 'HAZARD (beatoraja)', value: 'beatoraja:DEATH' },
    { text: 'EASY (beatoraja)', value: 'beatoraja:EASY' },
    { text: 'ASSIST EASY (beatoraja)', value: 'beatoraja:ASSIST-EASY' },
    { text: 'NORMAL (????)', value: '____:GROOVE' },
    { text: 'HARD (????)', value: '____:HARD' },
    { text: 'EX-HARD (????)', value: '____:EX-HARD' },
    { text: 'EASY (????)', value: '____:EASY' },
    { text: 'ASSISTED EASY (????)', value: '____:ASSIST-EASY' },
  ]);
  expect(gaugeItems('beatoraja').map((item) => item.text)).toEqual([
    'NORMAL',
    'HARD',
    'EX-HARD',
    'HAZARD',
    'EASY',
    'ASSIST EASY',
    'GROOVE (LR2)',
    'HARD (LR2)',
    'DEATH (LR2)',
    'EASY (LR2)',
    'P.ATTACK (LR2)',
    'G.ATTACK (LR2)',
    'DEATH corrected (LR2)',
    'NORMAL (????)',
    'HARD (????)',
    'EX-HARD (????)',
    'EASY (????)',
    'ASSISTED EASY (????)',
  ]);
  expect(gaugeItems('____').map((item) => item.value)).toEqual([
    'GROOVE',
    'HARD',
    'EX-HARD',
    'EASY',
    'ASSIST-EASY',
    'lr2:GROOVE',
    'lr2:HARD',
    'lr2:DEATH',
    'lr2:EASY',
    'lr2:P-ATTACK',
    'lr2:G-ATTACK',
    'lr2:DEATH-CORRECTED',
    'beatoraja:GROOVE',
    'beatoraja:HARD',
    'beatoraja:EX-HARD',
    'beatoraja:DEATH',
    'beatoraja:EASY',
    'beatoraja:ASSIST-EASY',
  ]);
});

test('a pick qualified with the judge ruleset is listed while it is selected', () => {
  // `lr2:HARD` kept across a change to LR2: the select still has an item for it, after LR2's own gauges.
  const items = gaugeItems('lr2', ['lr2:HARD', 'GROOVE']);
  expect(items.slice(6, 9)).toEqual([
    { text: 'DEATH corrected', value: 'DEATH-CORRECTED' },
    { text: 'HARD (LR2)', value: 'lr2:HARD' },
    { text: 'NORMAL (beatoraja)', value: 'beatoraja:GROOVE' },
  ]);
  expect(items).toHaveLength(gaugeItems('lr2').length + 1);
  // Another source's pick is in the list already.
  expect(gaugeItems('lr2', ['beatoraja:HARD'])).toEqual(gaugeItems('lr2'));
  expect(gaugeChoices({ judgeRuleset: 'beatoraja', gauge: 'beatoraja:EX-HARD', gauge2P: 'lr2:HARD' })).toMatchObject({
    'EX-HARD': 'EX-HARD',
    'EX-HARD (beatoraja)': 'beatoraja:EX-HARD',
    'HARD (LR2)': 'lr2:HARD',
  });
});

test('a course bar dims NOTES COPY and DBLCOPY, which a course stage leaves out, and keeps DOUBLE (#1242)', () => {
  expect(crazyNotesItems(false)).toEqual([
    { text: 'OFF', value: 'OFF' },
    { text: 'DOUBLE', value: 'DOUBLE' },
    { text: 'COPY', value: 'COPY' },
    { text: 'DBLCOPY', value: 'DBLCOPY' },
  ]);
  expect(crazyNotesItems(true)).toEqual([
    { text: 'OFF', value: 'OFF' },
    { text: 'DOUBLE', value: 'DOUBLE' },
    { text: 'COPY', value: 'COPY', disabled: true },
    { text: 'DBLCOPY', value: 'DBLCOPY', disabled: true },
  ]);
});
