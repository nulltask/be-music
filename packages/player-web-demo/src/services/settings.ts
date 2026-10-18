// The settings the demo remembers across visits (`localStorage`, under `be-music-demo.*` keys). Every read falls back
// to the default and every write is skipped when storage is blocked (a private window), so a setting still applies
// for the visit. The keys are part of the demo's contract with returning players and with the end-to-end suite, which
// seeds them: never rename one.

import { parseRecordingFormatKey, recordingFormatKey } from '../recording-format-choice.ts';
import {
  readDeviceSignals,
  resolveDefaultSkinEffects,
  type DeviceSignals,
  type PlayLayoutChoice,
  type SkinEffectsLevel,
} from '../device-profile.ts';

/** Where the settings are kept: `localStorage`, or a stand-in. */
export type SettingStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** `localStorage`, or `undefined` where there is none or it is blocked. */
export function defaultSettingStorage(): SettingStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export const BUILT_IN_SKIN_STORAGE_KEY = 'be-music-demo.built-in-skin';

export function readStoredBuiltInSkinId(
  storage: SettingStorage | undefined = defaultSettingStorage(),
): string | undefined {
  try {
    return storage?.getItem(BUILT_IN_SKIN_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function storeBuiltInSkinId(id: string, storage: SettingStorage | undefined = defaultSettingStorage()): void {
  try {
    storage?.setItem(BUILT_IN_SKIN_STORAGE_KEY, id);
  } catch {
    // Private windows / blocked storage: the pick still applies for this session.
  }
}

export const SKIN_EFFECTS_STORAGE_KEY = 'be-music-demo.skin-effects';

/** Stored effect level, else `'reduced'` on a phone / tablet or when the OS asks for reduced motion, else `'full'`. */
export function readStoredSkinEffects(
  storage: SettingStorage | undefined = defaultSettingStorage(),
  signals: DeviceSignals = readDeviceSignals(),
): SkinEffectsLevel {
  let stored: string | null = null;
  try {
    stored = storage?.getItem(SKIN_EFFECTS_STORAGE_KEY) ?? null;
  } catch {
    // Storage blocked — fall back to the device default.
  }
  return resolveDefaultSkinEffects(stored, signals);
}

export function storeSkinEffects(
  level: SkinEffectsLevel,
  storage: SettingStorage | undefined = defaultSettingStorage(),
): void {
  try {
    storage?.setItem(SKIN_EFFECTS_STORAGE_KEY, level);
  } catch {
    // Private windows / blocked storage: the pick still applies for this session.
  }
}

export const PLAY_LAYOUT_STORAGE_KEY = 'be-music-demo.play-layout';

/** Stored Debug Menu play-layout pick, `'auto'` when none. */
export function readStoredPlayLayout(storage: SettingStorage | undefined = defaultSettingStorage()): PlayLayoutChoice {
  try {
    const stored = storage?.getItem(PLAY_LAYOUT_STORAGE_KEY);
    if (stored === 'auto' || stored === 'standard' || stored === 'touch') return stored;
  } catch {
    // Storage blocked — use the default.
  }
  return 'auto';
}

export function storePlayLayout(
  choice: PlayLayoutChoice,
  storage: SettingStorage | undefined = defaultSettingStorage(),
): void {
  try {
    storage?.setItem(PLAY_LAYOUT_STORAGE_KEY, choice);
  } catch {
    // Private windows / blocked storage: the pick still applies for this session.
  }
}

export const RECORDING_FORMAT_STORAGE_KEY = 'be-music-demo.recording-format';

/** The remembered "Video format" (`mp4/avc`, `webm/vp9`, …); MP4 · H.264 when none is stored or it is unknown. */
export function readStoredRecordingFormat(storage: SettingStorage | undefined = defaultSettingStorage()): string {
  try {
    return recordingFormatKey(parseRecordingFormatKey(storage?.getItem(RECORDING_FORMAT_STORAGE_KEY) ?? null));
  } catch {
    // Storage blocked — use the default.
    return recordingFormatKey(parseRecordingFormatKey(null));
  }
}

export function storeRecordingFormat(key: string, storage: SettingStorage | undefined = defaultSettingStorage()): void {
  try {
    storage?.setItem(RECORDING_FORMAT_STORAGE_KEY, key);
  } catch {
    // Storage blocked — the choice lasts for this visit only.
  }
}

export const VOLUME_STORAGE_KEY = 'be-music-demo.volumes';

export interface StoredVolumes {
  masterVolume: number;
  keyVolume: number;
  bgmVolume: number;
}

/** Master / keysound / BGM volumes in percent, as last set in the Debug Menu (all 100 when nothing is stored). */
export function readStoredVolumes(storage: SettingStorage | undefined = defaultSettingStorage()): StoredVolumes {
  const fallback = { masterVolume: 100, keyVolume: 100, bgmVolume: 100 };
  try {
    const raw = storage?.getItem(VOLUME_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Record<keyof StoredVolumes, unknown>>;
    const percent = (value: unknown, otherwise: number) =>
      typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : otherwise;
    return {
      masterVolume: percent(parsed.masterVolume, 100),
      keyVolume: percent(parsed.keyVolume, 100),
      bgmVolume: percent(parsed.bgmVolume, 100),
    };
  } catch {
    return fallback;
  }
}

export function storeVolumes(
  volumes: StoredVolumes,
  storage: SettingStorage | undefined = defaultSettingStorage(),
): void {
  try {
    storage?.setItem(VOLUME_STORAGE_KEY, JSON.stringify(volumes));
  } catch {
    // Private windows / blocked storage: the volumes still apply for this session.
  }
}
