import {
  getPlayModeLayouts,
  PLAY_MODE_LAYOUTS,
  type ChartPlayVariant,
  type PlayModeLayout,
} from '@be-music/chart-model';
import { chartExcerpt, type ChartExcerpt, type ExcerptDocument, type ExcerptLane } from './chart-excerpt.ts';

/**
 * The layout a chart's recorded lane mode names: a layout's label as the player writes it into replays
 * (`7 KEY SP`, `9 KEY (PMS-STD)`), a play variant (`7`), or the older `7keys` form; undefined for anything else.
 */
export function layoutOfLaneMode(laneMode: string): PlayModeLayout | undefined {
  const byLabel = Object.values(PLAY_MODE_LAYOUTS).find((layout) => layout.label === laneMode);
  if (byLabel !== undefined) return byLabel;
  const variant = /^(\d+)(?:\s*keys?)?$/i.exec(laneMode.trim())?.[1];
  return variant !== undefined ? getPlayModeLayouts(variant as ChartPlayVariant)[0] : undefined;
}

/**
 * The lanes of a lane mode, left to right as skins draw them, each with the colour of its notes: blue for black keys,
 * red for the scratch (and the keyboard wheel), white for the other keys. Empty for a mode be-music does not know.
 */
export function excerptLanes(laneMode: string): Array<{ channel: string } & ExcerptLane> {
  const layout = layoutOfLaneMode(laneMode);
  const lanes = layout?.lanes ?? [];
  return lanes.map((lane) => ({
    channel: lane.channel,
    tone: lane.kind !== 'key' ? 'red' : lane.tone === 'black' ? 'blue' : 'white',
    // 9 KEY (PMS-STD) authors keys 6..9 on the 2P bank, but it is one player's single bank.
    side: layout?.variant === '9' ? '1P' : lane.side,
  }));
}

/** Whether a lane mode's lanes take Synesthesia's fixed IIDX widths (5 / 7 / 10 / 14 KEY) or share one side evenly. */
export function excerptLaneWidths(laneMode: string): 'iidx' | 'shared' {
  const variant = layoutOfLaneMode(laneMode)?.variant;
  return variant === '5' || variant === '7' || variant === '10' || variant === '14' ? 'iidx' : 'shared';
}

/**
 * The excerpt a play's share card draws, from its chart's fingerprint document (as stored in R2) and lane mode; null
 * when the document is not one or nothing can be drawn, and the card keeps its decorative playfield.
 */
export function scoreCardExcerpt(document: unknown, laneMode: string | null): ChartExcerpt | null {
  if (laneMode === null || typeof document !== 'object' || document === null) return null;
  const { notes, measures } = document as Partial<ExcerptDocument>;
  if (!Array.isArray(notes) || !Array.isArray(measures?.lengths)) return null;
  return chartExcerpt(document as ExcerptDocument, excerptLanes(laneMode), excerptLaneWidths(laneMode));
}
