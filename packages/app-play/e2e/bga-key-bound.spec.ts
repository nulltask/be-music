import { readFile } from 'node:fs/promises';
import { expect, test, type Player } from './support.ts';

const bgaBounds = new WeakMap<Player, number[]>();

async function correctPixels(player: Player, phase: 'base' | 'first' | 'alias' | 'combined'): Promise<boolean> {
  const result = await player.page.evaluate(
    async ({ base64, phase, bounds }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      const box = bounds ?? [Infinity, Infinity, -1, -1];
      if (!bounds)
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
      if (box[2]! < 0) return { correct: false, box };
      const blue = [21, 79, 227],
        red = [237, 23, 75],
        black = [0, 0, 0],
        green = [22, 207, 99];
      const targets =
        phase === 'base'
          ? [blue, blue, blue, blue]
          : phase === 'first'
            ? [blue, red, black, green]
            : phase === 'alias'
              ? [blue, blue, red, blue]
              : [blue, blue, black, green];
      const correct = [32, 96, 160, 224].every((column, i) => {
        const x = Math.floor(box[0]! + (column / 256) * (box[2]! - box[0]! + 1));
        const y = Math.floor(box[1]! + 0.5 * (box[3]! - box[1]! + 1));
        const at = (y * canvas.width + x) * 4;
        return targets[i]!.every((value, c) => Math.abs(value - data[at + c]!) <= 3);
      });
      return { correct, box };
    },
    { bounds: bgaBounds.get(player), base64: (await player.page.screenshot()).toString('base64'), phase },
  );
  if (result.correct && phase === 'base') bgaBounds.set(player, result.box);
  return result.correct;
}

for (const family of ['native', 'canvas', 'lr2', 'beatoraja'] as const) {
  test(`${family} renders input-bound SWBGA frames, alias placement and timed/held lifetimes`, async ({
    player,
  }, info) => {
    await player.open({ 'be-music.built-in-skin': family === 'native' ? 'native' : 'plain' });
    if (family === 'lr2' || family === 'beatoraja') await player.drop(`skins/${family}`);
    const before = (await player.state()).loads;
    await player.page.evaluate(async () => {
      const files: File[] = [];
      for (const name of ['blue.png', 'strip.png']) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 256;
        const context = canvas.getContext('2d')!;
        context.fillStyle = name === 'blue.png' ? '#154fe3' : '#ffffff';
        context.fillRect(0, 0, 256, 256);
        if (name === 'strip.png')
          for (const [x, color] of [
            [64, '#ed174b'],
            [128, '#000000'],
            [192, '#16cf63'],
          ] as const) {
            context.fillStyle = color;
            context.fillRect(x, 0, 64, 256);
          }
        const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
        files.push(new File([blob], name));
      }
      files.push(
        new File(
          [
            [
              '#TITLE Input-bound SWBGA',
              '#BPM 120',
              '#POORBGA 2',
              '#BMP05 blue.png',
              '#BMP00 strip.png',
              '#BGA02 00 64 0 128 256 128 0',
              '#EXBMP03 255,237,23,75 strip.png',
              '#SWBGA61 500:0:11:1:255,255,255,255 000203',
              '#SWBGA62 250:1000:12:0:255,255,255,255 00',
              '#00004:05',
              '#000A5:61',
              '#004A5:62',
              '#01611:01',
              '#01619:01',
              '',
            ].join('\n'),
          ],
          'key-bound.bms',
        ),
      );
      for (const file of files) Object.defineProperty(file, 'webkitRelativePath', { value: file.name });
      const event = new Event('drop', { cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { items: [], files, types: ['Files'] } });
      window.dispatchEvent(event);
    });
    await player.waitFor((state) => state.loads > before && !state.loading, 'SWBGA chart');
    await player.setOption(['Play options'], 'Auto play', false);
    await player.key('Enter');
    await player.waitFor(
      (state) => state.scene.kind === 'play' && (state.play?.seconds ?? 0) > 0.2,
      'manual SWBGA play',
    );
    await expect.poll(() => correctPixels(player, 'base')).toBe(true);
    // SWBGA frames follow the chart clock, so pausing freezes them: sample each frame paused at a known chart time.
    // Sampling a running chart misses 500 ms frames on CI, where one screenshot takes about as long (#878).
    const sample = async (phase: 'base' | 'first' | 'alias' | 'combined') =>
      expect.poll(() => correctPixels(player, phase), { timeout: 5000, intervals: [100] }).toBe(true);

    // Held, the looped 500 ms frames advance first → alias → combined from the press.
    let pressed = await player.pressPaused('KeyZ');
    await sample('first');
    await player.page.screenshot({ path: info.outputPath('first.png') });
    await player.resumeUntil(pressed + 0.6, 'alias frame');
    await sample('alias');
    await player.page.screenshot({ path: info.outputPath('alias.png') });
    await player.resumeUntil(pressed + 1.1, 'combined frame');
    await sample('combined');
    await player.page.screenshot({ path: info.outputPath('combined.png') });
    await player.releaseKey('KeyZ');
    await player.key('Space');
    await expect.poll(() => correctPixels(player, 'base'), { timeout: 3000 }).toBe(true);
    // A fresh press starts again from the first frame.
    pressed = await player.pressPaused('KeyZ');
    await sample('first');
    await player.releaseKey('KeyZ');
    await player.key('Space');
    // The finite binding from measure 4 outlives its release, then expires 1 s after the press.
    await player.waitFor((state) => (state.play?.seconds ?? 0) > 8.2, 'finite SWBGA binding');
    pressed = await player.pressPaused('KeyS');
    await sample('first');
    await player.releaseKey('KeyS');
    await player.resumeUntil(pressed + 0.6, 'finite frame after release');
    await sample('first');
    await player.resumeUntil(pressed + 1.3, 'expired finite binding');
    await sample('base');
    await player.page.screenshot({ path: info.outputPath('expired.png') });
    await player.key('Space');
  });
}

for (const family of ['native', 'canvas', 'lr2', 'beatoraja'] as const) {
  // A standard SWBGA only animates through A5 input. One sharing its id with a cued BMP must not swap that plane, as
  // the former cue-driven helper did in the browser families.
  test(`${family} keeps a cued BMP when an unselected SWBGA shares its id`, async ({ player }) => {
    await player.open({ 'be-music.built-in-skin': family === 'native' ? 'native' : 'plain' });
    if (family === 'lr2' || family === 'beatoraja') await player.drop(`skins/${family}`);
    const before = (await player.state()).loads;
    await player.page.evaluate(async () => {
      const files: File[] = [];
      for (const name of ['blue.png', 'strip.png']) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 256;
        const context = canvas.getContext('2d')!;
        context.fillStyle = name === 'blue.png' ? '#154fe3' : '#ed174b';
        context.fillRect(0, 0, 256, 256);
        const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
        files.push(new File([blob], name));
      }
      files.push(
        new File(
          [
            [
              '#TITLE SWBGA id collision',
              '#BPM 120',
              '#POORBGA 2',
              '#BMP05 blue.png',
              '#BMP00 strip.png',
              '#SWBGA05 100:500:11:1:255,255,255,255 0000',
              '#00004:05',
              '#00411:01',
              '',
            ].join('\n'),
          ],
          'collision.bms',
        ),
      );
      for (const file of files) Object.defineProperty(file, 'webkitRelativePath', { value: file.name });
      const event = new Event('drop', { cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { items: [], files, types: ['Files'] } });
      window.dispatchEvent(event);
    });
    await player.waitFor((state) => state.loads > before && !state.loading, 'SWBGA collision chart');
    await player.key('Enter');
    await player.waitFor(
      (state) => state.scene.kind === 'play' && (state.play?.seconds ?? 0) > 0.2,
      'SWBGA collision play',
    );
    await expect.poll(() => correctPixels(player, 'base')).toBe(true);
    // The legacy path showed frame 00 (red) from 0.1 s after the cue; the base must stay blue.
    for (let sample = 0; sample < 6; sample++) {
      expect(await correctPixels(player, 'base')).toBe(true);
      await player.page.waitForTimeout(150);
    }
  });
}

for (const family of ['native', 'canvas', 'lr2', 'beatoraja'] as const) {
  test(`${family} updates keyed SWBGA video crops and restarts them on fresh input`, async ({ player }, info) => {
    await player.open({ 'be-music.built-in-skin': family === 'native' ? 'native' : 'plain' });
    if (family === 'lr2' || family === 'beatoraja') await player.drop(`skins/${family}`);
    const before = (await player.state()).loads;
    const video = (await readFile('test/fixtures/bga-bordered.webm')).toString('base64');
    await player.page.evaluate(async (video) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#154fe3';
      context.fillRect(0, 0, 256, 256);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
      const files = [
        new File([blob], 'blue.png'),
        new File([Uint8Array.from(atob(video), (c) => c.charCodeAt(0))], 'clip.webm'),
        new File(
          [
            [
              '#TITLE SWBGA video',
              '#BPM 120',
              '#POORBGA 2',
              '#BMP05 blue.png',
              '#BMP00 clip.webm',
              '#BGA02 00 0 0 32 32 96 96',
              '#SWBGA61 2000:0:11:0:255,0,0,0 0200',
              '#00004:05',
              '#000A5:61',
              '#01611:01',
              '#01619:01',
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
    await player.waitFor((state) => state.loads > before && !state.loading, 'SWBGA video chart');
    await player.setOption(['Play options'], 'Auto play', false);
    await player.key('Enter');
    await player.waitFor(
      (state) => state.scene.kind === 'play' && (state.play?.seconds ?? 0) > 0.2,
      'SWBGA video play',
    );
    await expect.poll(() => correctPixels(player, 'base')).toBe(true);
    const colors = async () =>
      player.page.evaluate(
        async ({ base64, bounds }) => {
          const image = new Image();
          image.src = `data:image/png;base64,${base64}`;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext('2d')!;
          context.drawImage(image, 0, 0);
          return [
            [98, 98],
            [112, 112],
            [160, 160],
          ].map(([x, y]) => {
            const sx = Math.floor(bounds[0]! + (x! / 256) * (bounds[2]! - bounds[0]! + 1));
            const sy = Math.floor(bounds[1]! + (y! / 256) * (bounds[3]! - bounds[1]! + 1));
            const [r, g, b] = context.getImageData(sx, sy, 1, 1).data;
            if (Math.abs(r! - 21) < 4 && Math.abs(g! - 79) < 4 && Math.abs(b! - 227) < 4) return 'blue';
            if (r! > 150 && r! > g! * 2 && r! > b! * 2) return 'red';
            if (g! > 150 && g! > r! * 2 && g! > b! * 1.5) return 'green';
            return 'other';
          });
        },
        { base64: (await player.page.screenshot()).toString('base64'), bounds: bgaBounds.get(player)! },
      );
    for (let attempt = 0; attempt < 2; attempt++) {
      await player.page.keyboard.down('z');
      try {
        await expect.poll(colors, { timeout: 3000, intervals: [25] }).toEqual(['blue', 'red', 'blue']);
        await expect.poll(colors, { timeout: 3000, intervals: [25] }).toEqual(['blue', 'green', 'blue']);
        await expect.poll(colors, { timeout: 4000, intervals: [25] }).toEqual(['green', 'green', 'green']);
        await player.page.screenshot({ path: info.outputPath(`video-${attempt}.png`) });
      } finally {
        await player.page.keyboard.up('z');
      }
      await expect.poll(colors, { timeout: 3000, intervals: [25] }).toEqual(['blue', 'blue', 'blue']);
    }
  });
}
