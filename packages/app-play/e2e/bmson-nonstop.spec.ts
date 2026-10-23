import { createHash } from 'node:crypto';
import { expect, test } from './support.ts';

test('plays a mixed BMS/bmson NONSTOP course and refuses LR2 placement', async ({ demo }) => {
  await demo.open();
  const bms = '#PLAYER 1\n#TITLE BMS stage\n#BPM 240\n#00111:01\n#00219:01\n';
  const bmson = JSON.stringify({
    version: '1.0.0',
    info: { title: 'bmson stage', init_bpm: 240, resolution: 240, judge_rank: 125, mode_hint: 'beat-7k' },
    sound_channels: [
      {
        name: 'slice.wav',
        notes: [
          { x: 1, y: 240 },
          { x: 2, y: 480, c: true },
          { x: 7, y: 960 },
        ],
      },
    ],
  });
  await demo.dropText('bms-stage.bms', bms);
  await demo.dropText('bmson-stage.bmson', bmson);
  const hashes = [bms, bmson].map((text) => createHash('md5').update(text).digest('hex')).join('');
  await demo.dropText(
    'Mixed.lr2crs',
    `<courselist><course><title>Mixed NONSTOP</title><line>7</line><type>1</type><hash>${'0'.repeat(32)}${hashes}</hash></course></courselist>`,
  );
  await demo.openFolder('Mixed');
  await demo.setOption(['Play options'], 'Auto play', true);
  await demo.key('Enter');
  await demo.waitFor(
    (state) => state.scene.kind === 'play' && state.play?.title === 'Mixed NONSTOP',
    'mixed NONSTOP play',
  );
  const result = await demo.waitForResult(0);
  expect(result.results[0]).toMatchObject({ run: 'nonstop', title: 'Mixed NONSTOP', cleared: true });
  await demo.leaveResult();
  await demo.waitFor((state) => state.scene.kind === 'select', 'course selection');
  await demo.setOption(['Course'], 'NONSTOP placement', 'lr2');
  await demo.key('Enter');
  const refused = await demo.waitFor((state) => state.status.includes('bmson'), 'LR2 placement refusal');
  expect(refused.scene.kind).toBe('select');
});
