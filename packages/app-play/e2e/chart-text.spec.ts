import { expect, test, type Player } from './support.ts';

async function textPixels(player: Player): Promise<number> {
  return player.page.evaluate(
    async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, image.width, image.height).data;
      let count = 0;
      for (let y = 0; y < image.height * 0.35; y++)
        for (let x = image.width * 0.1; x < image.width * 0.9; x++) {
          const offset = (y * image.width + Math.floor(x)) * 4;
          if (data[offset]! > 235 && data[offset + 1]! > 235 && data[offset + 2]! > 235) count++;
        }
      return count;
    },
    (await player.page.screenshot()).toString('base64'),
  );
}

for (const family of ['native', 'canvas', 'lr2', 'beatoraja'] as const) {
  test(`${family} displays and clears channel-99 text with pause holding the selection`, async ({ player }, info) => {
    await player.open({ 'be-music.built-in-skin': family === 'native' ? 'native' : 'plain' });
    if (family === 'lr2' || family === 'beatoraja') await player.drop(`skins/${family}`);
    await player.dropText(
      'text.bms',
      `#TITLE Chart text
#BPM 120
#TEXT01 "${'W'.repeat(80)}"
#TEXT02 ""
#00199:01
#00399:02
#00511:01
`,
    );
    await player.setOption(['Play options'], 'Auto play', true);
    await player.key('Enter');
    await player.waitFor((state) => state.scene.kind === 'play' && (state.play?.seconds ?? 0) > 0.3, 'text play');
    const before = await textPixels(player);
    await player.waitFor((state) => (state.play?.seconds ?? 0) > 2.2, 'text selection');
    await expect.poll(() => textPixels(player), { timeout: 2000, intervals: [100] }).toBeGreaterThan(before + 500);
    await player.key('Space');
    const paused = (await player.state()).play?.seconds;
    await player.page.screenshot({ path: info.outputPath('chart-text.png') });
    if (family === 'native') await expect(player.page.locator('[data-chart-text]')).toHaveText('W'.repeat(80));
    await player.page.waitForTimeout(250);
    expect((await player.state()).play?.seconds).toBeCloseTo(paused!, 2);
    await player.key('Space');
    await player.waitFor((state) => (state.play?.seconds ?? 0) > 6.2, 'text clear');
    await expect.poll(() => textPixels(player), { timeout: 2000, intervals: [100] }).toBeLessThan(before + 300);
    if (family === 'native') await expect(player.page.locator('[data-chart-text]')).toBeHidden();
  });
}
