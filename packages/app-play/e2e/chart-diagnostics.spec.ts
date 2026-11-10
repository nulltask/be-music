import { expect, test } from './support.ts';

test('chart warnings are available on select and decide and leave with the screen', async ({ player }) => {
  await player.open();
  await player.dropText(
    'warnings.bms',
    '#TITLE Chart with warnings\n#BPM 120\n#OPTION vendor:unsupported\n#WAV01 absent.wav\n#00111:01\n',
  );
  const warnings = player.page.locator('#chart-diagnostics');
  const summary = warnings.locator('summary');
  await expect(summary).toHaveText('Chart warnings (1)');
  await summary.press('Enter');
  await expect(warnings.getByText('Unsupported chart option "vendor:unsupported".')).toBeVisible();
  expect((await player.state()).scene.kind).toBe('select');

  await player.key('Enter');
  await player.waitFor((state) => state.scene.kind === 'decide', 'decide screen');
  await expect(summary).toHaveText('Chart warnings (1)');
  await player.waitFor((state) => state.scene.kind === 'play', 'play screen');
  await expect(summary).toHaveCount(0);
});
