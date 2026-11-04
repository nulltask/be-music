import { readFile } from 'node:fs/promises';
import { expect, openWithLibrary, test } from './support.ts';

test('an LR2 screenshot preserves widescreen pixel aspect and fills its exported frame', async ({ player }, info) => {
  await player.page.setViewportSize({ width: 1280, height: 720 });
  await openWithLibrary(player);
  await player.drop('skins/lr2');
  await player.waitFor((state) => state.scene.kind === 'select' && state.scene.family === 'lr2', 'LR2 select');
  const pending = player.page.waitForEvent('download');
  await player.pressOption(['Capture'], '📸 Screenshot');
  const download = await pending;
  const path = info.outputPath('lr2-widescreen-export.png');
  await download.saveAs(path);
  const bytes = await readFile(path);
  expect(bytes.readUInt32BE(16)).toBe(853);
  expect(bytes.readUInt32BE(20)).toBe(480);
  const alpha = await player.page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return context.getImageData(image.width - 2, 100, 1, 1).data[3];
  }, bytes.toString('base64'));
  expect(alpha).toBe(255);
  // Capturing temporarily removes viewport magnification; the live transform must be restored for pointer input.
  await player.clickSkin(150, 120, 640, 480);
  await player.waitFor((state) => state.cursor?.list?.keysFilter !== 'ALL', 'LR2 button after capture');
});
