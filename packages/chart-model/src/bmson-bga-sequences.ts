import type { BeMusicJSON, BmsonBGAEvent } from '@be-music/chart-source';
import type { BGATimingResolver } from './bga.ts';

export interface ResolvedBmsonBGASequenceFrame {
  elapsedSeconds: number;
  /** Resolved header filename; undefined clears a missing image without borrowing another resource. */
  key?: string;
  end?: true;
}

export interface ResolvedBmsonBGASequence {
  id: number;
  frames: ResolvedBmsonBGASequenceFrame[];
}

/** A sequence selection; the engine supplies trigger times and a choice among alternatives. */
export interface BmsonBGAEventCue {
  seconds: number;
  /** NONSTOP stage ownership and exclusive end on the composed clock. */
  stage?: number;
  endSeconds?: number;
  /** Original ALWAYS start, retained when a stage begins partway through an animation. */
  animationStartSeconds?: number;
  /** Source seconds per composed second for movie playback. */
  playbackRate?: number;
  /** Freeze animation at a source timing reversal without extending the stage window. */
  freezeSeconds?: number;
  plane: 'layer' | 'poor';
  condition: 'always' | 'play' | 'miss';
  /** Authored event-start interval; the Be-Music controller interprets it as chart milliseconds, not pulses. */
  interval: number;
  sequences: ResolvedBmsonBGASequence[];
}

/**
 * Resolve beatoraja event-layer alternatives. Ordinary image-only layer events stay on the normal BGA timeline.
 * Sequence frame times are milliseconds; cue positions are bmson pulses resolved through the chart's BPM/STOP clock.
 * Engine consumers can include empty selections for ordinary layers, cancelling an older conditional program.
 */
export function buildBmsonBGAEventTimeline(
  chart: BeMusicJSON,
  resolver: Pick<BGATimingResolver, 'beatToSeconds'>,
  options: { includeOrdinaryLayerClears?: boolean } = {},
): BmsonBGAEventCue[] {
  const bga = chart.bmson.bga;
  const headers = new Map(bga.header.map((entry) => [entry.id, entry.name]));
  const definitions = new Map((bga.sequences ?? []).map((entry) => [entry.id, entry]));
  const authoredResolution = chart.bmson.info.resolution;
  const resolution =
    typeof authoredResolution === 'number' && Number.isFinite(authoredResolution) && authoredResolution > 0
      ? authoredResolution
      : 240;
  const resolve = (id: number): ResolvedBmsonBGASequence => {
    const definition = definitions.get(id);
    const frames: ResolvedBmsonBGASequenceFrame[] = definition
      ? definition.sequence.map((frame) => ({
          elapsedSeconds: frame.time / 1000,
          ...(frame.id === undefined || frame.id === -2147483648
            ? { end: true as const }
            : { key: bga.header[frame.id]?.name }),
        }))
      : [
          { elapsedSeconds: 0, key: headers.get(id) },
          { elapsedSeconds: 0.5, end: true },
        ];
    return { id, frames: frames.sort((left, right) => left.elapsedSeconds - right.elapsedSeconds) };
  };
  const cue = (event: BmsonBGAEvent, plane: 'layer' | 'poor'): BmsonBGAEventCue => ({
    seconds: resolver.beatToSeconds(event.y / resolution),
    plane,
    condition:
      plane === 'poor' ? 'miss' : event.condition === 'play' || event.condition === 'miss' ? event.condition : 'always',
    interval: plane === 'poor' ? 1 : (event.interval ?? 0),
    sequences: (plane === 'poor' ? [event.id] : (event.idSet ?? [event.id])).map(resolve),
  });
  return [
    ...bga.layerEvents.flatMap((event) => {
      const extended =
        event.idSet !== undefined ||
        event.condition !== undefined ||
        event.interval !== undefined ||
        definitions.has(event.id);
      if (extended) return [cue(event, 'layer')];
      return options.includeOrdinaryLayerClears ? [{ ...cue(event, 'layer'), sequences: [] }] : [];
    }),
    ...bga.poorEvents.map((event) => cue(event, 'poor')),
  ].sort((left, right) => left.seconds - right.seconds);
}

/** Latest authored frame at a caller-supplied sequence time. End markers stay ended until a fresh trigger. */
export function pickBmsonBGASequenceFrame(
  sequence: Readonly<ResolvedBmsonBGASequence>,
  elapsedSeconds: number,
): ResolvedBmsonBGASequenceFrame | undefined {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) return undefined;
  let active: ResolvedBmsonBGASequenceFrame | undefined;
  for (const frame of sequence.frames) {
    if (frame.elapsedSeconds > elapsedSeconds) break;
    if (frame.end) return undefined;
    active = frame;
  }
  return active;
}
