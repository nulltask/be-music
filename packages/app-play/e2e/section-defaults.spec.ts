import { expect, smokeGroup, test } from './support.ts';

test(
  'resetting Audio applies its defaults and preserves settings outside the section and in its subsections',
  smokeGroup(3),
  async ({ player }) => {
    const { page } = player;
    await page.route('**/api/player-settings', (route) => route.fulfill({ status: 204 }));
    await player.open();
    await page.locator('[data-service-header="settings"]').click();
    await player.setOption(['Play options'], 'Auto play', true);
    await player.setOption(['Audio'], 'Mute', true);
    await player.setOption(['Audio'], 'Master (%)', 35);
    await player.setOption(['Audio', 'Compressor'], 'Enabled', false);
    const options = page.locator('#options-modal');
    const audio = options.locator('section[data-option-title="Audio"]');
    await audio.locator(':scope > .options-folder-content > .options-section-reset button').click();

    const saved = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem('be-music.option-settings') ?? '{}').settings);
    await expect.poll(saved).toMatchObject({ muted: false, masterVolume: 100, compressor: false, autoPlay: true });
    expect(await player.readOption(['Audio'], 'Mute')).toBe(false);

    await page.reload();
    await player.waitFor((state) => state.scene.kind === 'select', 'select after reloading the reset');
    expect(await player.readOption(['Audio'], 'Mute')).toBe(false);
    expect(await player.readOption(['Audio'], 'Master (%)')).toBe(100);
    expect(await player.readOption(['Audio', 'Compressor'], 'Enabled')).toBe(false);
    expect(await player.readOption(['Play options'], 'Auto play')).toBe(true);
  },
);
