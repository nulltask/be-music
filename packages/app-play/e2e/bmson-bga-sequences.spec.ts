import { readFile } from 'node:fs/promises';
import { expect, test, type Player } from './support.ts';

const boxes = new WeakMap<Player, number[]>();
async function colors(player: Player): Promise<string[]> {
  const result = await player.page.evaluate(
    async ({ base64, bounds }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const box = bounds ?? [Infinity, Infinity, -1, -1];
      if (!bounds)
        for (let y = 0; y < canvas.height; y++)
          for (let x = 0; x < canvas.width; x++) {
            const at = (y * canvas.width + x) * 4;
            // Software rendering can shift the blue base by a step, so find it with the same tolerance as the samples.
            if (
              Math.abs(data[at]! - 21) <= 4 &&
              Math.abs(data[at + 1]! - 79) <= 4 &&
              Math.abs(data[at + 2]! - 227) <= 4
            ) {
              box[0] = Math.min(box[0]!, x);
              box[1] = Math.min(box[1]!, y);
              box[2] = Math.max(box[2]!, x);
              box[3] = Math.max(box[3]!, y);
            }
          }
      if (box[2]! < 0) return { box, colors: [] };
      return {
        box,
        colors: [32, 96, 160, 224].map((column) => {
          const x = Math.floor(box[0]! + (column / 256) * (box[2]! - box[0]! + 1));
          const y = Math.floor(box[1]! + 0.5 * (box[3]! - box[1]! + 1));
          const at = (y * canvas.width + x) * 4;
          const [r, g, b] = [...data.subarray(at, at + 3)] as [number, number, number];
          if ([21, 79, 227].every((value, index) => Math.abs(value - data[at + index]!) <= 4)) return 'blue';
          if ([129, 51, 151].every((value, index) => Math.abs(value - data[at + index]!) <= 4)) return 'purple';
          if ([119, 12, 38].every((value, index) => Math.abs(value - data[at + index]!) <= 4)) return 'dark-red';
          if (r < 9 && g < 9 && b < 9) return 'black';
          if (r > 240 && g > 240 && b > 240) return 'white';
          if (r > 150 && r > g * 2 && r > b * 1.5) return 'red';
          if (g > 150 && g > r * 2 && g > b * 1.5) return 'green';
          return 'other';
        }),
      };
    },
    { base64: (await player.page.screenshot()).toString('base64'), bounds: boxes.get(player) },
  );
  if (result.colors.length) boxes.set(player, result.box);
  return result.colors;
}

async function dropChart(player: Player, movie?: string) {
  await player.page.evaluate(async (movie) => {
    const files: File[] = [];
    for (const [name, color] of [
      ['blue.png', '#154fe3'],
      ['half.png', 'rgba(237,23,75,0.5)'],
      ['green.png', '#16cf63'],
      ['black.png', '#000000'],
    ]) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const context = canvas.getContext('2d')!;
      context.fillStyle = color!;
      context.fillRect(0, 0, 256, 256);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
      files.push(new File([blob], name!));
    }
    if (movie) files.push(new File([Uint8Array.from(atob(movie), (value) => value.charCodeAt(0))], 'clip.webm'));
    const bga = movie
      ? {
          bga_header: [
            { id: 20, name: 'blue.png' },
            { id: 30, name: 'clip.webm' },
          ],
          bga_events: [{ y: 0, id: 20 }],
          bga_sequence: [{ id: 10, sequence: [{ time: 0, id: 1 }, { time: 3500 }] }],
          layer_events: [{ y: 960, id: 10, condition: 'always', interval: 5000 }],
        }
      : {
          bga_header: [
            { id: 20, name: 'blue.png' },
            { id: 30, name: 'half.png' },
            { id: 40, name: 'green.png' },
            { id: 50, name: 'black.png' },
          ],
          bga_events: [{ y: 0, id: 20 }],
          bga_sequence: [
            { id: 10, sequence: [{ time: 0, id: 1 }, { time: 700, id: 2 }, { time: 1400 }] },
            { id: 11, sequence: [{ time: 0, id: 3 }, { time: 700 }] },
          ],
          layer_events: [{ y: 0, id_set: [10, 11], condition: 'play', interval: 0 }],
          poor_events: [{ y: 3840, id: 10 }],
        };
    files.push(
      new File(
        [
          JSON.stringify({
            version: '1.0.0',
            info: { title: movie ? 'bmson movie sequence' : 'bmson image sequences', init_bpm: 120, judge_rank: 200 },
            sound_channels: [
              {
                name: '',
                notes: [
                  { x: 1, y: 1920 },
                  { x: 1, y: 2880 },
                  { x: 1, y: 5760 },
                  { x: 7, y: 9600 },
                ],
              },
            ],
            bga,
          }),
        ],
        'sequence.bmson',
      ),
    );
    for (const file of files) Object.defineProperty(file, 'webkitRelativePath', { value: file.name });
    const event = new Event('drop', { cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { items: [], files, types: ['Files'] } });
    window.dispatchEvent(event);
  }, movie);
}

for (const family of ['native', 'canvas', 'lr2', 'beatoraja'] as const) {
  test(`${family} renders judgment-driven bmson image sets, alpha, pause and sequence-backed MISS lifetimes`, async ({
    player,
  }, info) => {
    await player.open({ 'be-music.built-in-skin': family === 'native' ? 'native' : 'plain' });
    if (family === 'lr2' || family === 'beatoraja') await player.drop(`skins/${family}`);
    const before = (await player.state()).loads;
    await dropChart(player);
    await player.waitFor((state) => state.loads > before && !state.loading, 'bmson sequence chart');
    await player.setOption(['Play options'], 'Auto play', false);
    await player.key('Enter');
    await player.waitFor(
      (state) => state.scene.kind === 'play' && (state.play?.seconds ?? 0) > 0.2,
      'manual bmson sequence play',
    );
    await expect.poll(() => colors(player)).toEqual(['blue', 'blue', 'blue', 'blue']);
    // Sequences follow the chart clock, so each frame is sampled paused inside its window (#878).
    const sample = (expected: string) =>
      expect
        .poll(() => colors(player), { timeout: 5000, intervals: [100] })
        .toEqual([expected, expected, expected, expected]);
    let pressed = await player.pressPaused('KeyZ', 3.98);
    await player.releaseKey('KeyZ');
    await sample('purple');
    await player.page.screenshot({ path: info.outputPath('play-alpha.png') });
    await player.resumeUntil(pressed + 1.05, 'second frame of the first sequence');
    await sample('green');
    const paused = (await player.state()).play?.seconds;
    await player.page.waitForTimeout(250);
    expect((await player.state()).play?.seconds).toBeCloseTo(paused!, 2);
    await sample('green');
    await player.resumeUntil(pressed + 1.6, 'end of the first sequence');
    await sample('blue');
    await player.key('Space');
    pressed = await player.pressPaused('KeyZ', 5.98);
    await player.releaseKey('KeyZ');
    await sample('black');
    await player.resumeUntil(pressed + 1, 'end of the second sequence');
    await sample('blue');
    await player.key('Space');
    const missed = await player.keyWhen(
      (state) => (state.play?.judged?.poor ?? 0) >= 1,
      undefined,
      'Space',
      'sequence-backed MISS selection',
    );
    const missedAt = missed.play?.seconds ?? 0;
    await sample('dark-red');
    await player.resumeUntil(missedAt + 1.05, 'second frame of the MISS sequence');
    await sample('green');
    await player.page.screenshot({ path: info.outputPath('miss-second-frame.png') });
    await player.resumeUntil(missedAt + 1.6, 'end of the MISS sequence');
    await sample('blue');
  });

  test(`${family} plays and restarts ALWAYS bmson movie sequences while retaining unkeyed white and black`, async ({
    player,
  }, info) => {
    await player.open({ 'be-music.built-in-skin': family === 'native' ? 'native' : 'plain' });
    if (family === 'lr2' || family === 'beatoraja') await player.drop(`skins/${family}`);
    const before = (await player.state()).loads;
    await dropChart(player, (await readFile('test/fixtures/exbmp-video.webm')).toString('base64'));
    await player.waitFor((state) => state.loads > before && !state.loading, 'bmson movie sequence');
    await player.setOption(['Play options'], 'Auto play', true);
    await player.key('Enter');
    await player.waitFor(
      (state) => state.scene.kind === 'play' && (state.play?.seconds ?? 0) > 0.2,
      'bmson movie play',
    );
    await expect.poll(() => colors(player)).toEqual(['blue', 'blue', 'blue', 'blue']);
    for (const phase of ['red', 'green', 'blue', 'red'] as const) {
      const target = phase === 'blue' ? ['blue', 'blue', 'blue', 'blue'] : ['white', phase, 'black', 'white'];
      await expect.poll(() => colors(player), { timeout: 6000, intervals: [50] }).toEqual(target);
      await player.page.screenshot({
        path: info.outputPath(`movie-${phase}-${(await player.state()).play?.seconds}.png`),
      });
    }
  });
}

for (const family of ['native', 'canvas', 'lr2', 'beatoraja'] as const) {
  test(`${family} ends a short MISS layer without reviving an older POOR image`, async ({ player }, info) => {
    await player.open({ 'be-music.built-in-skin': family === 'native' ? 'native' : 'plain' });
    if (family === 'lr2' || family === 'beatoraja') await player.drop(`skins/${family}`);
    const before = (await player.state()).loads;
    await player.page.evaluate(async () => {
      const files: File[] = [];
      for (const [name, color] of [
        ['blue.png', '#154fe3'],
        ['half.png', 'rgba(237,23,75,0.5)'],
        ['old.png', '#000000'],
      ]) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 256;
        const context = canvas.getContext('2d')!;
        context.fillStyle = color!;
        context.fillRect(0, 0, 256, 256);
        const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
        files.push(new File([blob], name!));
      }
      files.push(
        new File(
          [
            JSON.stringify({
              version: '1.0.0',
              info: { title: 'Short MISS sequence', init_bpm: 120 },
              sound_channels: [
                {
                  name: '',
                  notes: [
                    { x: 1, y: 1440 },
                    { x: 7, y: 9600 },
                  ],
                },
              ],
              bga: {
                bga_header: [
                  { id: 20, name: 'blue.png' },
                  { id: 30, name: 'old.png' },
                  { id: 40, name: 'half.png' },
                ],
                bga_events: [{ y: 0, id: 20 }],
                poor_events: [{ y: 0, id: 30 }],
                bga_sequence: [{ id: 10, sequence: [{ time: 0, id: 2 }, { time: 200 }] }],
                layer_events: [{ y: 960, id: 10, condition: 'miss' }],
              },
            }),
          ],
          'short.bmson',
        ),
      );
      for (const file of files) Object.defineProperty(file, 'webkitRelativePath', { value: file.name });
      const event = new Event('drop', { cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { items: [], files, types: ['Files'] } });
      window.dispatchEvent(event);
    });
    await player.waitFor((state) => state.loads > before && !state.loading, 'short MISS chart');
    await player.setOption(['Play options'], 'Auto play', false);
    await player.key('Enter');
    await player.waitFor((state) => state.scene.kind === 'play' && (state.play?.seconds ?? 0) > 0.2, 'short MISS play');
    await expect.poll(() => colors(player)).toEqual(['blue', 'blue', 'blue', 'blue']);
    const missed = await player.keyWhen(
      (state) => (state.play?.judged?.poor ?? 0) >= 1,
      undefined,
      'Space',
      'first MISS frame',
    );
    await expect.poll(() => colors(player)).toEqual(['dark-red', 'dark-red', 'dark-red', 'dark-red']);
    const afterEnd = missed.play!.seconds! + 0.25;
    await player.key('Space');
    await player.keyWhen(
      (state, target) => (state.play?.seconds ?? 0) >= target,
      afterEnd,
      'Space',
      'past 200 ms end within the 500 ms miss window',
    );
    await expect.poll(() => colors(player)).toEqual(['blue', 'blue', 'blue', 'blue']);
    await player.page.screenshot({ path: info.outputPath('short-miss-ended.png') });
  });
}
