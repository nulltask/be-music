import type { BeMusicResultData } from '@be-music/skin-sdk';

export type { GaugeHistorySample, ScoreHistorySample } from '@be-music/skin-sdk';

/**
 * Snapshot of the play session, captured at chart-end and routed through the host into the result scene (LR2 skin or
 * be-music skin). The type lives in `@be-music/skin-sdk` as `BeMusicResultData`.
 */
export type PixiGameplayResultData = BeMusicResultData;
