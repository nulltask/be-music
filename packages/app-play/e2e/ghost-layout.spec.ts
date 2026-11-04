import { expect, openWithLibrary, SONGS, test } from './support.ts';

for (const skin of ['plain', 'native', 'synesthesia']) {
  test(`${skin} places a replay ghost opposite the player with a central BGA`, async ({ player }, info) => {
    await player.page.setViewportSize({ width: 1280, height: 720 });
    await openWithLibrary(player, { 'be-music.built-in-skin': skin });
    await player.setOption(['Play options'], 'Auto play', true);
    await player.browseTo(SONGS, 'Fixture A');
    if (skin === 'native')
      await player.page
        .locator('[data-be-music-screen="select"]')
        .getByRole('button', { name: 'Auto play', exact: true })
        .click();
    else await player.key('Enter');
    await player.keyWhen(
      (state) => state.scene.kind === 'play' && (state.play?.seconds ?? -1) >= 2,
      undefined,
      'Pause',
      'the single-player play to start',
    );
    await player.key('Pause');
    await player.page.screenshot({ path: info.outputPath(`${skin}-single.png`) });
    await player.waitForResult(0);
    const replay = await player.lastReplay();
    expect(replay).toBeDefined();
    await player.leaveResult();
    const folder = ['Play options', 'Replay / ghost'];
    const chooser = player.page.waitForEvent('filechooser');
    await player.pressOption(folder, 'Ghost replay file…');
    await (
      await chooser
    ).setFiles({
      name: 'ghost.bmplay.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(replay)),
    });
    await expect.poll(() => player.readOption(folder, 'Ghost status')).not.toBe('No replay kept');
    await player.setOption(folder, 'Ghost', 'REPLAY FILE');
    await player.setOption(folder, 'Ghost mode', 'SECOND PLAYFIELD');
    if (skin === 'native')
      await player.page
        .locator('[data-be-music-screen="select"]')
        .getByRole('button', { name: 'Auto play', exact: true })
        .click();
    else await player.key('Enter');
    await player.keyWhen(
      (state) => state.scene.kind === 'play' && (state.play?.seconds ?? -1) >= 2,
      undefined,
      'Pause',
      'the ghost play to start',
    );
    if (skin === 'native') {
      const hud = player.page.locator('be-music-gameplay-hud');
      await expect(hud.locator('[data-two-player]')).toHaveCount(1);
      await expect(hud.locator('[part="second-score"]')).toBeVisible();
      for (const part of ['players', 'judge', 'graph-header', 'graph', 'graph-footer', 'progress']) {
        await expect(hud.locator(`[part="${part}"]`)).toBeVisible();
      }
      await expect(hud.getByRole('heading', { name: 'Fixture A' })).toBeVisible();
      await expect(hud.locator('[part="players"]')).toContainText('Player 1P');
      await expect(hud.locator('[part="judge"]')).toContainText('FAST');
      await expect(hud.locator('[part="judge"]')).toContainText('SLOW');
      await expect(hud.locator('[part="graph-footer"]')).toContainText('Option');
      await expect(hud.locator('[part="graph-footer"]')).toContainText('PACEMAKER');
      await expect(hud.locator('[part="time-limit"], [part="max-combo"], [part="second-max-combo"]')).toHaveCount(0);
      await expect(hud.locator('[part="score"] .eyebrow')).toHaveText('1P Score');
      await expect(hud.locator('[part="second-score"] strong')).not.toHaveText('0');
      const left = await hud.locator('be-music-gauge-panel').nth(0).boundingBox();
      const right = await hud.locator('be-music-gauge-panel').nth(1).boundingBox();
      const bga = await player.page.locator('be-music-bga').boundingBox();
      expect(left!.x + left!.width).toBeLessThan(bga!.x);
      expect(right!.x).toBeGreaterThan(bga!.x + bga!.width);
    }
    await player.key('Pause');
    await player.page.screenshot({ path: info.outputPath(`${skin}-ghost.png`) });
  });
}
