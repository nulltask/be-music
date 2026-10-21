import { describe, expect, test, vi } from 'vite-plus/test';
import { SilentModeSetting } from './silent-mode.ts';

describe('SilentModeSetting', () => {
  test('a change from either checkbox lands in the state and repaints both checkboxes', () => {
    const settings = { playInSilentMode: false };
    const silentMode = new SilentModeSetting({ settings, touchFirst: true });
    const controller = { refresh: vi.fn() };
    const startOption = { setChecked: vi.fn() };
    silentMode.controller = controller;
    silentMode.startOption = startOption;

    silentMode.set(true);
    expect(settings.playInSilentMode).toBe(true);
    expect(controller.refresh).toHaveBeenCalledTimes(1);
    expect(startOption.setChecked).toHaveBeenCalledWith(true);

    silentMode.set(false);
    expect(settings.playInSilentMode).toBe(false);
    expect(startOption.setChecked).toHaveBeenLastCalledWith(false);
  });

  test('works with neither checkbox, where the browser offers no audio session', () => {
    const settings = { playInSilentMode: true };
    const silentMode = new SilentModeSetting({ settings, touchFirst: false });
    expect(() => silentMode.set(false)).not.toThrow();
    expect(settings.playInSilentMode).toBe(false);
    // No audio session here (`navigator.audioSession`), so there is nothing to point at.
    expect(() => silentMode.maybeShowHint()).not.toThrow();
  });
});
