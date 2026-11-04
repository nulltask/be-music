import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './support.ts';

for (const skin of ['plain', 'native', 'synesthesia']) {
  test(`${skin} keeps cabinet keys filled while held`, async ({ player }, info) => {
    const capture = process.env.BE_MUSIC_LAYOUT_CAPTURE;
    if (capture) await mkdir(capture, { recursive: true });
    await player.page.setViewportSize({ width: 1280, height: 720 });
    await player.open({ 'be-music.built-in-skin': skin, 'be-music.skin-effects': 'off' });
    await player.dropText('keys.bme', '#PLAYER 1\n#TITLE Cabinet input\n#BPM 120\n#00811:01\n#00819:01\n');
    await player.cursorTo((bar) => bar.title === 'Cabinet input', 'input chart');
    if (skin === 'native')
      await player.page
        .locator('[data-be-music-screen="select"]')
        .getByRole('button', { name: 'Play', exact: true })
        .click();
    else await player.key('Enter');
    await player.waitFor((state) => state.scene.kind === 'play' && (state.play?.seconds ?? -1) >= 1, 'manual play');
    await player.page.evaluate(() => {
      for (const [code, key] of [
        ['KeyZ', 'z'],
        ['KeyS', 's'],
      ])
        window.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true }));
    });
    if (skin === 'native') {
      const strip = await player.page.locator('be-music-gameplay-hud [part="keys"]').boundingBox();
      const panel = player.page.locator('be-music-gameplay-hud be-music-gauge-panel').first();
      const meter = await panel.locator('meter').boundingBox();
      for (const caption of ['.name', '.value']) {
        const box = (await panel.locator(caption).boundingBox())!;
        expect(Math.abs(box.y + box.height / 2 - (strip!.y + strip!.height + meter!.y) / 2)).toBeLessThan(1);
      }
      const keys = player.page.locator('be-music-gameplay-hud .key[data-active]');
      await expect(keys).toHaveCount(2);
      const scratch = player.page.locator('be-music-gameplay-hud .key[data-kind="scratch"]').first();
      const angle = await scratch.evaluate((element) =>
        (element as HTMLElement).style.getPropertyValue('--scratch-angle'),
      );
      await expect
        .poll(() => scratch.evaluate((element) => (element as HTMLElement).style.getPropertyValue('--scratch-angle')))
        .not.toBe(angle);
    }
    await player.page.waitForTimeout(250);
    await player.page.screenshot({
      path: capture ? join(capture, `${skin}-keys-held.png`) : info.outputPath('keys-held.png'),
    });
    await player.page.evaluate(() => {
      for (const [code, key] of [
        ['KeyZ', 'z'],
        ['KeyS', 's'],
      ])
        window.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true }));
    });
    if (skin === 'native') await expect(player.page.locator('be-music-gameplay-hud .key[data-active]')).toHaveCount(0);
  });
}
