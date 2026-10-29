import { expect, test, type Player } from './support.ts';

async function colors(player: Player, phase: number): Promise<boolean[]> {
  const screenshot = await player.page.screenshot();
  return player.page.evaluate(
    async ({ base64, phase }) => {
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
        [
          [33, 26, 52],
          [10, 43, 34],
          [6, 40, 29],
        ],
        [
          [59, 12, 75],
          [22, 52, 50],
          [11, 79, 57],
        ],
        [
          [237, 23, 75],
          [22, 207, 99],
          [21, 79, 227],
        ],
      ][phase]!;
      for (let offset = 0; offset < data.length; offset += 4) {
        for (let index = 0; index < targets.length; index++) {
          const target = targets[index]!;
          if (
            Math.abs(data[offset]! - target[0]!) <= 2 &&
            Math.abs(data[offset + 1]! - target[1]!) <= 2 &&
            Math.abs(data[offset + 2]! - target[2]!) <= 2
          )
            counts[index]!++;
        }
      }
      return counts.map((count) => count > 100);
    },
    { base64: screenshot.toString('base64'), phase },
  );
}

for (const family of ['native', 'canvas', 'lr2', 'beatoraja'] as const) {
  test(`${family} selects independent ARGB definitions and shares alpha with opacity controls`, async ({
    player,
  }, info) => {
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
              '#TITLE Channel ARGB',
              '#BPM 120',
              '#BMP01 base.png',
              '#BMP02 first.png',
              '#BMP03 second.png',
              '#BMP04 clear.png',
              '#00004:01',
              '#00007:02',
              '#0000A:03',
              '#ARGB61 128,128,255,64',
              '#ARGB62 128,64,128,255',
              '#ARGB63 64,255,64,128',
              '#ARGB64 255,255,255,255',
              '#000A1:61',
              '#000A2:62',
              '#000A3:63',
              '#0020B:FF',
              '#0020C:FF',
              '#0020D:FF',
              '#004A1:64',
              '#004A2:64',
              '#004A3:64',
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
    for (const phase of [0, 1, 2]) {
      await expect.poll(() => colors(player, phase), { timeout: 15_000 }).toEqual([true, true, true]);
      await player.page.screenshot({ path: info.outputPath(`argb-${phase}.png`) });
    }
  });
}
