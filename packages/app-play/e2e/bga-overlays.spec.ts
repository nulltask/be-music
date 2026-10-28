import { expect, test, type Player } from './support.ts';

async function colors(player: Player): Promise<boolean[]> {
  const screenshot = await player.page.screenshot();
  return player.page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const counts = [0, 0, 0];
    const targets = [
      [237, 23, 75],
      [22, 207, 99],
      [21, 79, 227],
    ];
    for (let offset = 0; offset < data.length; offset += 4) {
      for (let index = 0; index < targets.length; index++) {
        const target = targets[index]!;
        if (data[offset] === target[0] && data[offset + 1] === target[1] && data[offset + 2] === target[2])
          counts[index]!++;
      }
    }
    return counts.map((count) => count > 100);
  }, screenshot.toString('base64'));
}

for (const family of ['native', 'canvas', 'lr2', 'beatoraja'] as const) {
  test(`${family} composites both BMS overlays and clears 0A without clearing 07`, async ({ player }, info) => {
    await player.open({ 'be-music.built-in-skin': family === 'native' ? 'native' : 'plain' });
    if (family === 'lr2' || family === 'beatoraja') await player.drop(`skins/${family}`);
    const before = (await player.state()).loads;
    await player.page.evaluate(async () => {
      const files: File[] = [];
      for (const [name, color, x, width] of [
        ['base.png', '#154fe3', 0, 256],
        ['first.png', '#ed174b', 0, 85],
        ['second.png', '#16cf63', 85, 85],
        ['clear.png', '#000000', 0, 256],
      ] as const) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#000000';
        context.fillRect(0, 0, 256, 256);
        context.fillStyle = color;
        context.fillRect(x, 0, width, 256);
        const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
        files.push(new File([blob], name));
      }
      files.push(
        new File(
          [
            [
              '#TITLE Independent overlays',
              '#BPM 120',
              '#BMP01 base.png',
              '#BMP02 first.png',
              '#BMP03 second.png',
              '#BMP04 clear.png',
              '#00004:01',
              '#00007:02',
              '#0000A:03',
              '#0020A:04',
              '#00811:01',
              '#00819:01',
              '',
            ].join('\n'),
          ],
          'overlays.bms',
        ),
      );
      for (const file of files) Object.defineProperty(file, 'webkitRelativePath', { value: file.name });
      const event = new Event('drop', { cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { items: [], files, types: ['Files'] } });
      window.dispatchEvent(event);
    });
    await player.waitFor((state) => state.loads > before && !state.loading, 'the overlay chart');
    await player.setOption(['Play options'], 'Auto play', true);
    await player.key('Enter');
    await player.waitFor((state) => state.scene.kind === 'play', 'BGA play');
    await expect.poll(() => colors(player), { timeout: 15_000 }).toEqual([true, true, true]);
    await player.page.screenshot({ path: info.outputPath('independent-bga-overlays.png') });
    await expect.poll(() => colors(player), { timeout: 15_000 }).toEqual([true, false, true]);
  });
}
