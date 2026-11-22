import { decodePNGToRGBA8 } from '../../shared-utils/src/png.ts';
import { expect, test } from './support.ts';

test('Synesthesia displays difficulty and a banner below its controls, with matching search type', async ({
  player,
}, info) => {
  await player.page.setViewportSize({ width: 1280, height: 720 });
  await player.open({ 'be-music.built-in-skin': 'synesthesia', 'be-music.skin-effects': 'full' });
  const bannerRGB = [17, 219, 139] as const;
  const before = (await player.state()).loads;
  await player.page.evaluate(async (rgb) => {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 260;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = `rgb(${rgb.join(',')})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!)));
    const files = [
      new File(
        ['#TITLE Banner preview\n#ARTIST Be-Music Dev Team\n#BANNER banner.png\n#BPM 120\n#02011:01\n'],
        'preview.bme',
      ),
      new File([blob], 'banner.png'),
    ];
    const event = new Event('drop', { cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { items: [], files, types: ['Files'] } });
    window.dispatchEvent(event);
  }, bannerRGB);
  await player.waitFor((state) => state.loads > before && !state.loading, 'banner chart');
  await player.cursorTo((bar) => bar.title === 'Banner preview', 'banner preview');
  const stage = player.page.locator('#stage canvas');
  await expect(async () => {
    const { width, height, data } = decodePNGToRGBA8(await stage.screenshot());
    const scale = Math.min(width / 854, height / 480);
    const left = (width - 854 * scale) / 2;
    const top = (height - 480 * scale) / 2;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixel = (y * width + x) * 4;
        if (bannerRGB.some((channel, index) => Math.abs(data[pixel + index]! - channel) > 3)) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    // Tall artwork fills the content width and is clipped to the space above the quick options.
    expect((minX - left) / scale).toBeCloseTo(30, -1);
    expect((maxX - left) / scale).toBeCloseTo(288, -1);
    expect((minY - top) / scale).toBeCloseTo(351, -1);
    expect((maxY - top) / scale).toBeCloseTo(420, -1);
  }).toPass({ timeout: 15_000 });
  await player.page.screenshot({ path: info.outputPath('select-banner-difficulty.png') });
  await player.page.mouse.click(750, 148);
  const search = player.page.locator('#search');
  await expect(search).toBeFocused();
  const size = await search.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  expect(size).toBeGreaterThan(12);
  expect(size).toBeLessThan(14);
  await search.fill('Banner');
  await player.page.screenshot({ path: info.outputPath('select-search.png') });
});
