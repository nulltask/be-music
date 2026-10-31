import { readFile } from 'node:fs/promises';
import { expect, test, type Player } from './support.ts';

const boxes = new WeakMap<Player, number[]>();
async function colors(player: Player): Promise<string[]> {
  const result = await player.page.evaluate(
    async ({ base64, box }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const bounds = box ?? [Infinity, Infinity, -1, -1];
      if (!box)
        for (let y = 0; y < canvas.height; y++)
          for (let x = 0; x < canvas.width; x++) {
            const at = (y * canvas.width + x) * 4;
            if (data[at] === 21 && data[at + 1] === 79 && data[at + 2] === 227) {
              bounds[0] = Math.min(bounds[0]!, x);
              bounds[1] = Math.min(bounds[1]!, y);
              bounds[2] = Math.max(bounds[2]!, x);
              bounds[3] = Math.max(bounds[3]!, y);
            }
          }
      if (bounds[2]! < 0) return { bounds, colors: [] };
      const colors = [32, 96, 160, 224].map((x) => {
        const sx = Math.floor(bounds[0]! + (x / 256) * (bounds[2]! - bounds[0]! + 1));
        const sy = Math.floor(bounds[1]! + 0.5 * (bounds[3]! - bounds[1]! + 1));
        const at = (sy * canvas.width + sx) * 4;
        const [r, g, b] = [...data.subarray(at, at + 3)];
        if (Math.abs(r! - 21) < 4 && Math.abs(g! - 79) < 4 && Math.abs(b! - 227) < 4) return 'blue';
        if (r! < 9 && g! < 9 && b! < 9) return 'black';
        if (r! > 150 && r! > g! * 2 && r! > b! * 1.5) return 'red';
        if (g! > 150 && g! > r! * 2 && g! > b! * 1.5) return 'green';
        return 'other';
      });
      return { bounds, colors };
    },
    { base64: (await player.page.screenshot()).toString('base64'), box: boxes.get(player) },
  );
  if (result.colors.length) boxes.set(player, result.bounds);
  return result.colors;
}

for (const family of ['native', 'canvas', 'lr2', 'beatoraja'] as const) {
  test(`${family} keys EXBMP movie frames before cropping and preserves unkeyed black`, async ({ player }, info) => {
    await player.open({ 'be-music.built-in-skin': family === 'native' ? 'native' : 'plain' });
    if (family === 'lr2' || family === 'beatoraja') await player.drop(`skins/${family}`);
    const before = (await player.state()).loads;
    const video = (await readFile('test/fixtures/exbmp-video.webm')).toString('base64');
    await player.page.evaluate(async (video) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#154fe3';
      context.fillRect(0, 0, 256, 256);
      const base = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
      // BMS 00 is a rest; an authored transparent image removes the previous overlay.
      context.clearRect(0, 0, 256, 256);
      const clear = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
      const files = [
        new File([clear], 'clear.png'),
        new File([base], 'base.png'),
        new File([Uint8Array.from(atob(video), (c) => c.charCodeAt(0))], 'clip.webm'),
        new File(
          [
            [
              '#TITLE EXBMP video',
              '#BPM 120',
              '#POORBGA 2',
              '#BMP05 base.png',
              '#EXBMP01 0,255,255,255 clip.webm',
              '#BMP03 clear.png',
              '#BGA02 01 64 0 192 256 0 64',
              '#00004:05',
              '#00007:02',
              '#00307:01',
              '#00604:01',
              '#00607:03',
              '#01211:01',
              '#01219:01',
              '',
            ].join('\n'),
          ],
          'video.bms',
        ),
      ];
      for (const file of files) Object.defineProperty(file, 'webkitRelativePath', { value: file.name });
      const event = new Event('drop', { cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { items: [], files, types: ['Files'] } });
      window.dispatchEvent(event);
    }, video);
    await player.waitFor((state) => state.loads > before && !state.loading, 'EXBMP movie chart');
    await player.setOption(['Play options'], 'Auto play', true);
    await player.key('Enter');
    await player.waitFor((state) => state.scene.kind === 'play', 'EXBMP movie play');
    for (const [phase, expected] of [
      ['crop-red', ['red', 'black', 'blue', 'blue']],
      ['crop-green', ['green', 'black', 'blue', 'blue']],
      ['root-red', ['blue', 'red', 'black', 'blue']],
      ['root-green', ['blue', 'green', 'black', 'blue']],
      ['base-red', ['black', 'red', 'black', 'black']],
      ['base-green', ['black', 'green', 'black', 'black']],
    ] as const) {
      await expect.poll(() => colors(player), { timeout: 12_000, intervals: [50] }).toEqual(expected);
      await player.page.screenshot({ path: info.outputPath(`${phase}.png`) });
    }
  });
}
