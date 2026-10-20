import {
  normalizeObjectKey,
  type BeMusicEvent,
  type BeMusicJSON,
  type BeMusicSourceFormat,
} from '@be-music/chart-source';

/** Long-note mode: 1 = LN (no tail judgment), 2 = CN (tail judged), 3 = HCN (held, gauge drains while released). */
export type LongNoteMode = 1 | 2 | 3;

/**
 * Long-note mode when the chart names none: LN, the LR2-aligned default for a missing BMS `#LNMODE`. beatoraja's bmson
 * extension leaves an unspecified `info.ln_type` to the player's default mode, which is the same LN here.
 */
export const DEFAULT_LONG_NOTE_MODE: LongNoteMode = 1;

/** Chart-level long-note mode after `#LNMODE` / bmson `info.ln_type` resolution. */
export function resolveChartLongNoteMode(json: BeMusicJSON): LongNoteMode {
  if (json.sourceFormat === 'bms') {
    return json.bms.lnMode === 2 || json.bms.lnMode === 3 ? json.bms.lnMode : DEFAULT_LONG_NOTE_MODE;
  }
  const lnType = json.bmson.info.lnType;
  return lnType === 2 || lnType === 3 ? lnType : DEFAULT_LONG_NOTE_MODE;
}

/** Gauge damage (a percentage) of a mine whose value carries no usable damage. */
export const DEFAULT_LANDMINE_DAMAGE = 4;
const BASE36_OBJECT_KEY_PATTERN = /^[0-9A-Z]{2}$/;

/**
 * The gauge damage (a percentage) a landmine object deals when hit.
 *
 * Mine damage encodes the value in base-36 regardless of the chart's `#BASE` setting (the damage encoding is a
 * chart-format constant, not an indexed-resource lookup), so the ID is normalized under the chart's base only to
 * match the rest of the resource-key handling. LR2 and beatoraja both interpret the value DIRECTLY as the gauge-damage
 * percentage (losak's LR2 mine writeup; jbms-parser passes the raw base-36 value into `MineNote`) — the nanasi-era
 * `value / 2` rule in hitkey's memo is a different lineage and is NOT what LR2 does. `ZZ` (= 1295) therefore wipes any
 * gauge: survival gauges die instantly, GROOVE / EASY hit their 2 % floor.
 *
 * bmson `mine_channels[].notes[].damage` (beatoraja extension) is an explicit per-mine gauge percentage; when present
 * it wins over the BMS value rule because the event value there is the WAV slot, not a damage encoding. `damage: 0` is
 * a valid authored value (a no-damage decoration mine), so the guard checks finiteness rather than truthiness.
 *
 * For a bmson chart (`sourceFormat: 'bmson'`) the value rule never applies: the parser numbers each `mine_channels`
 * WAV slot after the sound channels, so reading it as damage would make the damage depend on how many sound channels
 * the chart has. A bmson mine without a usable `damage` deals {@link DEFAULT_LANDMINE_DAMAGE}, the same fallback as an
 * invalid BMS mine value.
 */
export function resolveLandmineDamage(
  landmineEvent: Pick<BeMusicEvent, 'value' | 'bmson'>,
  base: 36 | 62 = 36,
  sourceFormat: BeMusicSourceFormat = 'bms',
): number {
  const bmsonDamage = landmineEvent.bmson?.damage;
  if (typeof bmsonDamage === 'number' && Number.isFinite(bmsonDamage) && bmsonDamage >= 0) {
    return bmsonDamage;
  }
  const objectValue = normalizeObjectKey(landmineEvent.value, base);
  if (sourceFormat === 'bmson' || !BASE36_OBJECT_KEY_PATTERN.test(objectValue)) {
    return DEFAULT_LANDMINE_DAMAGE;
  }
  const parsedDamage = Number.parseInt(objectValue, 36);
  if (!Number.isFinite(parsedDamage) || parsedDamage <= 0) {
    return DEFAULT_LANDMINE_DAMAGE;
  }
  return parsedDamage;
}
