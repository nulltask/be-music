import { expect, test } from './support.ts';

test('Synesthesia keeps the judgment particle setting after a reload', async ({ player }) => {
  await player.open({ 'be-music.built-in-skin': 'synesthesia' });
  const folder = ['Skin & display', 'Skin settings'];
  await player.setOption(folder, 'Judgment particles', 'マシ');
  await player.setOption(folder, 'Judgment particles', 'マシマシ');
  const readDensity = () =>
    player.page.evaluate(
      () => JSON.parse(localStorage.getItem('be-music.skin-settings') ?? '{}').skins?.synesthesia?.judgmentParticles,
    );
  expect(await readDensity()).toBe('most');
  await player.page.reload();
  await player.waitFor((state) => state.scene.kind === 'select', 'the select screen');
  expect(await player.readOption(folder, 'Judgment particles')).toBe('マシマシ');
  await player.setOption(folder, 'Judgment particles', '通常');
  expect(await readDensity()).toBe('normal');
});
