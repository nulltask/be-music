import { readFile } from 'node:fs/promises';
import { expect, test, type Player } from './support.ts';

async function correctPixels(player: Player, phase: 'keyed' | 'alpha' | 'disabled' | 'base'): Promise<boolean> {
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
      if (box[2]! < 0) return false;
      const expected = [
        phase === 'disabled' ? [119, 135, 127] : phase === 'base' ? [0, 0, 0] : [21, 79, 227],
        phase === 'alpha' ? [81, 117, 213] : [118, 127, 127],
        [0, 0, 0],
        [22, 207, 99],
      ];
      return [32, 96, 160, 224].every((column, i) => {
        const x = Math.floor(box[0]! + (column / 256) * (box[2]! - box[0]! + 1));
        const y = Math.floor(box[1]! + 0.5 * (box[3]! - box[1]! + 1));
        const at = (y * canvas.width + x) * 4;
        return expected[i]!.every((channel, c) => Math.abs(channel - data[at + c]!) <= 3);
      });
    },
    { base64: (await player.page.screenshot()).toString('base64'), phase },
  );
}

for (const family of ['native', 'canvas', 'lr2', 'beatoraja'] as const) {
  test(`${family} applies EXBMP RGB tolerance, exact source alpha and zero disabling without tint`, async ({
    player,
  }, info) => {
    await player.open({ 'be-music.built-in-skin': family === 'native' ? 'native' : 'plain' });
    if (family === 'lr2' || family === 'beatoraja') await player.drop(`skins/${family}`);
    const before = (await player.state()).loads;
    const rgb = (await readFile('test/fixtures/exbmp-rgb.png')).toString('base64');
    const alpha = (await readFile('test/fixtures/exbmp-alpha.png')).toString('base64');
    await player.page.evaluate(
      async ({ rgb, alpha }) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 256;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#154fe3';
        context.fillRect(0, 0, 256, 256);
        const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
        context.clearRect(0, 0, 256, 256);
        const clear = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
        const files = [
          new File([clear], 'clear.png'),
          new File([blob], 'blue.png'),
          ...[
            ['rgb.png', rgb],
            ['alpha.png', alpha],
          ].map(([name, data]) => new File([Uint8Array.from(atob(data!), (c) => c.charCodeAt(0))], name!)),
          new File(
            [
              [
                '#TITLE EXBMP color keys',
                '#BPM 120',
                '#BMP05 blue.png',
                '#BMP06 clear.png',
                '#EXBMP01 0,127,127,127 rgb.png',
                '#EXBMP02 64,255,228,173 alpha.png',
                '#EXBMP03 0,0,0,0 rgb.png',
                '#BGA04 01 0 0 256 256 0 0',
                '#00004:05',
                '#00007:04',
                '#00207:02',
                '#00407:03',
                '#00604:04',
                '#00607:06',
                '#00811:01',
                '#00819:01',
                '',
              ].join('\n'),
            ],
            'colors.bms',
          ),
        ];
        for (const file of files) Object.defineProperty(file, 'webkitRelativePath', { value: file.name });
        const event = new Event('drop', { cancelable: true });
        Object.defineProperty(event, 'dataTransfer', { value: { items: [], files, types: ['Files'] } });
        window.dispatchEvent(event);
      },
      { rgb, alpha },
    );
    await player.waitFor((state) => state.loads > before && !state.loading, 'EXBMP chart');
    await player.setOption(['Play options'], 'Auto play', true);
    await player.key('Enter');
    await player.waitFor((state) => state.scene.kind === 'play', 'EXBMP play');
    for (const phase of ['keyed', 'alpha', 'disabled', 'base'] as const) {
      await expect.poll(() => correctPixels(player, phase), { timeout: 15_000, intervals: [100] }).toBe(true);
      await player.page.screenshot({ path: info.outputPath(`${phase}.png`) });
    }
  });
}
