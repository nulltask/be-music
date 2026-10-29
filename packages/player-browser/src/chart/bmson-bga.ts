import { buildBmsonBGAEventTimeline, type BmsonBGAEventCue } from '@be-music/chart-model';
import type { BeMusicJSON } from '@be-music/chart-source';

/** Every possible event-layer filename, including alternatives not selected at the first trigger. */
export function collectBmsonBGAFrameKeys(
  chart: BeMusicJSON,
  cues?: readonly BmsonBGAEventCue[],
): { layer: Set<string>; poor: Set<string> } {
  const layer = new Set<string>();
  const poor = new Set<string>();
  for (const cue of cues ?? buildBmsonBGAEventTimeline(chart, { beatToSeconds: (beat) => beat })) {
    const keys = cue.condition === 'miss' ? poor : layer;
    for (const sequence of cue.sequences) {
      for (const frame of sequence.frames) if (frame.key) keys.add(frame.key);
    }
  }
  return { layer, poor };
}
