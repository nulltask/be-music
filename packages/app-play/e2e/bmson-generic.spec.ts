import { expect, test, type Player } from './support.ts';

async function notePixels(player: Player): Promise<number> {
  const nativeNotes = player.page.locator('be-music-notes canvas');
  const native = (await nativeNotes.count()) > 0;
  const canvas = native ? nativeNotes : player.page.locator('#stage canvas');
  return player.page.evaluate(
    async ({ base64, native }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let y = Math.floor(image.height * (native ? 0 : 0.1)); y < image.height * (native ? 1 : 0.62); y++)
        for (let x = 0; x < image.width * (native ? 1 : 0.4); x++) {
          const offset = (y * image.width + x) * 4;
          if (
            native
              ? pixels[offset]! >= 228 && pixels[offset + 1]! >= 238 && pixels[offset + 2]! >= 254
              : pixels[offset]! > 230 && pixels[offset + 1]! > 230 && pixels[offset + 2]! > 230
          )
            count++;
        }
      return count;
    },
    { base64: (await canvas.screenshot()).toString('base64'), native },
  );
}

for (const family of ['native', 'canvas', 'lr2', 'beatoraja'] as const) {
  for (const count of [8, 36, 70]) {
    test(`${family} plays generic ${count} keys without scratch or FREE ZONE reinterpretation`, async ({
      player,
    }, info) => {
      await player.open({ 'be-music.built-in-skin': family === 'native' ? 'native' : 'plain' });
      if (family === 'lr2' || family === 'beatoraja') await player.drop(`skins/${family}`);
      const title = `Generic ${count} keys`;
      await player.dropText(
        'generic.bmson',
        JSON.stringify({
          version: '1.0.0',
          info: { title, init_bpm: 120, mode_hint: `generic-${count}keys` },
          sound_channels: [
            {
              name: 'note.wav',
              notes: [
                { x: 6, y: 960 },
                { x: 7, y: 1440 },
                { x: count, y: 1920 },
                ...(count === 70
                  ? [
                      { x: 47, y: 2400 },
                      { x: 51, y: 2880 },
                    ]
                  : []),
              ],
            },
          ],
        }),
      );
      await player.setOption(['Play options'], 'Auto play', false);
      await player.key('Enter');
      await player.waitFor(
        (state) => state.scene.kind === 'play' && state.play?.title === title && (state.play.seconds ?? 0) > 0.2,
        'generic play',
      );
      const baseline = await notePixels(player);
      await player.waitFor((state) => (state.play?.seconds ?? 0) >= 1.3, 'visible generic note');
      await expect.poll(() => notePixels(player), { timeout: 1000, intervals: [50] }).toBeGreaterThan(baseline + 5);
      await player.page.screenshot({ path: info.outputPath('generic-notes.png') });
      await player.keyWhen((state) => (state.play?.seconds ?? 0) >= 1.98, undefined, 'KeyH', 'generic key 6');
      await player.keyWhen((state) => (state.play?.seconds ?? 0) >= 2.98, undefined, 'KeyJ', 'generic key 7');
      await player.keyWhen(
        (state) => (state.play?.seconds ?? 0) >= 3.98,
        undefined,
        count === 8 ? 'KeyK' : count === 36 ? 'Digit8' : 'F24',
        'last generic key',
      );
      if (count === 70)
        await player.keyWhen(
          (state) => (state.play?.seconds ?? 0) >= 4.98,
          undefined,
          'F1',
          'bound function key before host shortcuts',
        );
      if (count === 70)
        await player.keyWhen(
          (state) => (state.play?.seconds ?? 0) >= 5.98,
          undefined,
          'F5',
          'bound F5 instead of restart',
        );
      const result = await player.waitForResult(0);
      // Every bound key hits its note; a slow CI frame can land a page-timed press in GOOD (#792).
      const judged = result.results[0]!.judged;
      expect(judged.pgreat + judged.great + judged.good).toBe(count === 70 ? 5 : 3);
      expect(result.results[0]!.judged.poor).toBe(0);
      const replay = await player.lastReplay();
      expect(replay?.chart.laneMode).toBe(`${count} KEY GENERIC`);
      expect(new Set(replay!.inputs.flatMap((input) => input.channels))).toEqual(
        new Set(['16', '17', count === 8 ? '18' : count === 36 ? '21' : '2Z', ...(count === 70 ? ['2C', '2G'] : [])]),
      );
      if (count === 70) {
        await player.leaveResult();
        await player.waitFor((state) => state.scene.kind === 'select', 'generic replay selection');
        await player.dropText('generic.bmplay.json', JSON.stringify(replay));
        await player.waitFor((state) => state.scene.kind === 'play' && state.play?.replay === true, 'generic replay');
        const reproduced = await player.waitForResult(1);
        expect(reproduced.results[1]!.judged).toEqual(result.results[0]!.judged);
      }
    });
  }
}
