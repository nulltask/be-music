import { expect, test } from './support.ts';

for (const family of ['native', 'canvas', 'lr2', 'beatoraja'] as const) {
  test(`${family} applies authored HI-SPEED without user clamping and retains the effective replay program`, async ({
    player,
  }, info) => {
    await player.open({ 'be-music.built-in-skin': family === 'native' ? 'native' : 'plain' });
    if (family === 'lr2' || family === 'beatoraja') await player.drop(`skins/${family}`);
    await player.dropText(
      'options.bms',
      `#TITLE Authored HI-SPEED
#BPM 120
#OPTION 774:HI-SPEED_x0.77
#CHANGEOPTION01 774:HI-SPEED_x100.00
#CHANGEOPTION02 774:HI-SPEED_x0.25
#001A6:01
#002A6:02
#00011:0001
#00211:0001
#00311:0001
`,
    );
    await player.setOption(['Play options'], 'Auto play', false);
    await player.setOption(['Play options'], 'Gauge', 'GROOVE');
    await player.key('Enter');
    await player.waitFor(
      (state) => state.scene.kind === 'play' && (state.play?.seconds ?? 0) > 0.2,
      'authored speed play',
    );
    await expect.poll(async () => (await player.state()).play?.hiSpeed).toBe(0.77);
    await player.page.screenshot({ path: info.outputPath('authored-077.png') });
    await player.waitFor((state) => (state.play?.seconds ?? 0) > 2.1, 'authored 100');
    await expect.poll(async () => (await player.state()).play?.hiSpeed).toBe(100);
    await player.key('Space');
    const paused = (await player.state()).play?.seconds;
    await player.page.waitForTimeout(200);
    expect((await player.state()).play?.seconds).toBeCloseTo(paused!, 2);
    expect((await player.state()).play?.hiSpeed).toBe(100);
    await player.key('Space');
    await player.waitFor((state) => (state.play?.seconds ?? 0) > 4.1, 'authored 025');
    await expect.poll(async () => (await player.state()).play?.hiSpeed).toBe(0.25);
    await player.page.screenshot({ path: info.outputPath('authored-025.png') });
    await player.waitForResult(0);
    const replay = await player.lastReplay();
    expect(replay?.chart.chartOptions).toEqual({
      version: 1,
      initial: { hiSpeed: 0.77 },
      cues: [
        { timeUs: 2000000, state: { hiSpeed: 100 } },
        { timeUs: 4000000, state: { hiSpeed: 0.25 } },
      ],
    });
    expect(replay?.play.viewChanges?.some((change) => change.hiSpeed === 100) ?? false).toBe(false);
    expect(replay?.play.optionChanges?.some((change) => change.values.hiSpeed === 100) ?? false).toBe(false);
    if (family === 'native') {
      await player.leaveResult();
      await player.dropText('options.bmplay.json', JSON.stringify(replay));
      await player.waitFor(
        (state) => state.scene.kind === 'play' && state.play?.replay === true && (state.play.seconds ?? 0) > 0.1,
        'authored speed replay',
      );
      await expect.poll(async () => (await player.state()).play?.hiSpeed).toBe(0.77);
      await player.waitFor((state) => (state.play?.seconds ?? 0) > 2.1, 'replayed authored 100');
      await expect.poll(async () => (await player.state()).play?.hiSpeed).toBe(100);
      await player.waitForResult(1);
      await player.leaveResult();
      delete replay!.chart.chartOptions;
      await player.dropText('legacy-options.bmplay.json', JSON.stringify(replay));
      await player.waitFor(
        (state) => state.scene.kind === 'play' && state.play?.replay === true && (state.play.seconds ?? 0) > 0.1,
        'legacy replay without an effective program',
      );
      const originalUserSpeed = (await player.state()).play?.hiSpeed;
      expect(originalUserSpeed).not.toBe(0.77);
      await player.waitFor((state) => (state.play?.seconds ?? 0) > 2.1, 'legacy replay ignores new source execution');
      expect((await player.state()).play?.hiSpeed).toBe(originalUserSpeed);
    }
  });
}
