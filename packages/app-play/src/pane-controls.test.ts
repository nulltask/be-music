import { expect, test } from 'vite-plus/test';
import { paneOptions, setButtonTitle, setDisabled, monitorFrameRate } from './pane-controls.ts';

test('presets preserve values and order while giving array values visible labels', () => {
  expect(paneOptions([0, 0.5, 2])).toEqual([
    { text: '0', value: 0 },
    { text: '0.5', value: 0.5 },
    { text: '2', value: 2 },
  ]);
  expect(paneOptions({ Off: 0, Auto: -1 })).toEqual([
    { text: 'Off', value: 0 },
    { text: 'Auto', value: -1 },
  ]);
  expect(paneOptions(['lr2', 'intended'])).toEqual([
    { text: 'lr2', value: 'lr2' },
    { text: 'intended', value: 'intended' },
  ]);
});

test('native control state follows locks and optional controls are harmless', () => {
  const control = { disabled: false };
  setDisabled(control, true);
  expect(control.disabled).toBe(true);
  setDisabled(control, false);
  expect(control.disabled).toBe(false);
  expect(() => setDisabled(undefined, true)).not.toThrow();
});

test('record and detection buttons update their native title', () => {
  const button = { title: 'Record' };
  setButtonTitle(button, 'Stop');
  expect(button.title).toBe('Stop');
  expect(() => setButtonTitle(undefined, 'Stop')).not.toThrow();
});

test('the native FPS monitor stays finite before the renderer is ready and at startup', () => {
  expect(monitorFrameRate(undefined)).toBe(0);
  expect(monitorFrameRate({})).toBe(0);
  expect(monitorFrameRate({ FPS: NaN })).toBe(0);
  expect(monitorFrameRate({ FPS: Infinity })).toBe(0);
  expect(monitorFrameRate({ FPS: -1 })).toBe(0);
  expect(monitorFrameRate({ FPS: 144 })).toBe(144);
});
