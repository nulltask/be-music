import { expect, test, vi } from 'vite-plus/test';
import { DEFAULT_COMPRESSOR_PARAMS } from '@be-music/player-browser/audio';
import { defaultCompressorTunings, paramsFromTuning } from '../../compressor-tuning.ts';
import type { OptionContainer } from '../options-controls.ts';
import type { OptionsDialog } from './index.ts';
import { buildCompressorTuningGUI } from './compressor.ts';

test.each([
  ['split', 'key', 'Key compressor'],
  ['split', 'bgm', 'BGM compressor'],
  ['split', 'master', 'Master compressor'],
  ['legacy', 'legacy', 'Legacy compressor'],
] as const)('%s compressor reset saves the default tuning for %s', (mode, compressor, title) => {
  const tunings = defaultCompressorTunings();
  for (const tuning of Object.values(tunings)) tuning.thresholdDb = -6;
  const expected = structuredClone(tunings);
  expected[compressor] = defaultCompressorTunings()[compressor];
  const resets = new Map<string, () => void>();
  const refreshes = new Map<string, ReturnType<typeof vi.fn>[]>();
  let saved: typeof tunings | undefined;
  const setAudioCompressorParams = vi.fn();
  const menu = {
    compressorMode: mode,
    compressorTunings: tunings,
    gameplayView: { setAudioCompressorParams },
    scheduleSettingsSave: vi.fn(() => {
      saved = structuredClone(tunings);
    }),
  };
  const parent = {
    addFolder: ({ title: folderTitle }: { title: string }) => {
      const controllers: ReturnType<typeof vi.fn>[] = [];
      refreshes.set(folderTitle, controllers);
      return {
        addBinding: () => {
          const refresh = vi.fn();
          controllers.push(refresh);
          return { refresh, on: vi.fn() };
        },
        addButton: () => ({
          on: (_event: string, callback: () => void) => resets.set(folderTitle, callback),
        }),
      };
    },
  };
  buildCompressorTuningGUI.call(menu as unknown as OptionsDialog, parent as unknown as OptionContainer);
  expect(resets.has(title)).toBe(true);
  resets.get(title)!();
  expect(menu.scheduleSettingsSave).toHaveBeenCalledOnce();
  expect(saved).toEqual(expected);
  expect(setAudioCompressorParams).toHaveBeenCalledExactlyOnceWith(
    compressor,
    paramsFromTuning(expected[compressor], DEFAULT_COMPRESSOR_PARAMS[compressor]),
  );
  expect(refreshes.get(title)).toHaveLength(5);
  for (const refresh of refreshes.get(title)!) expect(refresh).toHaveBeenCalledOnce();
});
