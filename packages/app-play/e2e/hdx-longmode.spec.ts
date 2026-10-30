import { expect, test } from './support.ts';

for (const family of ['native', 'canvas', 'lr2', 'beatoraja'] as const) {
  test(`${family} records authored HDX HCN independently of the drawing family`, async ({ player }, info) => {
    await player.open({ 'be-music.built-in-skin': family === 'native' ? 'native' : 'plain' });
    if (family === 'lr2' || family === 'beatoraja') await player.drop(`skins/${family}`);
    await player.dropText(
      'hdx.bms',
      '#TITLE HDX HCN\n#BPM 120\n#OPTION charatbeatHDX:LONGMODE 1\n#LNTYPE 1\n#00051:0001\n#00151:0001\n#00211:01',
    );
    await player.setOption(['Developer'], 'Judgment windows', 'beatoraja');
    await player.setOption(['Play options'], 'Auto play', true);
    await player.key('Enter');
    await player.waitFor((state) => state.scene.kind === 'play' && (state.play?.seconds ?? 0) > 1.2, 'authored HCN');
    await player.page.screenshot({ path: info.outputPath('authored-hcn.png') });
    await player.waitForResult(0);
    const replay = await player.lastReplay();
    expect(replay?.play.judgeRuleset).toBe('beatoraja');
    expect(replay?.chart.lnMode).toBe(3);
    expect(replay?.chart.notes.filter((note) => note.endTimeUs !== undefined).map((note) => note.lnMode)).toEqual([3]);
  });
}
