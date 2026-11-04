import { expect, SONGS, test } from './support.ts';

for (const renderer of ['webgl', 'webgpu']) {
  test(`Synesthesia frosted panels render with ${renderer}`, async ({ player }, info) => {
    const warnings: string[] = [];
    player.page.on('console', (message) => {
      if (message.text().includes('Blend filter requires backBuffer')) warnings.push(message.text());
    });
    await player.page.setViewportSize({ width: 1280, height: 720 });
    await player.open({ 'be-music.built-in-skin': 'synesthesia', 'be-music.skin-effects': 'full' });
    await player.page.goto(`/?e2e=1&renderer=${renderer}`);
    await player.waitFor((state) => state.scene.kind === 'select', 'select screen');
    await player.drop('songs', { prefix: SONGS });
    await player.setOption(['Play options'], 'Auto play', true);
    await player.browseTo(SONGS, 'Fixture A');
    await player.page.waitForTimeout(800);
    await player.page.screenshot({ path: info.outputPath(`glass-${renderer}-select.png`) });
    await player.key('Enter');
    await player.keyWhen(
      (state) => state.scene.kind === 'play' && (state.play?.seconds ?? -1) >= 2,
      undefined,
      'Pause',
      'play screen',
    );
    await player.key('Pause');
    await player.page.screenshot({ path: info.outputPath(`glass-${renderer}-play.png`) });
    expect(warnings).toEqual([]);
  });
}
