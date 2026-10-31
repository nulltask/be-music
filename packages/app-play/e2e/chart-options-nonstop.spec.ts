import { createHash } from 'node:crypto';
import { expect, test } from './support.ts';

for (const family of ['native', 'canvas', 'lr2', 'beatoraja'] as const) {
  test(`${family} owns compulsory HI-SPEED per NONSTOP stage and restores the user's setting`, async ({
    player,
  }, info) => {
    await player.open({ 'be-music.built-in-skin': family === 'native' ? 'native' : 'plain' });
    if (family === 'lr2' || family === 'beatoraja') await player.drop(`skins/${family}`);
    const a = '#TITLE Option stage A\n#BPM 120\n#OPTION 774:HI-SPEED_x0.77\n#00211:01\n#00411:01';
    const b =
      '#TITLE Option stage B\n#BPM 60\n#OPTION 774:HI-SPEED_x100.00\n#CHANGEOPTION01 774:HI-SPEED_x0.25\n#003A6:01\n#00211:01\n#00411:01';
    const c = '#TITLE Option stage C\n#BPM 120\n#00211:01\n#00411:01';
    await player.dropText('options-a.bms', a);
    await player.dropText('options-b.bms', b);
    await player.dropText('options-c.bms', c);
    const hashes = [a, b, c].map((source) => createHash('md5').update(source).digest('hex')).join('');
    const header = '32' + '0'.repeat(30); // CUT+FIT, then CUT.
    await player.dropText(
      'Options.lr2crs',
      `<courselist><course><title>Option NONSTOP</title><line>7</line><type>1</type><hash>${header}${hashes}</hash></course></courselist>`,
    );
    await player.openFolder('Options');
    await player.setOption(['Play options'], 'Auto play', true);
    await player.setOption(['Play options'], 'Hi-speed', 3);
    await player.key('Enter');
    await player.waitFor(
      (state) =>
        state.scene.kind === 'play' && state.play?.title === 'Option NONSTOP' && (state.play.seconds ?? 0) > 0.2,
      'option NONSTOP',
    );
    await expect.poll(async () => (await player.state()).play?.hiSpeed).toBe(0.77);
    await player.waitFor((state) => (state.play?.seconds ?? 0) > 8.1, 'second stage ownership');
    await expect.poll(async () => (await player.state()).play?.hiSpeed).toBe(100);
    await player.key('Space');
    const paused = (await player.state()).play?.seconds;
    await player.page.waitForTimeout(200);
    expect((await player.state()).play?.seconds).toBeCloseTo(paused!, 2);
    expect((await player.state()).play?.hiSpeed).toBe(100);
    await player.key('Space');
    await player.waitFor((state) => (state.play?.seconds ?? 0) > 10.1, 'FIT-placed A6');
    await expect.poll(async () => (await player.state()).play?.hiSpeed).toBe(0.25);
    await player.page.screenshot({ path: info.outputPath('fitted-authored-speed.png') });
    await player.waitFor((state) => (state.play?.seconds ?? 0) > 12.1, 'empty stage releases authored speed');
    await expect.poll(async () => (await player.state()).play?.hiSpeed).toBe(3);
    expect(await player.readOption(['Play options'], 'Hi-speed')).toBe(3);
    await player.page.screenshot({ path: info.outputPath('restored-user-speed.png') });
  });
}
