import { expect, test } from './support.ts';

for (const family of ['native', 'canvas', 'lr2', 'beatoraja'] as const) {
  test(`${family} opts into authored COUPLE without copying its unequal sides`, async ({ player }, info) => {
    await player.open({ 'be-music.built-in-skin': family === 'native' ? 'native' : 'plain' });
    if (family === 'lr2' || family === 'beatoraja') await player.drop(`skins/${family}`);
    await player.dropText(
      'couple.bms',
      '#TITLE Authored COUPLE\n#SETRANDOM 1\n#IF 1\n#PLAYER 2\n#ENDIF\n#ENDRANDOM\n#BPM 240\n#00111:01\n#00121:01010101\n#00211:01',
    );
    await player.setOption(['Developer'], 'Judgment windows', 'LR2');
    await player.setOption(['Play options'], 'Battle', 'CHART HEADER');
    await player.setOption(['Play options'], 'Gauge 2P', 'HARD');
    await player.setOption(['Play options'], 'Auto play', true);
    await player.key('Enter');
    await player.waitFor((state) => state.scene.kind === 'play' && (state.play?.seconds ?? 0) > 0.6, 'COUPLE play');
    await player.key('Space');
    await player.page.screenshot({ path: info.outputPath('authored-couple.png') });
    if (family === 'native') await expect(player.page.locator('[part~="second-player"]').first()).toBeAttached();
    await player.key('Space');
    await player.waitForResult(0);
    const replay = await player.lastReplay();
    expect(replay?.play).toMatchObject({ battleMode: 'COUPLE', gauge2P: 'HARD' });
    expect(replay?.results?.native).toMatchObject({ judge: { pgreat: 2 } });
    expect(replay?.results?.secondPlayer).toMatchObject({ judge: { pgreat: 4 }, gauge: { type: 'HARD' } });
    expect(replay?.chart.notes).toHaveLength(6);
    if (family === 'native') {
      await player.leaveResult();
      await player.setOption(['Play options'], 'Battle', 'OFF');
      await player.dropText('couple.bmplay.json', JSON.stringify(replay));
      await player.waitFor((state) => state.scene.kind === 'play' && state.play?.replay === true, 'recorded COUPLE');
      await player.waitForResult(1);
    }
  });
}
