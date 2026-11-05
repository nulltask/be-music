import { expect, test } from './support.ts';

test('Synesthesia displays difficulty and a banner below its controls, with matching search type', async ({
  player,
}, info) => {
  await player.page.setViewportSize({ width: 1280, height: 720 });
  await player.open({ 'be-music.built-in-skin': 'synesthesia', 'be-music.skin-effects': 'full' });
  const before = (await player.state()).loads;
  await player.page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 100;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#203e62';
    ctx.fillRect(0, 0, 600, 100);
    ctx.fillStyle = '#e8b65e';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText('BE-MUSIC • BANNER', 24, 64);
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
  });
  await player.waitFor((state) => state.loads > before && !state.loading, 'banner chart');
  await player.cursorTo((bar) => bar.title === 'Banner preview', 'banner preview');
  await player.page.waitForTimeout(700);
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
