import { expect, test, vi } from 'vite-plus/test';
import { rebuildSkinSettingsFolder } from './skin.ts';
import type { OptionsDialog } from './index.ts';

test('skin reset captures the cleared overrides in the unified settings document', () => {
  let reset: (() => void) | undefined;
  const skinSettings = new Map([
    ['test', { glow: false }],
    ['other', { glow: false }],
  ]);
  const captured: unknown[] = [];
  const folder = {
    addBinding: () => ({ on: vi.fn() }),
  };
  const menu = {
    skinSettings,
    layout: { setGroupReset: (_id: string, callback: () => void) => (reset = callback) },
    skinSettingRows: [],
    place: () => folder,
    deps: {
      beMusicSkin: () => ({ id: 'test', settings: [{ kind: 'toggle', id: 'glow', label: 'Glow', default: true }] }),
      applyBeMusicSkinSettings: vi.fn(),
    },
    scheduleSettingsSave: () => captured.push(Object.fromEntries(skinSettings)),
    rebuildSkinSettingsFolder: vi.fn(),
  };
  rebuildSkinSettingsFolder.call(menu as unknown as OptionsDialog);
  expect(reset).toBeDefined();
  reset!();
  expect(captured).toEqual([{ other: { glow: false } }]);
  expect(menu.deps.applyBeMusicSkinSettings).toHaveBeenCalledOnce();
  expect(menu.rebuildSkinSettingsFolder).toHaveBeenCalledOnce();
});
