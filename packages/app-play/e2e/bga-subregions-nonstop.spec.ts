import { createHash } from 'node:crypto';
import { expect, test, type Player } from './support.ts';

async function placementError(player: Player, green: boolean | 'empty-layer' | 'empty-base'): Promise<number> {
  const screenshot = await player.page.screenshot();
  return player.page.evaluate(
    async ({ base64, green }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const bounds = [
        [Infinity, Infinity, -1, -1],
        [Infinity, Infinity, -1, -1],
      ];
      const targets = [[21, 79, 227], green ? [22, 207, 99] : [237, 23, 75]];
      for (let y = 0; y < canvas.height; y++)
        for (let x = 0; x < canvas.width; x++) {
          const offset = (y * canvas.width + x) * 4;
          for (let index = 0; index < 2; index++)
            if (targets[index]!.every((channel, c) => Math.abs(channel - data[offset + c]!) <= 1)) {
              const box = bounds[index]!;
              box[0] = Math.min(box[0]!, x);
              box[1] = Math.min(box[1]!, y);
              box[2] = Math.max(box[2]!, x);
              box[3] = Math.max(box[3]!, y);
            }
        }
      const [canvasBox, crop] = bounds;
      if (green === 'empty-layer') return crop![2]! < 0 && canvasBox![2]! >= 0 ? 0 : 1;
      if (green === 'empty-base') return crop![2]! < 0 && canvasBox![2]! < 0 ? 0 : 1;
      if (crop![2]! < 0 || canvasBox![2]! < 0) return 1;
      const w = canvasBox![2]! - canvasBox![0]! + 1,
        h = canvasBox![3]! - canvasBox![1]! + 1;
      const actual = [
        (crop![0]! - canvasBox![0]!) / w,
        (crop![1]! - canvasBox![1]!) / h,
        (crop![2]! - crop![0]! + 1) / w,
        (crop![3]! - crop![1]! + 1) / h,
      ];
      const expected = green ? [0.375, 0.375, 0.5, 0.5] : [0.125, 0.25, 0.5, 0.5];
      return Math.max(...actual.map((value, i) => Math.abs(value - expected[i]!)));
    },
    { base64: screenshot.toString('base64'), green },
  );
}

for (const family of ['native', 'canvas', 'lr2', 'beatoraja'] as const) {
  test(`${family} keeps nested EXBMP sub-region resources and origins through NONSTOP`, async ({ player }, info) => {
    await player.open({ 'be-music.built-in-skin': family === 'native' ? 'native' : 'plain' });
    if (family === 'lr2' || family === 'beatoraja') await player.drop(`skins/${family}`);
    const a =
      '#TITLE Red sub-region\n#BPM 120\n#BMP01 base.png\n#EXBMP03 ,,,,a-sheet.png\n#BGA02 04 16 32 144 160 32 64\n#BGA04 03 256 0 384 128 16 32\n#00004:01\n#00007:02\n#00111:01\n#00419:01\n';
    const b =
      '#TITLE Green sub-region\n#BPM 120\n#BMP01 base.png\n#EXBMP03 ,,,,b-sheet.png\n#BGA02 04 48 32 240 224 96 96\n#BGA04 03 0 0 128 128 48 32\n#00204:01\n#00207:02\n#BGA05 03 600 0 620 20 0 0\n#00211:01\n#00307:05\n#00404:05\n#00819:01\n';
    const before = (await player.state()).loads;
    await player.page.evaluate(
      async ({ a, b }) => {
        const files: File[] = [];
        for (const [name, width, color, x, paintedWidth, paintedHeight] of [
          ['base.png', 256, '#154fe3', 0, 256, 256],
          ['a-sheet.png', 512, '#ed174b', 256, 128, 128],
          ['b-sheet.png', 512, '#16cf63', 0, 128, 128],
        ] as const) {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = 256;
          const context = canvas.getContext('2d')!;
          context.fillStyle = '#000000';
          context.fillRect(0, 0, width, 256);
          context.fillStyle = color;
          context.fillRect(x, 0, paintedWidth, paintedHeight);
          const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
          files.push(new File([blob], name));
        }
        files.push(new File([a], 'red.bms'), new File([b], 'green.bms'));
        for (const file of files) Object.defineProperty(file, 'webkitRelativePath', { value: file.name });
        const event = new Event('drop', { cancelable: true });
        Object.defineProperty(event, 'dataTransfer', { value: { items: [], files, types: ['Files'] } });
        window.dispatchEvent(event);
      },
      { a, b },
    );
    await player.waitFor((state) => state.loads > before && !state.loading, 'sub-region stages');
    const hashes = [a, b].map((text) => createHash('md5').update(text).digest('hex')).join('');
    await player.dropText(
      'Crops.lr2crs',
      `<courselist><course><title>Sub-region NONSTOP</title><line>7</line><type>1</type><hash>${'0'.repeat(32)}${hashes}</hash></course></courselist>`,
    );
    await player.openFolder('Crops');
    await player.setOption(['Play options'], 'Auto play', true);
    await player.key('Enter');
    await player.waitFor(
      (state) => state.scene.kind === 'play' && state.play?.title === 'Sub-region NONSTOP',
      'sub-region NONSTOP play',
    );
    await expect.poll(() => placementError(player, false), { timeout: 12_000 }).toBeLessThan(0.025);
    await player.page.screenshot({ path: info.outputPath('nonstop-red-subregion.png') });
    await expect.poll(() => placementError(player, true), { timeout: 18_000 }).toBeLessThan(0.025);
    await player.page.screenshot({ path: info.outputPath('nonstop-green-subregion.png') });
    await expect.poll(() => placementError(player, 'empty-layer'), { timeout: 10_000 }).toBe(0);
    await player.page.screenshot({ path: info.outputPath('nonstop-empty-layer.png') });
    await expect.poll(() => placementError(player, 'empty-base'), { timeout: 10_000 }).toBe(0);
    await player.page.screenshot({ path: info.outputPath('nonstop-empty-base.png') });
  });
}
