import { readFile } from 'node:fs/promises';
import { expect, test, type Player } from './support.ts';

async function cropColors(player: Player, reference: number[][]): Promise<string[]> {
  const screenshot = await player.page.screenshot();
  return player.page.evaluate(
    async ({ base64, reference }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      const box = [Infinity, Infinity, -1, -1];
      for (let y = 0; y < canvas.height; y++)
        for (let x = 0; x < canvas.width; x++) {
          const at = (y * canvas.width + x) * 4;
          if (data[at] === 21 && data[at + 1] === 79 && data[at + 2] === 227) {
            box[0] = Math.min(box[0]!, x);
            box[1] = Math.min(box[1]!, y);
            box[2] = Math.max(box[2]!, x);
            box[3] = Math.max(box[3]!, y);
          }
        }
      if (box[2]! < 0) return [];
      return [64, 160].map((x, index) => {
        const sx = Math.floor(box[0]! + (x / 256) * (box[2]! - box[0]! + 1));
        const sy = Math.floor(box[1]! + 0.5 * (box[3]! - box[1]! + 1));
        const at = (sy * canvas.width + sx) * 4;
        // YUV video conversion can shift exact RGB values; the authored red/green frames remain unambiguous.
        const [r, g, b] = [data[at]!, data[at + 1]!, data[at + 2]!];
        // Use the browser-decoded source as the oracle: YUV color-range handling differs from FFmpeg's output.
        const tint = index === 0 ? [128, 64, 192] : [64, 128, 192];
        const targets = reference.map((pixel) =>
          pixel.map((value, channel) => Math.round((value * tint[channel]!) / 255)),
        );
        const sample = [r, g, b];
        if (targets[0]!.every((value, channel) => Math.abs(sample[channel]! - value) <= 5)) return 'red';
        if (targets[1]!.every((value, channel) => Math.abs(sample[channel]! - value) <= 5)) return 'green';
        return 'other';
      });
    },
    { base64: screenshot.toString('base64'), reference },
  );
}

for (const family of ['native', 'canvas', 'lr2', 'beatoraja'] as const) {
  test(`${family} retains plane ARGB multipliers on moving video crops and repeated cues`, async ({ player }, info) => {
    await player.open({ 'be-music.built-in-skin': family === 'native' ? 'native' : 'plain' });
    if (family === 'lr2' || family === 'beatoraja') await player.drop(`skins/${family}`);
    const before = (await player.state()).loads;
    const video = (await readFile('test/fixtures/bga-crop-colors.webm')).toString('base64');
    const reference = await player.page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }));
      const clip = document.createElement('video');
      try {
        clip.src = url;
        await new Promise<void>((resolve, reject) => {
          clip.onloadeddata = () => resolve();
          clip.onerror = () => reject(new Error('Reference video decode failed'));
        });
        const canvas = document.createElement('canvas');
        canvas.width = clip.videoWidth;
        canvas.height = clip.videoHeight;
        const context = canvas.getContext('2d')!;
        const result: number[][] = [];
        for (const seconds of [0.5, 4.5]) {
          await new Promise<void>((resolve) => {
            clip.onseeked = () => resolve();
            clip.currentTime = seconds;
          });
          context.drawImage(clip, 0, 0);
          result.push([...context.getImageData(280, 64, 1, 1).data].slice(0, 3));
        }
        return result;
      } finally {
        clip.removeAttribute('src');
        clip.load();
        URL.revokeObjectURL(url);
      }
    }, video);
    await player.page.evaluate(async (video) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#154fe3';
      context.fillRect(0, 0, 256, 256);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
      const files = [
        new File([blob], 'base.png'),
        new File([Uint8Array.from(atob(video), (c) => c.charCodeAt(0))], 'sheet.webm'),
        new File(
          [
            [
              '#TITLE Video sub-regions',
              '#BPM 120',
              '#BMP01 sheet.webm',
              '#BMP05 base.png',
              '#BGA02 04 16 32 80 160 32 64',
              '#BGA03 04 80 32 144 160 128 64',
              '#BGA04 01 256 0 384 128 16 32',
              '#ARGB61 255,128,64,192',
              '#ARGB62 255,64,128,192',
              '#000A2:61',
              '#000A3:62',
              '#00004:05',
              '#00007:02',
              '#0010A:03',
              '#00407:02',
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
    await player.waitFor((state) => state.loads > before && !state.loading, 'video chart');
    await player.setOption(['Play options'], 'Auto play', true);
    await player.key('Enter');
    await player.waitFor((state) => state.scene.kind === 'play', 'video sub-region play');
    for (const [name, colors] of [
      ['both-red', ['red', 'red']],
      ['first-green', ['green', 'red']],
      ['both-green', ['green', 'green']],
      ['restarted-first', ['red', 'green']],
    ] as const) {
      await expect.poll(() => cropColors(player, reference), { timeout: 15_000 }).toEqual(colors);
      await player.page.screenshot({ path: info.outputPath(`${name}.png`) });
    }
  });
}
