import { parseChart } from '@be-music/chart-parser';
import { expect, test } from 'vite-plus/test';
import { recordPlayFromSummary } from '../../records/best-record.ts';
import { resolveRulesetResultLamp } from '../../replay/result-lamp.ts';
import { observePlay, tap } from './harness.ts';

// Both notes are hit exactly; the extra press is outside BAD but inside empty POOR.
test.each([
  ['5', 'beatoraja', 2600, 'NORMAL'],
  ['9', 'beatoraja', 2600, 'NORMAL'],
  ['5', 'beatoraja', 600, 'MAX'],
  ['9', 'beatoraja', 600, 'MAX'],
  ['7', 'beatoraja', 2600, 'MAX'],
  ['24', 'beatoraja', 2600, 'MAX'],
  ['5', 'lr2', 2600, 'FULL_COMBO'],
  ['7', '____', 2600, 'FULL_COMBO'],
] as const)('%s/%s with empty POOR at %d ms earns %s', async (playVariant, judgeRuleset, extraAtMs, lamp) => {
  const chart = parseChart('#PLAYER 1\n#BPM 120\n#TOTAL 300\n#00011:0001\n#00111:0001', 'bms');
  const play = await observePlay({
    driver: 'manual',
    chart,
    options: { judgeRuleset, playVariant },
    script: [...tap(1000, '11'), ...tap(3000, '11'), ...tap(extraAtMs, '11')].sort((a, b) => a.atMs - b.atMs),
  });
  expect(play.summary).toMatchObject({ total: 2, perfect: 2, bad: 0, poor: 0, emptyPoor: 1 });
  const native = play.replay!.results!.native!;
  const simulated = play.simulated![judgeRuleset]!;
  expect(resolveRulesetResultLamp(native, judgeRuleset)).toBe(lamp);
  expect(resolveRulesetResultLamp(simulated, judgeRuleset)).toBe(lamp);
  expect(recordPlayFromSummary(play.summary!, native.maxCombo, judgeRuleset).lamp).toBe(lamp);
});

test.each(['5', '9'] as const)('a genuine %s-key full combo still earns MAX', async (playVariant) => {
  const chart = parseChart('#PLAYER 1\n#BPM 120\n#TOTAL 300\n#00011:0001\n#00111:0001', 'bms');
  const play = await observePlay({
    driver: 'manual',
    chart,
    options: { judgeRuleset: 'beatoraja', playVariant },
    script: [...tap(1000, '11'), ...tap(3000, '11')],
  });
  expect(play.summary).toMatchObject({ perfect: 2, emptyPoor: 0 });
  expect(resolveRulesetResultLamp(play.replay!.results!.native!, 'beatoraja')).toBe('MAX');
  expect(resolveRulesetResultLamp(play.simulated!.beatoraja!, 'beatoraja')).toBe('MAX');
});
