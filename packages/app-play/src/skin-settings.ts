// The player's values for be-music skins' `settings`: persistence per skin id across reloads, and the Debug Menu
// controllers built from a skin's settings schema.

import type { BeMusicSkinSetting } from '@be-music/player-skin-sdk';

const STORAGE_KEY = 'be-music.skin-settings';
/** Bumped when the stored shape changes; a stored map with another version is ignored. */
const STORAGE_VERSION = 1;

/** One stored setting value: a choice's option value, a number, or a toggle's state. */
export type StoredSkinSettingValue = string | number | boolean;

/** Stored values per skin id, each keyed by setting id. */
export type StoredSkinSettings = Map<string, Record<string, StoredSkinSettingValue>>;

function isStoredValue(value: unknown): value is StoredSkinSettingValue {
  return (
    typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
  );
}

/**
 * Parses stored skin settings. Values that are not a string, a finite number, or a boolean are dropped; anything
 * unreadable yields no settings. Values are not checked against any schema here — the scenes do that with
 * `resolveBeMusicSkinSettings`, so a value an older release of a skin stored falls back to the default there.
 */
export function parseStoredSkinSettings(raw: string | null | undefined): StoredSkinSettings {
  const settings: StoredSkinSettings = new Map();
  if (!raw) return settings;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return settings;
  }
  if (typeof parsed !== 'object' || parsed === null) return settings;
  const { version, skins } = parsed as { version?: unknown; skins?: unknown };
  if (version !== STORAGE_VERSION || typeof skins !== 'object' || skins === null) return settings;
  for (const [skinId, entry] of Object.entries(skins)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const values: Record<string, StoredSkinSettingValue> = {};
    for (const [id, value] of Object.entries(entry)) {
      if (isStoredValue(value)) values[id] = value;
    }
    settings.set(skinId, values);
  }
  return settings;
}

/** Serializes skin settings as `{ version: 1, skins: { [skinId]: { [settingId]: value } } }`. */
export function serializeStoredSkinSettings(settings: StoredSkinSettings): string {
  return JSON.stringify({ version: STORAGE_VERSION, skins: Object.fromEntries(settings) });
}

/**
 * Records `value` for setting `id` of skin `skinId`, keeping the skin's other values, and returns the skin's values. A
 * new object replaces the skin's entry, so values already handed to a scene are never mutated.
 */
export function setStoredSkinSetting(
  settings: StoredSkinSettings,
  skinId: string,
  id: string,
  value: StoredSkinSettingValue,
): Readonly<Record<string, StoredSkinSettingValue>> {
  const values = { ...settings.get(skinId), [id]: value };
  settings.set(skinId, values);
  return values;
}

export function readStoredSkinSettings(): StoredSkinSettings {
  try {
    return parseStoredSkinSettings(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return new Map();
  }
}

export function storeSkinSettings(settings: StoredSkinSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeStoredSkinSettings(settings));
  } catch {
    // Private windows / blocked or full storage: the values still apply for this session.
  }
}

/** A Debug Menu controller for one skin setting. */
export type SkinSettingController =
  | {
      kind: 'dropdown';
      id: string;
      name: string;
      /** Shown label → option value, converted to native list items by the pane. */
      options: Record<string, string>;
    }
  | { kind: 'slider'; id: string; name: string; min: number; max: number; step: number | undefined }
  | { kind: 'checkbox'; id: string; name: string };

/**
 * The Debug Menu controllers for a skin's `settings` schema, in declaration order: a choice becomes a dropdown, a
 * number a slider over `min..max` (with the unit in its name), a toggle a checkbox. Option labels that repeat get the
 * option value appended so every option stays pickable.
 */
export function describeSkinSettingControllers(
  settings: readonly BeMusicSkinSetting[] | undefined,
): SkinSettingController[] {
  return (settings ?? []).map((setting): SkinSettingController => {
    switch (setting.kind) {
      case 'choice': {
        const options: Record<string, string> = {};
        for (const option of setting.options) {
          const label = option.label in options ? `${option.label} (${option.value})` : option.label;
          options[label] = option.value;
        }
        return { kind: 'dropdown', id: setting.id, name: setting.label, options };
      }
      case 'number':
        return {
          kind: 'slider',
          id: setting.id,
          name: setting.unit === undefined ? setting.label : `${setting.label} (${setting.unit})`,
          min: setting.min,
          max: setting.max,
          step: setting.step,
        };
      case 'toggle':
        return { kind: 'checkbox', id: setting.id, name: setting.label };
    }
  });
}
