import { expect, SONGS, test } from './support.ts';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// Set this only when collecting the before/after review gallery; normal runs use Playwright's artifact directory.
const captureDirectory = process.env.BE_MUSIC_LAYOUT_CAPTURE;
for (const skin of ['plain', 'native', 'synesthesia']) {
  for (const portrait of [false, true]) {
    test(`${skin} ${portrait ? 'portrait' : 'landscape'} preserves the layout hierarchy`, async ({ player }, info) => {
      if (skin === 'plain' && !portrait) await player.page.emulateMedia({ reducedMotion: 'reduce' });
      if (captureDirectory) await mkdir(captureDirectory, { recursive: true });
      await player.page.setViewportSize(portrait ? { width: 390, height: 844 } : { width: 1280, height: 720 });
      const shot = (name: string) => {
        const file = `${skin}-${portrait ? 'portrait' : 'landscape'}-${name}.png`;
        return player.page.screenshot({
          path: captureDirectory ? join(captureDirectory, file) : info.outputPath(file),
        });
      };
      await player.open({
        'be-music.built-in-skin': skin,
        'be-music.skin-effects': skin === 'synesthesia' ? 'full' : 'off',
      });
      await expect(
        player.page.locator('.start-load-actions').getByRole('button', { name: 'Open folder', exact: true }),
      ).toBeVisible();
      await shot('empty');
      await player.drop('songs', { prefix: SONGS });
      await player.setOption(['Play options'], 'Auto play', true);
      await player.browseTo(SONGS, 'Fixture A');
      if (skin === 'synesthesia') await player.page.waitForTimeout(800); // Capture the settled intro, not its faded first frame.
      const select = player.page.locator('[data-be-music-screen="select"]');
      if (skin === 'native') {
        const play = select.getByRole('button', { name: 'Play', exact: true });
        await expect(play).toBeVisible();
        const box = await play.boundingBox();
        expect(box!.y + box!.height).toBeLessThanOrEqual(portrait ? 844 : 720);
        if (portrait) {
          await expect(select.locator('.select-filters')).not.toHaveAttribute('open', '');
          await select.locator('.select-filters > summary').click();
          await expect(select.getByRole('combobox', { name: 'Gauge', exact: true })).toBeVisible();
          await select.locator('.select-filters > summary').click();
        } else {
          const gauge = await select.getByRole('combobox', { name: 'Gauge', exact: true }).boundingBox();
          const difficulty = await select.getByRole('combobox', { name: 'Difficulty', exact: true }).boundingBox();
          expect(Math.abs(gauge!.y - difficulty!.y)).toBeLessThan(1);
        }
      }
      await shot('select');
      if (skin === 'native') await select.getByRole('button', { name: 'Auto play', exact: true }).click();
      else await player.key('Enter');
      if (skin === 'native') {
        await player.waitFor((s) => s.scene.kind === 'decide', 'decide screen');
        const content = await player.page.locator('be-music-decide-screen .center').boundingBox();
        expect(content!.width).toBeLessThanOrEqual(576);
        await shot('decide');
      }
      await player.keyWhen(
        (s) => s.scene.kind === 'play' && (s.play?.seconds ?? -1) >= 2,
        undefined,
        'Pause',
        'play screen',
      );
      if (skin === 'native' && portrait) {
        const hud = player.page.locator('be-music-gameplay-hud');
        const pause = await hud.getByRole('button', { name: 'Resume', exact: true }).boundingBox();
        const lanes = await player.page.locator('be-music-lanes').boundingBox();
        expect(pause!.height).toBeGreaterThanOrEqual(40);
        expect(pause!.y + pause!.height).toBeLessThanOrEqual(lanes!.y);
        await hud.locator('.play-menu > summary').click();
        await expect(hud.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
        await hud.locator('.play-menu > summary').click();
      }
      await player.key('Pause');
      const header = player.page.locator('#player-service-header');
      await expect(header).toHaveAttribute('inert', '');
      if (skin === 'plain' && !portrait) {
        expect(await header.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe('0s');
      }
      await expect
        .poll(async () => {
          const box = (await header.boundingBox())!;
          return box.y + box.height;
        })
        .toBeLessThanOrEqual(1);
      await shot('play');
      await player.waitForResult(0);
      await expect(header).not.toHaveAttribute('inert', '');
      await expect.poll(async () => (await header.boundingBox())!.y).toBeGreaterThanOrEqual(0);
      const slots = player.page.locator('.replay-slots-card');
      await expect(slots.locator('details')).toHaveAttribute('open', '');
      const panelBox = (await slots.boundingBox())!;
      const mainBox = (await player.page.locator('#main').boundingBox())!;
      expect(Math.abs(panelBox.y + panelBox.height - mainBox.y - mainBox.height)).toBeLessThanOrEqual(2);
      await expect(slots).toContainText('This play cannot be saved to a slot.');
      await expect(slots.locator('.replay-slots-row')).toHaveCount(0);
      await player.page.waitForTimeout(2400); // The result's rank settles after its entrance animation.
      await shot('result');
      await slots.locator('summary').click();
      await expect(slots.locator('details')).not.toHaveAttribute('open', '');
      expect((await slots.boundingBox())!.height).toBeLessThanOrEqual(56);
      await shot('result-collapsed');
      if (!portrait) {
        await player.leaveResult();
        await player.dropText(
          'layout-dp.bme',
          '#PLAYER 3\n#TITLE Layout Review DP\n#ARTIST Be-Music Dev Team\n#BPM 240\n' +
            ['11', '12', '13', '14', '15', '16', '18', '19', '21', '22', '23', '24', '25', '26', '28', '29']
              .map((c) => `#001${c}:0101`)
              .join('\n') +
            '\n#00411:01\n',
        );
        await player.cursorTo((b) => b.title === 'Layout Review DP', 'DP chart');
        if (skin === 'native') await select.getByRole('button', { name: 'Auto play', exact: true }).click();
        else await player.key('Enter');
        await player.keyWhen(
          (s) => s.scene.kind === 'play' && (s.play?.seconds ?? -1) >= 2,
          undefined,
          'Pause',
          'DP screen',
        );
        await player.key('Pause');
        await shot('dp');
      }
    });
  }
}
