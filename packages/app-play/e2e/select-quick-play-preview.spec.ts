import { join } from 'node:path';
import { expect, test } from './support.ts';

test('double clicking a quick option changes it twice without toggling fullscreen', async ({ player }) => {
  const { page } = player;
  await page.setViewportSize({ width: 1440, height: 900 });
  await player.open({ 'be-music.built-in-skin': 'synesthesia' });
  await player.dropText('quick-options.bme', '#TITLE Quick options\n#BPM 120\n#00111:01\n');
  const fullscreen = () => page.evaluate(() => document.fullscreenElement !== null);
  const arrangement = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('be-music.option-settings') ?? '{}').settings?.random1P);
  const replayDockGap = () =>
    page.locator('.replay-slots-card[data-below-stage]').evaluate((card) => {
      const stage = document.querySelector('#stage')!;
      return card.getBoundingClientRect().top - stage.getBoundingClientRect().bottom;
    });

  await expect.poll(replayDockGap).toBeGreaterThanOrEqual(0);
  await player.clickSkin(121, 455, 854, 480, 2);
  await expect.poll(arrangement).toBe('RANDOM');
  expect(await fullscreen()).toBe(false);

  await player.clickSkin(310, 60, 854, 480, 2);
  await expect.poll(fullscreen).toBe(true);
  await expect.poll(replayDockGap).toBeGreaterThanOrEqual(0);

  await player.clickSkin(25, 455, 854, 480, 2);
  await expect.poll(arrangement).toBe('OFF');
  expect(await fullscreen()).toBe(true);

  await player.clickSkin(310, 60, 854, 480, 2);
  await expect.poll(fullscreen).toBe(false);
});

test('cycles quick play options and opens the selected chart in the practice picker', async ({ player }, info) => {
  const { page } = player;
  const output = process.env.SELECT_PREVIEW_OUTPUT ?? info.outputDir;
  await page.setViewportSize({ width: 1440, height: 900 });
  await player.open({
    'be-music.built-in-skin': 'synesthesia',
    'be-music.skin-effects': 'full',
    'be-music.course-table-urls': '[]',
  });
  const before = (await player.state()).loads;
  await page.evaluate(() => {
    const wave = new Uint8Array(60);
    const header = new DataView(wave.buffer);
    wave.set(new TextEncoder().encode('RIFF'));
    header.setUint32(4, 52, true);
    wave.set(new TextEncoder().encode('WAVEfmt '), 8);
    header.setUint32(16, 16, true);
    header.setUint16(20, 1, true);
    header.setUint16(22, 1, true);
    header.setUint32(24, 8000, true);
    header.setUint32(28, 16000, true);
    header.setUint16(32, 2, true);
    header.setUint16(34, 16, true);
    wave.set(new TextEncoder().encode('data'), 36);
    header.setUint32(40, 16, true);
    const charts = [
      ['Afterimage', 'Signal Garden', 8, 165],
      ['Glass Horizon', 'Mina Vale', 5, 128],
      ['Orbit Breaker', 'Arc Station', 11, 180],
    ];
    const files = charts.map(
      ([title, artist, level, bpm], index) =>
        new File(
          [
            `#TITLE ${title}\n#ARTIST ${artist}\n#PLAYLEVEL ${level}\n#DIFFICULTY 3\n#BPM ${bpm}\n#WAV01 key.wav\n#00111:01010101\n#01213:0101\n#02418:01\n`,
          ],
          `preview-${index}.bme`,
        ),
    );
    files.push(new File([wave], 'key.wav'));
    const event = new Event('drop', { cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { items: [], files, types: ['Files'] } });
    window.dispatchEvent(event);
  });
  await player.waitFor((state) => state.loads > before && !state.loading, 'preview library');
  const state = await player.state();
  if (state.cursor?.bar?.kind === 'folder') {
    await player.openFolder(state.cursor.bar.title);
  }
  await player.cursorTo((bar) => bar.title === 'Afterimage', 'Afterimage');
  const option = (key: string) =>
    expect.poll(() =>
      page.evaluate(
        (name) => JSON.parse(localStorage.getItem('be-music.option-settings') ?? '{}').settings?.[name],
        key,
      ),
    );
  await player.clickSkin(121, 455, 854, 480);
  await option('random1P').toBe('MIRROR');
  await player.clickSkin(25, 455, 854, 480);
  await option('random1P').toBe('OFF');
  await player.clickSkin(121, 455, 854, 480);
  await player.clickSkin(139, 455, 854, 480);
  await option('random1P').toBe('OFF');

  await player.clickSkin(535, 455, 854, 480);
  await option('hiSpeed').toBe(2.1);
  await player.clickSkin(439, 455, 854, 480);
  await option('hiSpeed').toBe(2);
  await player.clickSkin(439, 455, 854, 480);
  await option('hiSpeed').toBe(1.9);
  await player.clickSkin(553, 455, 854, 480);
  await option('hiSpeed').toBe(2);

  await player.clickSkin(121, 455, 854, 480);
  await player.clickSkin(121, 455, 854, 480);
  await player.clickSkin(259, 455, 854, 480);
  await player.clickSkin(397, 455, 854, 480);
  await player.clickSkin(535, 455, 854, 480);
  await player.clickSkin(673, 455, 854, 480);
  await page.waitForTimeout(750);
  await page.screenshot({ path: join(output, 'select-quick-options.png') });

  await player.clickSkin(180, 321, 854, 480);
  const practice = page.locator('.practice-bars-dialog');
  await expect(practice.locator('#practice-bars-title')).toBeVisible();
  await expect(practice.locator('[data-dialog-shortcut="primary"]')).toBeEnabled();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(output, 'select-practice.png') });
  await practice.locator('[data-dialog-shortcut="cancel"]').click();
  await expect(practice.locator('#practice-bars-title')).toBeHidden();
  await player.clickSkin(180, 321, 854, 480);
  await practice.locator('[data-dialog-shortcut="primary"]').click();
  await player.waitFor((state) => state.scene.kind === 'play' && (state.play?.seconds ?? 0) > 0, 'practice to start');
  await player.key('Escape');
  const back = await player.waitFor((state) => state.scene.kind === 'select', 'return from practice');
  expect(back.results).toHaveLength(0);
});
