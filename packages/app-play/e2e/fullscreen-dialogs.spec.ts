import { expect, test } from './support.ts';

test('fullscreen exposes Help, Settings and Exit; dialogs own their temporary pause', async ({ player }, info) => {
  await player.open({ 'be-music.built-in-skin': 'synesthesia' });
  await player.dropText('long.bme', '#TITLE Dialog pause\n#BPM 120\n#02011:01\n');
  await player.key('Enter');
  await player.waitFor((state) => state.scene.kind === 'play' && (state.play?.seconds ?? -1) >= 1, 'play');
  await player.page.evaluate(() => document.querySelector<HTMLElement>('#main')!.requestFullscreen());
  const toolbar = player.page.locator('.fullscreen-actions');
  await expect(toolbar).toBeVisible();
  expect(await toolbar.locator('button').evaluateAll((buttons) => buttons.map((button) => button.id))).toEqual([
    'help-open',
    'options-open',
    'fullscreen-exit',
  ]);
  for (const [button, dialog] of [
    ['#help-open', '#help-modal'],
    ['#options-open', '#options-modal'],
  ] as const) {
    await player.page.locator(button).click();
    await expect(player.page.locator(`${dialog}[open] > div`)).toBeVisible();
    const seconds = (await player.state()).play!.seconds!;
    await player.page.waitForTimeout(350);
    expect((await player.state()).play!.seconds).toBeCloseTo(seconds, 2);
    await player.page.screenshot({ path: info.outputPath(`${button.slice(1)}.png`) });
    await player.page.evaluate((selector) => document.querySelector<HTMLDialogElement>(selector)!.close(), dialog);
    await expect.poll(async () => (await player.state()).play!.seconds).toBeGreaterThan(seconds + 0.15);
  }
  await player.page.locator('#fullscreen-exit').click();
  await expect.poll(() => player.page.evaluate(() => document.fullscreenElement === null)).toBe(true);
});
