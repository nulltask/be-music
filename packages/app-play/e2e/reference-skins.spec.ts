import { expect, openWithLibrary, SONGS, test } from './support.ts';

// Local third-party distributions stay external. Supply a JSON array of { name, family, path } to opt in.
const references: readonly {
  name: string;
  family: 'lr2' | 'beatoraja';
  path: string;
  selectFamily?: 'built-in' | 'lr2' | 'beatoraja';
  resultFamily?: 'built-in' | 'lr2' | 'beatoraja' | 'none';
  cover?: { lift: number; sudden: number; hidden?: number; enabled?: boolean };
  variants?: ('5' | '7' | '9' | '10' | '14' | '24' | '48')[];
}[] = JSON.parse(process.env.BE_MUSIC_REFERENCE_SKINS ?? '[]');
for (const reference of references) {
  for (const variant of reference.variants ?? ['7']) {
    test(`reference skin: ${reference.name} ${variant} keys`, async ({ player }, info) => {
      test.setTimeout(180_000);
      await player.page.setViewportSize({ width: 1280, height: 720 });
      await openWithLibrary(player);
      await player.setOption(['Play options'], 'Auto play', true);
      await player.browseTo(SONGS, 'Fixture A');
      if (reference.cover) {
        await player.setOption(['Play options'], 'LIFT height 1P', reference.cover.lift);
        await player.setOption(['Play options'], 'LIFT 1P (beatoraja)', reference.cover.enabled ?? true);
        await player.setOption(['Play options'], 'Effect 1P', reference.cover.hidden ? 'HID+SUD' : 'SUDDEN');
        await player.setOption(['Play options'], 'Lane cover', true);
        await player.setOption(['Play options'], 'Cover height', reference.cover.sudden);
      }
      const title = `Reference ${variant} keys`;
      const modes = {
        '5': ['beat-5k', 6],
        '7': ['beat-7k', 8],
        '9': ['popn-9k', 9],
        '10': ['beat-10k', 12],
        '14': ['beat-14k', 16],
        '24': ['keyboard-24k', 26],
        '48': ['keyboard-24k-double', 52],
      } as const;
      const [mode, lanes] = modes[variant];
      const xs =
        variant === '5'
          ? [1, 2, 3, 4, 5, 8]
          : variant === '10'
            ? [1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 16]
            : Array.from({ length: lanes }, (_, lane) => lane + 1);
      await player.dropText(
        `reference-${variant}.bmson`,
        JSON.stringify({
          version: '1.0.0',
          info: { title, artist: 'Reference skin verification', init_bpm: 120, resolution: 240, mode_hint: mode },
          lines: [{ y: 0 }, { y: 960 }, { y: 1920 }],
          sound_channels: [
            {
              name: '',
              notes: xs.map((x) => [480, 960, 1440, 1920].map((y) => ({ x, y, l: 0, c: false }))).flat(),
            },
          ],
        }),
      );
      await player.cursorTo((bar) => bar.title === title, 'reference chart');
      await player.page.locator('#songs').setInputFiles(reference.path);
      await player.page.waitForFunction(
        () =>
          document.querySelector<HTMLDialogElement>('#skin-switch')?.open ||
          (window.__beMusicTest?.state().scene.family !== 'built-in' && !window.__beMusicTest?.state().loading),
      );
      const confirmation = player.page.locator('#skin-switch[open]');
      if (await confirmation.count()) await confirmation.locator(`[data-skin-family="${reference.family}"]`).click();
      await player.waitFor(
        (state) =>
          !state.loading &&
          state.scene.kind === 'select' &&
          state.scene.family === (reference.selectFamily ?? reference.family),
        'reference select skin',
        90_000,
      );
      const skinConfig = player.page.locator('[data-pane="skin-config"][open]');
      if (await skinConfig.count()) await skinConfig.locator('summary').first().click();
      await player.page.waitForTimeout(1800);
      await player.page.screenshot({ path: info.outputPath('select.png') });
      await player.key('Enter');
      await player.keyWhen(
        (state) => state.scene.kind === 'play' && (state.play?.seconds ?? -1) >= 2,
        undefined,
        'Pause',
        'reference gameplay',
        90_000,
      );
      const playing = await player.state();
      expect(playing.scene.family).toBe(reference.family);
      expect(playing.play?.title).toBe(title);
      if (reference.cover) {
        await player.setOption(['Play options'], 'Cover height', Math.min(1, reference.cover.sudden + 0.01));
        await player.setOption(['Play options'], 'Cover height', reference.cover.sudden);
      }
      await player.key('Pause');
      if (await skinConfig.count()) await skinConfig.locator('summary').first().click();
      await player.page.screenshot({ path: info.outputPath('play.png') });
      if (reference.resultFamily === 'none') {
        // Some beatoraja bundles ship play/select only; their documented route returns directly to select.
        await player.waitFor(
          (state) => state.scene.kind === 'select' && state.replays === 1,
          'completed play without a result skin',
          90_000,
        );
        expect((await player.state()).results).toHaveLength(0);
        await player.page.screenshot({ path: info.outputPath('after-play.png') });
        return;
      }
      await player.waitForResult(0, 90_000);
      const result = (await player.state()).results[0]!;
      expect(result.family).toBe(reference.resultFamily ?? reference.family);
      expect(result.title).toBe(title);
      expect(result.judged.pgreat).toBe(lanes * 4);
      if (await skinConfig.count()) await skinConfig.locator('summary').first().click();
      await player.page.waitForTimeout(2200);
      await player.page.screenshot({ path: info.outputPath('result.png') });
    });
  }
}
