import { createHash } from 'node:crypto';
import { expect, test, type Player } from './support.ts';

async function hasIndependentBlend(player: Player): Promise<boolean> {
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
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const histogram = new Map<string, number>();
    for (let i = 0; i < pixels.length; i += 4) {
      const key = `${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`;
      histogram.set(key, (histogram.get(key) ?? 0) + 1);
    }
    const colors = [...histogram].filter(([, count]) => count > 100).map(([key]) => key.split(',').map(Number));
    // Red is outgoing at 128/255 opacity. The incoming blue canvas determines its fade weight a.
    // Green must use its own 64/255 opacity, rather than the flattened outgoing 128/255 value.
    return colors.some(([r, g, b]) => {
      if (
        r! < 48 ||
        r! > 102 ||
        Math.abs(g! - (51 + 28 * ((129 - r!) / 108))) > 3 ||
        Math.abs(b! - (151 + 76 * ((129 - r!) / 108))) > 3
      )
        return false;
      const a = (129 - r!) / 108;
      return colors.some(
        ([gr, gg, gb]) =>
          Math.abs(gr! - 21) <= 2 &&
          Math.abs(gg! - (79 + ((128 * 64) / 255) * a)) <= 3 &&
          Math.abs(gb! - (227 - ((128 * 64) / 255) * a)) <= 3,
      );
    });
  }, screenshot.toString('base64'));
}

for (const family of ['native', 'canvas', 'lr2', 'beatoraja'] as const) {
  test(`${family} keeps NONSTOP stage ARGB colors and shared alpha independent while crossfading`, async ({
    player,
  }, info) => {
    await player.open({ 'be-music.built-in-skin': family === 'native' ? 'native' : 'plain' });
    if (family === 'lr2' || family === 'beatoraja') await player.drop(`skins/${family}`);
    const a =
      '#TITLE Red ARGB stage\n#BPM 120\n#BMP01 base.png\n#BMP02 first.png\n#00004:01\n#00007:02\n#ARGB61 128,237,23,75\n#000A2:61\n#0010C:80\n#00111:01\n#00419:01\n';
    const b =
      '#TITLE Green ARGB stage\n#BPM 120\n#BMP01 base.png\n#BMP02 second.png\n#00004:01\n#00007:02\n#ARGB61 64,22,207,99\n#000A2:61\n#00211:01\n#00819:01\n';
    const before = (await player.state()).loads;
    await player.page.evaluate(
      async ({ a, b }) => {
        const files: File[] = [];
        for (const [name, color, x, width] of [
          ['base.png', '#154fe3', 0, 256],
          ['first.png', '#ffffff', 0, 85],
          ['second.png', '#ffffff', 85, 85],
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
        files.push(new File([a], 'red.bms'), new File([b], 'green.bms'));
        for (const file of files) Object.defineProperty(file, 'webkitRelativePath', { value: file.name });
        const event = new Event('drop', { cancelable: true });
        Object.defineProperty(event, 'dataTransfer', { value: { items: [], files, types: ['Files'] } });
        window.dispatchEvent(event);
      },
      { a, b },
    );
    await player.waitFor((state) => state.loads > before && !state.loading, 'opacity stage charts');
    const hashes = [a, b].map((text) => createHash('md5').update(text).digest('hex')).join('');
    await player.dropText(
      'ARGB.lr2crs',
      `<courselist><course><title>ARGB NONSTOP</title><line>7</line><type>1</type><hash>${'0'.repeat(32)}${hashes}</hash></course></courselist>`,
    );
    await player.openFolder('ARGB');
    await player.setOption(['Play options'], 'Auto play', true);
    await player.key('Enter');
    await player.waitFor(
      (state) => state.scene.kind === 'play' && state.play?.title === 'ARGB NONSTOP',
      'opacity NONSTOP play',
    );
    await expect.poll(() => hasIndependentBlend(player), { timeout: 18_000, intervals: [100] }).toBe(true);
    await player.page.screenshot({ path: info.outputPath('nonstop-bga-argb.png') });
  });
}
