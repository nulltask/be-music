import { expect, test } from 'vite-plus/test';
import { parseBMS, parseBmson } from '@be-music/chart-parser';
import { resolveChart } from '@be-music/chart-model';
import { stringifyBMS, stringifyBmson } from './index.ts';

test.each([0, 1])('HDX LONGMODE %s survives native writing and bmson conversion', (argument) => {
  const chart = parseBMS(
    `#OPTION charatbeatHDX:LONGMODE ${argument}\n#BPM 120\n#WAV01 a.wav\n#LNTYPE 1\n#00151:01\n#00251:01`,
  );
  for (const output of [parseBMS(stringifyBMS(chart)), parseBmson(stringifyBmson(chart))])
    expect(resolveChart(output).notes.map((note) => note.lnMode)).toEqual([argument === 0 ? 2 : 3]);
  expect(JSON.parse(stringifyBmson(chart)).info.ln_type).toBe(argument === 0 ? 2 : 3);
});
