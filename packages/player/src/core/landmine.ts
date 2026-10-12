import { normalizeObjectKey, type BeMusicEvent, type BeMusicSourceFormat } from '@be-music/json';

export const DEFAULT_LANDMINE_GAUGE_DAMAGE = 4;
const BASE36_OBJECT_KEY_PATTERN = /^[0-9A-Z]{2}$/;

export interface LandmineGaugeEffect {
  objectValue: string;
  damage: number;
  gaugeDelta: number;
}

/**
 * Resolves the gauge damage a landmine object deals when hit.
 *
 * Mine damage encodes the value in base-36 regardless of the chart's `#BASE` setting (the damage encoding is a
 * chart-format constant, not an indexed-resource lookup), so the ID is normalized under the chart's base only to
 * keep the returned `objectValue` in sync with the rest of the resource-key reporting. LR2 and beatoraja both
 * interpret the value DIRECTLY as the gauge-damage percentage (losak's LR2 mine writeup; jbms-parser passes the raw
 * base-36 value into `MineNote`) — the nanasi-era `value / 2` rule in hitkey's memo is a different lineage and is
 * NOT what LR2 does. `ZZ` (= 1295) therefore wipes any gauge: survival gauges die instantly, GROOVE / EASY hit
 * their 2 % floor.
 *
 * bmson `key_channels[].notes[].damage` is an explicit per-mine gauge percentage; when present it wins over the BMS
 * value rule because the event value there is the WAV slot, not a damage encoding. `damage: 0` is a valid
 * authored value (a no-damage decoration mine), so the guard checks finiteness rather than truthiness.
 *
 * For a bmson chart (`sourceFormat: 'bmson'`) the value rule never applies: the parser numbers each `key_channels`
 * WAV slot after the sound channels, so reading it as damage would make the damage depend on how many sound channels
 * the chart has. A bmson mine without a usable `damage` deals {@link DEFAULT_LANDMINE_GAUGE_DAMAGE}, the same fallback
 * as an invalid BMS mine value.
 */
export function resolveLandmineGaugeEffect(
  landmineEvent: Pick<BeMusicEvent, 'value' | 'bmson'>,
  base: 36 | 62 = 36,
  sourceFormat: BeMusicSourceFormat = 'bms',
): LandmineGaugeEffect {
  const objectValue = normalizeObjectKey(landmineEvent.value, base);
  const bmsonDamage = landmineEvent.bmson?.damage;
  if (typeof bmsonDamage === 'number' && Number.isFinite(bmsonDamage) && bmsonDamage >= 0) {
    return {
      objectValue,
      damage: bmsonDamage,
      gaugeDelta: -bmsonDamage,
    };
  }
  if (sourceFormat === 'bmson' || !BASE36_OBJECT_KEY_PATTERN.test(objectValue)) {
    return {
      objectValue,
      damage: DEFAULT_LANDMINE_GAUGE_DAMAGE,
      gaugeDelta: -DEFAULT_LANDMINE_GAUGE_DAMAGE,
    };
  }
  const parsedDamage = Number.parseInt(objectValue, 36);
  if (!Number.isFinite(parsedDamage) || parsedDamage <= 0) {
    return {
      objectValue,
      damage: DEFAULT_LANDMINE_GAUGE_DAMAGE,
      gaugeDelta: -DEFAULT_LANDMINE_GAUGE_DAMAGE,
    };
  }
  return {
    objectValue,
    damage: parsedDamage,
    gaugeDelta: -parsedDamage,
  };
}
