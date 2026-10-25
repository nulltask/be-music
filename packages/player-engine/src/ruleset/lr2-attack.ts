import type { GaugeSpec } from './definitions.ts';

/** LR2 beta3 100201, ParseBMSFile case 4 (0x4b5ca2); identical single/grade/expert tables. */
export function createLR2PerfectAttackGauge(): GaugeSpec {
  return {
    id: 'P-ATTACK',
    min: 0,
    max: 100,
    initial: 100,
    border: 0,
    survival: true,
    death: 2,
    values: [0.1, -1, -100, -100, -100, -100],
    // ApplyJudge's judge<=2 condition excludes PGREAT/GREAT/GOOD from softening (OpenLR2 L1954).
    guts: [{ threshold: 32, multiplier: 0.6, judges: [3, 4, 5] }],
  };
}

/** LR2 beta3 case 5 (0x4b5ccd): only PGREAT, missed POOR and empty POOR scale by HARD's damage factor. */
export function createLR2GoodAttackGauge(damage: number): GaugeSpec {
  return {
    id: 'G-ATTACK',
    min: 0,
    max: 100,
    initial: 100,
    border: 0,
    survival: true,
    death: 2,
    values: [-10 * damage, -1, 0.1, -6, -10 * damage, -2 * damage],
    guts: [{ threshold: 32, multiplier: 0.6, judges: [3, 4, 5] }],
  };
}
