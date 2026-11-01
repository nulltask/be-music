import { expect, test } from 'vite-plus/test';
import { resolveRandomModes } from '@be-music/player-scene-model';
import { battleModeItems, laneOptionItems, laneOptionSource } from './play-option-items.ts';

test('lane options are grouped by source, the judge ruleset own first, and name their source', () => {
  const items = laneOptionItems('beatoraja');
  expect(items.slice(0, 3).map((item) => item.text)).toEqual(['OFF', 'MIRROR', 'RANDOM (beatoraja)']);
  const sources = items.slice(2).map((item) => laneOptionSource(item.value));
  // One block per source: beatoraja, then LR2, then ????.
  expect([...new Set(sources)]).toEqual(['beatoraja', 'lr2', '____']);
  expect(sources).toEqual(
    [...sources].sort((a, b) => ['beatoraja', 'lr2', '____'].indexOf(a!) - ['beatoraja', 'lr2', '____'].indexOf(b!)),
  );
  expect(items).toContainEqual({ text: 'RANDOM (LR2)', value: 'lr2:RANDOM' });
  expect(items).toContainEqual({ text: 'S-RANDOM (????)', value: '____:S-RANDOM' });
  expect(items).toContainEqual({ text: 'CONVERGE (beatoraja)', value: 'beatoraja:CONVERGE' });
  expect(items).toContainEqual({ text: 'SCATTER 9KEY corrected (LR2)', value: 'SCATTER-CORRECTED' });
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
