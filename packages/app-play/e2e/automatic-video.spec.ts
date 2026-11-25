import { readFile } from 'node:fs/promises';
import { expect, SONGS, test } from './support.ts';

test('downloads a fresh video for each play and fades the result in the file only', async ({ player }) => {
  const { page } = player;
  await player.open({ 'be-music.built-in-skin': 'native', 'be-music.skin-effects': 'full' });
  await player.drop('songs', { prefix: SONGS });
  await player.setOption(['Play options'], 'Auto play', true);
  await player.setOption(['Capture'], 'Record every play', true);

  for (const [index, title] of ['Fixture A', 'Fixture B'].entries()) {
    await player.browseTo(SONGS, title);
    const download = page.waitForEvent('download', { timeout: 60_000 });
    await player.key('Enter');
    await player.waitForResult(index);
    if (index === 0) await player.key('Escape');
    const video = await download;
    expect(video.suggestedFilename()).toMatch(new RegExp(`^${title}\\.(mp4|webm)$`));
    const path = await video.path();
    expect(path).not.toBeNull();
    const bytes = await readFile(path!);
    expect(bytes.length).toBeGreaterThan(1_000);
    if (index === 0) {
      await player.waitFor((state) => state.scene.kind === 'select', 'the select screen to return after saving');
      continue;
    }
    const stage = page.locator('#stage canvas');
    await expect(stage).toBeVisible();
    const live = await stage.screenshot();
    const captured = await page.evaluate(
      async ({ base64, mimeType, live }) => {
        const video = document.createElement('video');
        video.src = `data:${mimeType};base64,${base64}`;
        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve();
          video.onerror = () => reject(new Error('The saved video could not be decoded'));
        });
        const canvas = document.createElement('canvas');
        canvas.width = 96;
        canvas.height = 54;
        const context = canvas.getContext('2d')!;
        const brightness = (source: CanvasImageSource) => {
          context.drawImage(source, 0, 0, canvas.width, canvas.height);
          const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let brightest = 0;
          for (let i = 0; i < data.length; i += 4)
            brightest = Math.max(brightest, data[i]!, data[i + 1]!, data[i + 2]!);
          return brightest;
        };
        const videoBrightness = async (time: number) => {
          await new Promise<void>((resolve) => {
            video.onseeked = () => resolve();
            video.currentTime = time;
          });
          return brightness(video);
        };
        const liveImage = new Image();
        liveImage.src = `data:image/png;base64,${live}`;
        await liveImage.decode();
        return {
          result: await videoBrightness(video.duration - 0.7),
          end: await videoBrightness(video.duration - 0.04),
          live: brightness(liveImage),
        };
      },
      {
        base64: bytes.toString('base64'),
        mimeType: video.suggestedFilename().endsWith('.mp4') ? 'video/mp4' : 'video/webm',
        live: live.toString('base64'),
      },
    );
    expect(captured.result).toBeGreaterThan(80);
    expect(captured.end).toBeLessThan(40);
    expect(captured.live).toBeGreaterThan(80);
    expect((await player.state()).scene.kind).toBe('result');
  }
});
