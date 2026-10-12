import type { BeMusicSkin } from './types.ts';

/** A skin setting picked from a fixed list (a colour theme, a layout variant). */
export interface BeMusicSkinChoiceSetting {
  readonly kind: 'choice';
  /** Key of the value in {@link BeMusicSkinSettingValues}; unique within the skin. */
  readonly id: string;
  /** Name shown in the host's settings UI. */
  readonly label: string;
  /** The choices: `value` is what the skin receives, `label` what the player sees. */
  readonly options: readonly { readonly value: string; readonly label: string }[];
  /** Value used until the player picks one; must be one of the option values. */
  readonly default: string;
}

/** A numeric skin setting with a range (an offset, an opacity). */
export interface BeMusicSkinNumberSetting {
  readonly kind: 'number';
  /** Key of the value in {@link BeMusicSkinSettingValues}; unique within the skin. */
  readonly id: string;
  /** Name shown in the host's settings UI. */
  readonly label: string;
  readonly min: number;
  readonly max: number;
  /** Increment the host's slider moves by. */
  readonly step?: number;
  /** Value used until the player picks one; must lie in `min..max`. */
  readonly default: number;
  /** Unit shown beside the value. */
  readonly unit?: 'px' | 'ms' | '%';
}

/** An on / off skin setting. */
export interface BeMusicSkinToggleSetting {
  readonly kind: 'toggle';
  /** Key of the value in {@link BeMusicSkinSettingValues}; unique within the skin. */
  readonly id: string;
  /** Name shown in the host's settings UI. */
  readonly label: string;
  readonly default: boolean;
}

/** One option a skin lets the player tune (see `BeMusicSkin.settings`). */
export type BeMusicSkinSetting = BeMusicSkinChoiceSetting | BeMusicSkinNumberSetting | BeMusicSkinToggleSetting;

/**
 * The player's value for every setting a skin declares, keyed by setting id: a `string` for a choice, a `number` for a
 * number, a `boolean` for a toggle.
 */
export type BeMusicSkinSettingValues = Readonly<Record<string, string | number | boolean>>;

const NUMBER_UNITS: ReadonlySet<string> = new Set(['px', 'ms', '%']);

/**
 * Problems with a skin's `settings` schema — duplicate or empty ids, empty labels, defaults outside their range or
 * options — as human-readable messages. Empty when the schema is fine (or absent). `validateBeMusicSkin` includes
 * these.
 */
export function validateBeMusicSkinSettings(settings: readonly BeMusicSkinSetting[] | undefined): string[] {
  if (settings === undefined) return [];
  if (!Array.isArray(settings)) return ['settings must be an array'];
  const problems: string[] = [];
  const ids = new Set<string>();
  settings.forEach((setting: BeMusicSkinSetting, index) => {
    const name =
      typeof setting?.id === 'string' && setting.id !== '' ? `setting "${setting.id}"` : `settings[${index}]`;
    if (typeof setting?.id !== 'string' || setting.id.trim() === '') {
      problems.push(`${name}: id must not be empty`);
    } else if (ids.has(setting.id)) {
      problems.push(`${name}: id is used more than once`);
    } else {
      ids.add(setting.id);
    }
    if (typeof setting?.label !== 'string' || setting.label.trim() === '') {
      problems.push(`${name}: label must not be empty`);
    }
    switch (setting?.kind) {
      case 'choice': {
        if (!Array.isArray(setting.options) || setting.options.length === 0) {
          problems.push(`${name}: options must not be empty`);
          break;
        }
        const values = setting.options.map((option) => option.value);
        if (new Set(values).size !== values.length) problems.push(`${name}: option values must be unique`);
        if (!values.includes(setting.default)) {
          problems.push(`${name}: default "${String(setting.default)}" is not one of the option values`);
        }
        break;
      }
      case 'number': {
        const { min, max, step } = setting;
        if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
          problems.push(`${name}: min and max must be finite numbers with min <= max`);
        } else if (!Number.isFinite(setting.default) || setting.default < min || setting.default > max) {
          problems.push(`${name}: default ${String(setting.default)} is outside ${min}..${max}`);
        }
        if (step !== undefined && !(Number.isFinite(step) && step > 0)) {
          problems.push(`${name}: step must be a positive number`);
        }
        if (setting.unit !== undefined && !NUMBER_UNITS.has(setting.unit)) {
          problems.push(`${name}: unit "${String(setting.unit)}" must be one of ${[...NUMBER_UNITS].join(', ')}`);
        }
        break;
      }
      case 'toggle':
        if (typeof setting.default !== 'boolean') problems.push(`${name}: default must be a boolean`);
        break;
      default:
        problems.push(
          `${name}: kind "${String((setting as { kind?: unknown })?.kind)}" must be choice, number, or toggle`,
        );
    }
  });
  return problems;
}

/**
 * The values a skin draws with: `stored` (what the host persisted for the skin, possibly from an older release of it)
 * checked against the skin's `settings` schema. Each setting gets its stored value when that is still valid — a known
 * option, a finite number (clamped into `min..max`), a boolean — and its `default` otherwise. Stored keys the schema
 * no longer declares are dropped.
 */
export function resolveBeMusicSkinSettings(
  skin: Pick<BeMusicSkin, 'settings'>,
  stored?: Readonly<Record<string, unknown>>,
): BeMusicSkinSettingValues {
  const values: Record<string, string | number | boolean> = {};
  for (const setting of skin.settings ?? []) {
    const value = stored?.[setting.id];
    switch (setting.kind) {
      case 'choice':
        values[setting.id] =
          typeof value === 'string' && setting.options.some((option) => option.value === value)
            ? value
            : setting.default;
        break;
      case 'number':
        values[setting.id] =
          typeof value === 'number' && Number.isFinite(value)
            ? Math.min(setting.max, Math.max(setting.min, value))
            : setting.default;
        break;
      case 'toggle':
        values[setting.id] = typeof value === 'boolean' ? value : setting.default;
        break;
    }
  }
  return values;
}
