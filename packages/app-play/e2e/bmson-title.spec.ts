import { expect, test } from './support.ts';

for (const artwork of [true, false]) {
  test(`native bmson title uses ${artwork ? 'the title artwork' : 'text when artwork is missing'}`, async ({
    player,
  }, info) => {
    await player.open({ 'be-music.built-in-skin': 'native' });
    const before = (await player.state()).loads;
    await player.page.evaluate(async (withArtwork) => {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 60;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#00ff00';
      context.fillRect(0, 0, 160, 60);
      const image = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png'));
      const chart = JSON.stringify({
        version: '1.0.0',
        info: {
          title: 'bmson title artwork',
          artist: 'Fixture',
          init_bpm: 120,
          mode_hint: 'beat-7k',
          title_image: 'title.png',
          eyecatch_image: 'loading.png',
        },
        sound_channels: [{ name: 'silent.wav', notes: [{ x: 1, y: 960 }] }],
      });
      const files = [new File([chart], 'title.bmson')];
      if (withArtwork) files.push(new File([image], 'title.png'));
      for (const file of files) Object.defineProperty(file, 'webkitRelativePath', { value: file.name });
      const event = new Event('drop', { cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { items: [], files, types: ['Files'] } });
      window.dispatchEvent(event);
    }, artwork);
    await player.waitFor((state) => state.loads > before && !state.loading, 'the bmson title fixture');
    await player.key('Enter');
    const screen = player.page.locator('[data-be-music-screen="decide"]');
    await expect(screen).toBeVisible();
    if (artwork) {
      const image = screen.getByRole('img', { name: 'bmson title artwork' });
      await expect(image).toBeVisible();
      const pixel = await image.evaluate(async (element: HTMLImageElement) => {
        await element.decode();
        const canvas = document.createElement('canvas');
        canvas.width = element.naturalWidth;
        canvas.height = element.naturalHeight;
        const context = canvas.getContext('2d')!;
        context.drawImage(element, 0, 0);
        return [...context.getImageData(1, 1, 1, 1).data];
      });
      expect(pixel).toEqual([0, 255, 0, 255]);
      await player.page.screenshot({ path: info.outputPath('bmson-title-image.png') });
    } else {
      await expect(screen.getByRole('heading', { name: 'bmson title artwork' })).toHaveText('bmson title artwork');
      await expect(screen.getByRole('img')).toHaveCount(0);
    }
  });
}
