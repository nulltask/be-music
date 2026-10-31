import { expect, test } from 'vite-plus/test';
import { parseBMS } from '@be-music/chart-parser';
import { observePlay } from './characterization/harness.ts';

const source = '#BPM 240\n#WAV01 a.wav\n#LNTYPE 1\n#00051:0001\n#00151:0001';
test.each([0, 1])('HDX LONGMODE %s uses the existing CN/HCN judge and replay simulation', async (argument) => {
  const run = (header: string, judgeRuleset: 'beatoraja' | 'lr2' = 'beatoraja') =>
    observePlay({
      chart: parseBMS(`${header}\n${source}`),
      driver: 'manual',
      options: { judgeRuleset },
      script: [
        { atMs: 500, down: ['11'] },
        { atMs: 800, up: ['11'] },
        { atMs: 1100, down: ['11'] },
      ],
      captureAt: [0.6, 0.9, 1.2, 1.6],
    });
  const authored = await run(`#OPTION charatbeatHDX:LONGMODE ${argument}`);
  const explicit = await run(`#LNMODE ${argument === 0 ? 2 : 3}`);
  expect(authored.outcome).toBe('completed');
  expect(authored.summary).toEqual(explicit.summary);
  expect(authored.captured).toEqual(explicit.captured);
  expect(authored.simulated).toEqual(explicit.simulated);
  expect(authored.replay?.chart.notes).toEqual(explicit.replay?.chart.notes);
  expect(authored.replay?.chart.lnMode).toBe(argument === 0 ? 2 : 3);
  const lr2 = await run(`#OPTION charatbeatHDX:LONGMODE ${argument}`, 'lr2');
  const ln = await run('#LNMODE 1', 'lr2');
  expect(lr2.summary).toEqual(ln.summary);
});
