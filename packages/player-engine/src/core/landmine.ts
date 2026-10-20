import { DEFAULT_LANDMINE_DAMAGE, resolveLandmineDamage } from '@be-music/chart-model';
import { normalizeObjectKey, type BeMusicEvent, type BeMusicSourceFormat } from '@be-music/chart-source';

/** Gauge damage of a mine whose value carries none. Same value as `DEFAULT_LANDMINE_DAMAGE` in `@be-music/chart-model`. */
export const DEFAULT_LANDMINE_GAUGE_DAMAGE: number = DEFAULT_LANDMINE_DAMAGE;

export interface LandmineGaugeEffect {
  objectValue: string;
  damage: number;
  gaugeDelta: number;
}

/**
 * Resolves the gauge damage a landmine object deals when hit, with the normalized object value it was read from. The
 * damage rule (BMS value as base-36 percentage, bmson `damage`, the default) is `resolveLandmineDamage` in
 * `@be-music/chart-model`; a resolved chart (`resolveChart`) already carries it on each mine.
 */
export function resolveLandmineGaugeEffect(
  landmineEvent: Pick<BeMusicEvent, 'value' | 'bmson'>,
  base: 36 | 62 = 36,
  sourceFormat: BeMusicSourceFormat = 'bms',
): LandmineGaugeEffect {
  const damage = resolveLandmineDamage(landmineEvent, base, sourceFormat);
  return {
    objectValue: normalizeObjectKey(landmineEvent.value, base),
    damage,
    gaugeDelta: -damage,
  };
}
