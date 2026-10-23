import { parseChart } from '@be-music/chart-parser';
import { expect, test } from 'vite-plus/test';
import { observePlay } from './harness.ts';

test('PMS keeps raw gauge max 120 in engine frames but records and simulates percent', async () => {
  const chart = parseChart('#PLAYER 1\n#BPM 120\n#TOTAL 12\n#00011:0001\n#00111:01', 'pms');
  const play = await observePlay({ driver: 'auto', chart, options: { judgeRuleset: 'beatoraja', playVariant: '9' } });
  expect(play.summary?.gauge).toMatchObject({ max: 120, initial: 30, clearThreshold: 85, current: 42 });
  expect(play.replay?.results?.native?.gauge.final).toBe(35);
  expect(play.simulated?.beatoraja?.gauge.final).toBe(35);
});
