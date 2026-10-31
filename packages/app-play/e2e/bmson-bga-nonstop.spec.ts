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
  test(`${family} uses stage-owned bmson PLAY sequences and clears them across a NONSTOP boundary`, async ({
    player,
  }, info) => {
    await player.open({ 'be-music.built-in-skin': family === 'native' ? 'native' : 'plain' });
    if (family === 'lr2' || family === 'beatoraja') await player.drop(`skins/${family}`);
    const stage = (title: string) =>
      JSON.stringify({
        version: '1.0.0',
        info: { title, init_bpm: 120, resolution: 240, mode_hint: 'beat-7k' },
        sound_channels: [
          {
            name: 'note.wav',
            notes: [
              { x: 1, y: 1920 },
              { x: 7, y: 3840 },
            ],
          },
        ],
        bga: {
          bga_header: [
            { id: 20, name: 'base.png' },
            { id: 30, name: 'stripe.png' },
          ],
          bga_sequence: [{ id: 10, sequence: [{ time: 0, id: 1 }, { time: 3000 }] }],
          bga_events: [{ y: 0, id: 20 }],
          layer_events: [{ y: 0, id: 10, condition: 'play' }],
        },
      });
    const a = stage('Red sequence stage'),
      b = stage('Green sequence stage');
    const before = (await player.state()).loads;
    await player.page.evaluate(
      async ({ a, b }) => {
        const files: File[] = [];
        for (const [folder, text, color] of [
          ['a', a, '#ed174b'],
          ['b', b, '#16cf63'],
        ] as const) {
          for (const name of ['base.png', 'stripe.png']) {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 256;
            const context = canvas.getContext('2d')!;
            context.fillStyle = name === 'base.png' ? '#154fe3' : color;
            if (name === 'base.png') context.fillRect(0, 0, 256, 256);
            else context.fillRect(64, 0, 64, 256);
            const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
            const file = new File([blob], name);
            Object.defineProperty(file, 'webkitRelativePath', { value: `${folder}/${name}` });
            files.push(file);
          }
          const file = new File([text], 'chart.bmson');
          Object.defineProperty(file, 'webkitRelativePath', { value: `${folder}/chart.bmson` });
          files.push(file);
        }
        const event = new Event('drop', { cancelable: true });
        Object.defineProperty(event, 'dataTransfer', { value: { items: [], files, types: ['Files'] } });
        window.dispatchEvent(event);
      },
      { a, b },
    );
    await player.waitFor((state) => state.loads > before && !state.loading, 'bmson stage charts');
    const hashes = [a, b].map((text) => createHash('md5').update(text).digest('hex')).join('');
    await player.dropText(
      'Sequences.lr2crs',
      `<courselist><course><title>Sequence NONSTOP</title><line>7</line><type>1</type><hash>${'0'.repeat(32)}${hashes}</hash></course></courselist>`,
    );
    await player.openFolder('Sequences');
    await player.setOption(['Play options'], 'Auto play', false);
    await player.setOption(['Play options'], 'Gauge', 'GROOVE');
    await player.key('Enter');
    await player.waitFor(
      (state) =>
        state.scene.kind === 'play' && state.play?.title === 'Sequence NONSTOP' && (state.play.seconds ?? 0) > 0.2,
      'sequence NONSTOP play',
    );
    await expect.poll(() => colors(player)).toEqual(['blue', 'blue']);
    // The sequence follows the chart clock, so it is sampled paused inside its window (#878).
    const sample = (expected: string[]) =>
      expect.poll(() => colors(player), { timeout: 5000, intervals: [100] }).toEqual(expected);
    let pressed = await player.pressPaused('KeyZ', 3.98);
    await player.releaseKey('KeyZ');
    await sample(['red', 'blue']);
    await player.page.screenshot({ path: info.outputPath('first-sequence.png') });
    await player.resumeUntil(pressed + 3.5, 'end of the first stage sequence');
    await sample(['blue', 'blue']);
    await player.key('Space');
    pressed = await player.pressPaused('KeyZ', 8.02);
    await player.releaseKey('KeyZ');
    await sample(['green', 'blue']);
    await player.page.screenshot({ path: info.outputPath('second-sequence.png') });
    await player.resumeUntil(pressed + 3.5, 'end of the second stage sequence');
    await sample(['blue', 'blue']);
  });
}
