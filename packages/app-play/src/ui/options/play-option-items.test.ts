import { expect, test } from 'vite-plus/test';
import { resolveRandomModes } from '@be-music/player-scene-model';
import {
  battleModeItems,
  bottomShiftableGaugeItems,
  laneOptionItems,
  laneOptionSource,
  menuLaneCovers,
  practiceGaugeItems,
} from './play-option-items.ts';

test('PRACTICE lists the judge ruleset’s own gauges, named as it names them (#933)', () => {
  expect(practiceGaugeItems('lr2').map((item) => item.text)).toEqual([
    'GROOVE',
    'HARD',
    'HAZARD',
    'EASY',
    'P.ATTACK',
    'G.ATTACK',
    'DEATH corrected',
  ]);
  expect(practiceGaugeItems('lr2')[2]).toEqual({ text: 'HAZARD', value: 'DEATH' });
  expect(practiceGaugeItems('lr2').at(-1)).toEqual({ text: 'DEATH corrected', value: 'DEATH-CORRECTED' });
  expect(practiceGaugeItems('beatoraja').map((item) => item.text)).toEqual([
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
  expect(practiceGaugeItems('____').map((item) => item.text)).toEqual([
    'ASSISTED EASY',
    'EASY',
    'NORMAL',
    'HARD',
    'EX-HARD',
  ]);
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
