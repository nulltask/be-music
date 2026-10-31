import { expect, test } from './support.ts';

for (const family of ['native', 'canvas', 'lr2', 'beatoraja'] as const) {
  test(`${family} applies zero-total no-recovery and restores the replay policy`, async ({ player }) => {
    await player.open({ 'be-music.built-in-skin': family === 'native' ? 'native' : 'plain' });
    if (family === 'lr2' || family === 'beatoraja') await player.drop(`skins/${family}`);
    await player.dropText(
      'zero-total.bmson',
      JSON.stringify({
        version: '1.0.0',
        info: { title: 'Zero TOTAL', mode_hint: 'beat-7k', init_bpm: 120, resolution: 240, judge_rank: 100, total: 0 },
        sound_channels: [
          {
            name: 'key.wav',
            notes: [
              { x: 1, y: 960 },
              { x: 2, y: 1920 },
            ],
          },
        ],
      }),
    );
    await player.setOption(['Play options'], 'bmson TOTAL 0', 'No recovery (bmson spec)');
    await player.setOption(['Play options'], 'Auto play', false);
    await player.setOption(['Play options'], 'Gauge', 'GROOVE');
    await player.key('Enter');
    await player.waitFor((state) => state.scene.kind === 'play' && (state.play?.seconds ?? 0) > 0.1, 'zero total play');
    await player.keyWhen((state) => (state.play?.seconds ?? 0) >= 1.98, undefined, 'KeyZ', 'first zero-total note');
    await player.keyWhen((state) => (state.play?.seconds ?? 0) >= 3.98, undefined, 'KeyS', 'second zero-total note');
    await player.waitForResult(0);
    const replay = await player.lastReplay();
    expect(replay?.play.bmsonTotalMode).toBe('spec');
    expect((replay?.results?.native?.judge.pgreat ?? 0) + (replay?.results?.native?.judge.great ?? 0)).toBe(2);
    expect(replay?.results?.native?.gauge.final).toBe(20);
    if (family === 'native') {
      await player.leaveResult();
      await player.setOption(['Play options'], 'bmson TOTAL 0', 'Native compatibility');
      await player.dropText('strict.bmplay.json', JSON.stringify(replay));
      await player.waitForResult(1);
      expect((await player.state()).results.at(-1)?.gauge.value).toBe(20);
      await player.leaveResult();
      delete replay!.play.bmsonTotalMode;
      await player.setOption(['Play options'], 'bmson TOTAL 0', 'No recovery (bmson spec)');
      await player.dropText('legacy.bmplay.json', JSON.stringify(replay));
      await player.waitForResult(2);
      expect((await player.state()).results.at(-1)?.gauge.value).toBeGreaterThan(20);
    }
  });
}
