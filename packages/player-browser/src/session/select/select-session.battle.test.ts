import { expect, test } from 'vite-plus/test';
import { toggleACBattle } from './select-session.ts';

test('AC’s BATTLE key switches the one-player BATTLE on from any mode and off from itself', () => {
  expect(toggleACBattle('OFF')).toBe('____:BATTLE');
  expect(toggleACBattle('beatoraja:BATTLE')).toBe('____:BATTLE');
  expect(toggleACBattle('SP-TO-DP')).toBe('____:BATTLE');
  expect(toggleACBattle('____:BATTLE')).toBe('OFF');
});
