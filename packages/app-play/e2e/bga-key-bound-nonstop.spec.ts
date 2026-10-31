import { createHash } from 'node:crypto';
import { expect, test, type Player } from './support.ts';

async function colors(player: Player): Promise<string[]> {
  return player.page.evaluate(
    async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const bounds = [Infinity, Infinity, -1, -1];
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
      if (bounds[2]! < 0) return [];
      return [96, 160].map((x) => {
        const sx = Math.floor(bounds[0]! + (x / 256) * (bounds[2]! - bounds[0]! + 1));
        const sy = Math.floor(bounds[1]! + 0.5 * (bounds[3]! - bounds[1]! + 1));
        const offset = (sy * canvas.width + sx) * 4;
        const pixel = [...data.subarray(offset, offset + 3)];
        for (const [name, color] of [
          ['blue', [21, 79, 227]],
          ['red', [237, 23, 75]],
          ['green', [22, 207, 99]],
        ] as const)
          if (color.every((value, channel) => Math.abs(pixel[channel]! - value) < 4)) return name;
        return 'other';
      });
    },
    (await player.page.screenshot()).toString('base64'),
  );
}

for (const family of ['native', 'canvas', 'lr2', 'beatoraja'] as const) {
  test(`${family} remaps SWBGA stage resources and requires fresh input after the NONSTOP boundary`, async ({
    player,
  }, info) => {
    await player.open({ 'be-music.built-in-skin': family === 'native' ? 'native' : 'plain' });
    if (family === 'lr2' || family === 'beatoraja') await player.drop(`skins/${family}`);
    const a =
      '#TITLE Red SWBGA stage\n#BPM 120\n#POORBGA 2\n#BMP05 base.png\n#BMP00 red.png\n#BGA02 00 64 0 128 256 128 0\n#SWBGA61 500:0:11:1:255,255,255,255 0002\n#000A5:61\n#00004:05\n#00111:01\n#00419:01\n';
    const b = a
      .replaceAll('Red', 'Green')
      .replace('red.png', 'green.png')
      .replace('#00111', '#00211')
      .replace('#00419', '#00819');
    const before = (await player.state()).loads;
    await player.page.evaluate(
      async ({ a, b }) => {
        const files: File[] = [];
        for (const [name, color] of [
          ['base.png', '#154fe3'],
          ['red.png', '#ed174b'],
          ['green.png', '#16cf63'],
        ] as const) {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 256;
          const context = canvas.getContext('2d')!;
          context.fillStyle = name === 'base.png' ? color : '#ffffff';
          context.fillRect(0, 0, 256, 256);
          if (name !== 'base.png') {
            context.fillStyle = color;
            context.fillRect(64, 0, 64, 256);
          }
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
    await player.waitFor((state) => state.loads > before && !state.loading, 'SWBGA stage charts');
    const hashes = [a, b].map((text) => createHash('md5').update(text).digest('hex')).join('');
    await player.dropText(
      'Switches.lr2crs',
      `<courselist><course><title>SWBGA NONSTOP</title><line>7</line><type>1</type><hash>${'0'.repeat(32)}${hashes}</hash></course></courselist>`,
    );
    await player.openFolder('Switches');
    await player.setOption(['Play options'], 'Auto play', false);
    await player.setOption(['Play options'], 'Gauge', 'GROOVE');
    await player.key('Enter');
    await player.waitFor(
      (state) =>
        state.scene.kind === 'play' && state.play?.title === 'SWBGA NONSTOP' && (state.play.seconds ?? 0) > 0.2,
      'SWBGA NONSTOP play',
    );
    await expect.poll(() => colors(player)).toEqual(['blue', 'blue']);
    // Sample each 500 ms frame paused at a known chart time; a running chart outpaces CI screenshots (#878).
    const sample = (expected: string[]) =>
      expect.poll(() => colors(player), { timeout: 5000, intervals: [100] }).toEqual(expected);
    let pressed = await player.pressPaused('KeyZ');
    await sample(['red', 'blue']);
    await player.resumeUntil(pressed + 0.6, 'aliased red frame');
    await sample(['blue', 'red']);
    await player.page.screenshot({ path: info.outputPath('first-stage.png') });
    // Still held across the boundary: the next stage's binding needs a fresh press.
    await player.resumeUntil(8.4, 'SWBGA stage boundary');
    await sample(['blue', 'blue']);
    await player.page.screenshot({ path: info.outputPath('held-at-boundary.png') });
    await player.releaseKey('KeyZ');
    await player.key('Space');
    pressed = await player.pressPaused('KeyZ');
    await sample(['green', 'blue']);
    await player.resumeUntil(pressed + 0.6, 'aliased green frame');
    await sample(['blue', 'green']);
    await player.page.screenshot({ path: info.outputPath('second-stage.png') });
    await player.releaseKey('KeyZ');
    await player.key('Space');
    await expect.poll(() => colors(player), { timeout: 3000 }).toEqual(['blue', 'blue']);
  });
}
