import { normalizeChannel, normalizeObjectKey, resolveBMSBase, type BeMusicJSON } from '@be-music/chart-source';
import { findLastIndexAtOrBefore } from '@be-music/shared-utils/core';
import { createTimingResolver, type TimingResolver } from './timing.ts';

export interface ChartTextCue {
  seconds: number;
  key: string;
  /** Display text: an empty string clears the preceding selection. */
  text: string;
}

export interface ChartTextTimeline {
  cues: ChartTextCue[];
  /** nanasigroove TEXT00: miss text, not initial timeline text. Empty and absent remain distinct. */
  missText?: string;
}

function displayText(raw: string): string {
  return raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
}

/**
 * Resolve pomu/nanasigroove channel 99 on the chart clock. Missing references clear text, like an empty definition.
 * Equal-time cues retain IR order and the last cue wins. Raw definitions remain unchanged for native round trips.
 */
export function buildChartTextTimeline(
  json: BeMusicJSON,
  timing: Pick<TimingResolver, 'eventToSeconds'> = createTimingResolver(json),
): ChartTextTimeline {
  const idBase = resolveBMSBase(json);
  const cues: ChartTextCue[] = [];
  for (const event of json.events) {
    if (normalizeChannel(event.channel) !== '99') continue;
    const key = normalizeObjectKey(event.value, idBase, json.sourceFormat === 'bmson');
    if (key === '00' || key.length === 0) continue;
    const seconds = timing.eventToSeconds(event);
    if (!Number.isFinite(seconds)) continue;
    cues.push({ seconds, key, text: displayText(json.resources.text[key] ?? '') });
  }
  cues.sort((left, right) => left.seconds - right.seconds);
  const miss = json.resources.text['00'];
  return { cues, ...(miss !== undefined ? { missText: displayText(miss) } : {}) };
}

/** Active timeline text; the miss-text overlay is resolved separately by the engine's judging state. */
export function pickChartText(timeline: ChartTextTimeline, seconds: number): string {
  const index = findLastIndexAtOrBefore(timeline.cues, seconds, (cue) => cue.seconds);
  return index < 0 ? '' : timeline.cues[index]!.text;
}
