import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Player } from './support.ts';

async function cropColors(player: Player): Promise<string[]> {
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
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    // A fading blue canvas can blend over a skin's gray background. Its chromatic direction remains blue;
    // find the largest connected blue region so unrelated blue HUD text cannot change the crop coordinates.
    const mask = new Uint8Array(canvas.width * canvas.height);
    for (let at = 0; at < mask.length; at++) {
      const r = data[at * 4]!,
        g = data[at * 4 + 1]!,
        b = data[at * 4 + 2]!;
      if (b - r > 30 && Math.abs((g - r) / (b - r) - 58 / 206) < 0.04) mask[at] = 1;
    }
    const queue = new Int32Array(mask.length);
    let box = [Infinity, Infinity, -1, -1],
      largest = 0;
    for (let seed = 0; seed < mask.length; seed++) {
      if (!mask[seed]) continue;
      let head = 0,
        tail = 1;
      queue[0] = seed;
      mask[seed] = 0;
      const current = [Infinity, Infinity, -1, -1];
      while (head < tail) {
        const at = queue[head++]!,
          x = at % canvas.width,
          y = Math.floor(at / canvas.width);
        current[0] = Math.min(current[0]!, x);
        current[1] = Math.min(current[1]!, y);
        current[2] = Math.max(current[2]!, x);
        current[3] = Math.max(current[3]!, y);
        for (const next of [
          x > 0 ? at - 1 : -1,
          x + 1 < canvas.width ? at + 1 : -1,
          at - canvas.width,
          at + canvas.width,
        ]) {
          if (next >= 0 && next < mask.length && mask[next]) {
            mask[next] = 0;
            queue[tail++] = next;
          }
        }
      }
      if (tail > largest) {
        largest = tail;
        box = current;
      }
    }
    if (box[2]! < 0) return [];
    return [64, 160].map((x) => {
      const sx = Math.floor(box[0]! + (x / 256) * (box[2]! - box[0]! + 1));
      const sy = Math.floor(box[1]! + 0.5 * (box[3]! - box[1]! + 1));
      const at = (sy * canvas.width + sx) * 4;
      // Remove the blue-canvas contribution. This still distinguishes moving red/green pixels while the
      // outgoing stack fades toward black and the incoming stack has a different crossfade weight.
      const red = data[at]! - (data[at + 2]! * 21) / 227;
      const green = data[at + 1]! - (data[at + 2]! * 79) / 227;
      if (red > 12 && red > green * 2) return 'red';
      if (green > 12 && green > red * 2) return 'green';
      return 'other';
    });
  }, screenshot.toString('base64'));
}

for (const family of ['native', 'canvas', 'lr2', 'beatoraja'] as const) {
  test(`${family} advances both NONSTOP videos before and after the stage boundary`, async ({ player }, info) => {
    await player.open({ 'be-music.built-in-skin': family === 'native' ? 'native' : 'plain' });
    if (family === 'lr2' || family === 'beatoraja') await player.drop(`skins/${family}`);
    const a = [
      '#TITLE Outgoing video',
      '#BPM 120',
      '#BMP01 sheet.webm',
      '#BMP05 base.png',
      '#BGA02 04 16 32 80 160 32 64',
      '#BGA04 01 256 0 384 128 16 32',
      '#00004:05',
      '#00207:0002',
      '#00111:01',
      '#00419:01',
      '',
    ].join('\n');
    const b = [
      '#TITLE Incoming video',
      '#BPM 120',
      '#BMP01 sheet.webm',
      '#BGA03 01 320 0 384 128 128 64',
      '#00007:03',
      '#00211:01',
      '#00819:01',
      '',
    ].join('\n');
    const video = (await readFile('test/fixtures/bga-crop-colors.webm')).toString('base64');
    const before = (await player.state()).loads;
    await player.page.evaluate(
      async ({ a, b, video }) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 256;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#154fe3';
        context.fillRect(0, 0, 256, 256);
        const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
        const files = [
          new File([blob], 'base.png'),
          new File([Uint8Array.from(atob(video), (c) => c.charCodeAt(0))], 'sheet.webm'),
          new File([a], 'outgoing.bms'),
          new File([b], 'incoming.bms'),
        ];
        for (const file of files) Object.defineProperty(file, 'webkitRelativePath', { value: file.name });
        const event = new Event('drop', { cancelable: true });
        Object.defineProperty(event, 'dataTransfer', { value: { items: [], files, types: ['Files'] } });
        window.dispatchEvent(event);
      },
      { a, b, video },
    );
    await player.waitFor((state) => state.loads > before && !state.loading, 'video course stages');
    const hashes = [a, b].map((text) => createHash('md5').update(text).digest('hex')).join('');
    await player.dropText(
      'Videos.lr2crs',
      `<courselist><course><title>Video NONSTOP</title><line>7</line><type>1</type><hash>${'0'.repeat(32)}${hashes}</hash></course></courselist>`,
    );
    await player.openFolder('Videos');
    await player.setOption(['Play options'], 'Auto play', true);
    await player.key('Enter');
    await player.waitFor(
      (state) => state.scene.kind === 'play' && state.play?.title === 'Video NONSTOP',
      'video NONSTOP play',
    );
    for (const [name, colors] of [
      ['both-red', ['red', 'red']],
      ['incoming-green', ['red', 'green']],
      ['outgoing-green', ['green', 'green']],
    ] as const) {
      await expect.poll(() => cropColors(player), { timeout: 15_000, intervals: [100] }).toEqual(colors);
      await player.page.screenshot({ path: info.outputPath(`${name}.png`) });
    }
  });
}
