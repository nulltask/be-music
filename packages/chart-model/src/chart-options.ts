import { normalizeChannel, normalizeObjectKey, resolveBMSBase, type BeMusicJSON } from '@be-music/chart-source';
import { hasControlFlow } from './control-flow.ts';
import { createTimingResolver, type TimingResolver } from './timing.ts';

export interface ChartOptionCue {
  seconds: number;
  key: string;
  /** Whole vendor payload. Absent means an undefined reference to diagnose, not an instruction to clear options. */
  declaration?: string;
}

export interface ChartOptionTimeline {
  /** Ordered complete #OPTION payloads. Vendor arguments may contain whitespace. */
  initial: string[];
  /** Channel-A6 references in chart-time order; equal-time entries retain normalized IR order. */
  cues: ChartOptionCue[];
}

/**
 * Collect the resolved chart's authored option declarations and A6 triggers without guessing vendor semantics.
 * Resolve RANDOM/SWITCH first: branch ordering can change which initial options take effect.
 */
export function buildChartOptionTimeline(
  json: BeMusicJSON,
  timing: Pick<TimingResolver, 'eventToSeconds'> = createTimingResolver(json),
): ChartOptionTimeline {
  if (hasControlFlow(json)) throw new RangeError('Resolve BMS control flow before building a chart option timeline.');
  const initial = json.bms.options !== undefined ? [...json.bms.options] : json.bms.option ? [json.bms.option] : [];
  const base = resolveBMSBase(json);
  const cues: ChartOptionCue[] = [];
  for (const event of json.events) {
    if (normalizeChannel(event.channel) !== 'A6') continue;
    const key = normalizeObjectKey(event.value, base, json.sourceFormat === 'bmson');
    if (!key || key === '00') continue;
    const seconds = timing.eventToSeconds(event);
    if (!Number.isFinite(seconds)) continue;
    const declaration = json.bms.changeOption[key];
    cues.push({ seconds, key, ...(declaration !== undefined ? { declaration } : {}) });
  }
  cues.sort((left, right) => left.seconds - right.seconds);
  return { initial, cues };
}
