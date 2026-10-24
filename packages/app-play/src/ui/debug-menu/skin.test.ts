import { expect, test, vi } from 'vite-plus/test';
import { rebuildSkinSettingsFolder } from './skin.ts';
import type { DebugMenu } from './index.ts';

test('skin reset captures the cleared overrides in the unified settings document', () => {
  let reset: (() => void) | undefined;
  const skinSettings = new Map([
    ['test', { glow: false }],
    ['other', { glow: false }],
  ]);
  const captured: unknown[] = [];
  const menu = {
    skinSettings,
    skinSettingsFolder: {
      children: [],
      hidden: false,
      addBinding: () => ({ on: vi.fn() }),
      addButton: () => ({
        on: (_event: string, callback: () => void) => {
          reset = callback;
        },
      }),
    },
    deps: {
      beMusicSkin: () => ({ id: 'test', settings: [{ kind: 'toggle', id: 'glow', label: 'Glow', default: true }] }),
      applyBeMusicSkinSettings: vi.fn(),
    },
    scheduleSettingsSave: () => captured.push(Object.fromEntries(skinSettings)),
    rebuildSkinSettingsFolder: vi.fn(),
  };
  rebuildSkinSettingsFolder.call(menu as unknown as DebugMenu);
  expect(reset).toBeDefined();
  reset!();
  expect(captured).toEqual([{ other: { glow: false } }]);
  expect(menu.deps.applyBeMusicSkinSettings).toHaveBeenCalledOnce();
  expect(menu.rebuildSkinSettingsFolder).toHaveBeenCalledOnce();
});
