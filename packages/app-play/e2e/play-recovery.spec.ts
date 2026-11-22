import { expect, openWithLibrary, SONGS, smokeGroup, test } from './support.ts';

test(
  'a malformed chart returns to the existing library and a valid chart still plays',
  smokeGroup(2),
  async ({ player }) => {
    await openWithLibrary(player);
    await player.browseTo(SONGS, 'Fixture A');
    const count = (await player.state()).library.charts;
    const dropped = await player.dropText('broken.bmson', '{"version":"1.0.0",');
    expect(dropped.library.charts).toBe(count);
    expect(dropped.status).toBe(`${count} charts loaded, 1 errors`);
    expect(dropped.loading).toBe(false);

    const restored = await player.waitFor((state) => state.scene.kind === 'select', 'select after a bad chart');
    expect(restored.cursor?.bar?.title).toBe('Fixture A');
    await player.key('Enter');
    await player.waitFor(
      (state) => state.scene.kind === 'play' && state.play?.title === 'Fixture A' && (state.play.seconds ?? 0) > 0,
      'the original chart to play',
      20_000,
    );
  },
);

test(
  'a play audio setup failure restores select and lets the same chart be retried',
  smokeGroup(2),
  async ({ player }) => {
    await openWithLibrary(player, { 'be-music.built-in-skin': 'native' });
    await player.browseTo(SONGS, 'Fixture A');
    const { page } = player;
    await page.evaluate(() => {
      const Original = window.AudioContext;
      window.AudioContext = class extends Original {
        constructor(options?: AudioContextOptions) {
          if (options?.latencyHint === 'interactive') throw new Error('Audio output unavailable');
          super(options);
        }
      };
      window.addEventListener(
        'test-restore-audio',
        () => {
          window.AudioContext = Original;
        },
        { once: true },
      );
    });
    await player.key('Enter');
    const restored = await player.waitFor(
      (state) => state.scene.kind === 'select' && state.status.includes('Audio output unavailable'),
      'select with the audio setup error',
      12_000,
    );
    expect(restored.cursor?.bar?.title).toBe('Fixture A');
    expect(restored.loading).toBe(false);
    expect(restored.results).toHaveLength(0);
    await expect(page.locator('[data-be-music-screen="gameplay"]')).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event('test-restore-audio')));
    await player.key('Enter');
    await player.waitFor(
      (state) => state.scene.kind === 'play' && state.play?.title === 'Fixture A' && (state.play.seconds ?? 0) > 0,
      'the same chart to start after audio is restored',
      20_000,
    );
  },
);

test(
  'the same keyboard flow starts and exits a chart across built-in, LR2 and beatoraja skins',
  smokeGroup(3),
  async ({ player }) => {
    await openWithLibrary(player, { 'be-music.built-in-skin': 'plain' });
    await player.browseTo(SONGS, 'Fixture A');
    for (const family of ['built-in', 'lr2', 'beatoraja'] as const) {
      if (family !== 'built-in') await player.drop(`skins/${family}`);
      const select = await player.waitFor(
        (state) => state.scene.kind === 'select' && state.scene.family === family,
        `${family} select`,
        20_000,
      );
      expect(select.cursor?.bar?.title).toBe('Fixture A');
      await player.key('Enter');
      await player.waitFor(
        (state) =>
          state.scene.kind === 'play' &&
          state.scene.family === family &&
          state.play?.title === 'Fixture A' &&
          (state.play.seconds ?? 0) > 0,
        `${family} play`,
        20_000,
      );
      await player.key('Escape');
      const back = await player.waitFor(
        (state) => state.scene.kind === 'select' && state.scene.family === family,
        `back to ${family} select`,
        20_000,
      );
      expect(back.cursor?.bar?.title).toBe('Fixture A');
    }
  },
);
