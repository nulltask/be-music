// The keep-pitch samples of a chart's bar auditions (`ChartPreviewEngine.playWindow`), stretched to the play tempo:
// the bar picked first, and in the background what every other bar sounds, nearest the bar picked first.

import { stretchAudioBuffers, type TimeStretchAlgorithm } from '../runtime/time-stretch.ts';

/** The tempo and stretcher a chart's samples are stretched for. */
export interface PreviewStretchSpec {
  /** The play tempo (`ChartPreviewWindow.tempo`): chart seconds pass this many times as fast. */
  readonly rate: number;
  readonly algorithm: TimeStretchAlgorithm;
}

/** A part of a sample, in its own seconds: `[startSeconds, endSeconds)`. */
export interface PreviewStretchSegment {
  readonly startSeconds: number;
  readonly endSeconds: number;
}

/** A bar a picker can audition, in chart seconds: `[startSeconds, endSeconds)`. */
export interface PreviewStretchBar {
  readonly startSeconds: number;
  readonly endSeconds: number;
}

/** A sample a bar audition sounds stretched: the whole of it, or (`segment`) the part the bar sounds. */
export interface PreviewStretchRequest {
  readonly path: string;
  readonly source: AudioBuffer;
  readonly segment?: PreviewStretchSegment;
}

/** A stretched sample, and where in the source sample it starts (0 for the whole sample). */
export interface PreviewStretchResult {
  readonly buffer: AudioBuffer;
  readonly segmentStart: number;
}

/** What the store keeps for one tempo and stretcher. */
interface StretchState {
  readonly spec: PreviewStretchSpec;
  /** Stretched or being stretched, by {@link requestKey}. */
  readonly stretched: Map<string, Promise<AudioBuffer | undefined>>;
  /** Whole samples stretched, by path: any part of them is taken from there. */
  readonly whole: Map<string, AudioBuffer>;
  /** The bars the background has done. */
  readonly doneBars: Set<string>;
  /** The bars the background still does, nearest the last bar picked first. */
  queue: PreviewStretchBar[];
  /** The background runs while true: a picker is open on the chart. */
  active: boolean;
}

/** Whether two specs stretch alike. */
function sameSpec(left: PreviewStretchSpec, right: PreviewStretchSpec): boolean {
  return left.rate === right.rate && left.algorithm === right.algorithm;
}

/** The key a request is kept under: its path, and its part for one of a long sample. */
function requestKey(request: Pick<PreviewStretchRequest, 'path' | 'segment'>): string {
  return request.segment === undefined
    ? request.path
    : `${request.path}\0${request.segment.startSeconds}-${request.segment.endSeconds}`;
}

function barKey(bar: PreviewStretchBar): string {
  return `${bar.startSeconds}-${bar.endSeconds}`;
}

/**
 * Pure helper: `bars` ordered for the background, nearest `aroundSeconds` first (by the distance from it to the bar,
 * 0 for the bar it lies in), ties in the order given.
 */
export function orderPreviewStretchBars<Bar extends PreviewStretchBar>(
  bars: readonly Bar[],
  aroundSeconds: number,
): Bar[] {
  const distance = (bar: PreviewStretchBar): number =>
    aroundSeconds < bar.startSeconds
      ? bar.startSeconds - aroundSeconds
      : aroundSeconds >= bar.endSeconds
        ? aroundSeconds - bar.endSeconds
        : 0;
  return bars
    .map((bar, index) => ({ bar, index, distance: distance(bar) }))
    .sort((left, right) => left.distance - right.distance || left.index - right.index)
    .map(({ bar }) => bar);
}

/**
 * The stretched samples of one chart's bar auditions. A bar picked has its samples stretched first, together. While
 * no bar waits, the background stretches what every other bar sounds, one sample at a time and nearest the last bar
 * picked first, so the bars after find theirs ready; each job is a bar's part of one sample, so a bar picked waits for
 * one such job at most. A new tempo or stretcher drops what was stretched and starts again.
 */
export class PreviewStretchStore {
  private readonly context: BaseAudioContext;
  private readonly requestsFor: (bar: PreviewStretchBar, spec: PreviewStretchSpec) => Promise<PreviewStretchRequest[]>;
  private readonly yieldToPage: () => Promise<void>;
  private state: StretchState | undefined;
  private bars: readonly PreviewStretchBar[] = [];
  private aroundSeconds = 0;
  private foreground = 0;
  private resumeBackground: (() => void) | undefined;
  private running = false;
  private disposed = false;

  /**
   * @param requestsFor What a bar sounds stretched at `spec` (its samples decoded).
   * @param yieldToPage Waits before the next background job, so the page's own work runs between them.
   */
  public constructor(
    context: BaseAudioContext,
    requestsFor: (bar: PreviewStretchBar, spec: PreviewStretchSpec) => Promise<PreviewStretchRequest[]>,
    yieldToPage: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 0)),
  ) {
    this.context = context;
    this.requestsFor = requestsFor;
    this.yieldToPage = yieldToPage;
  }

  /**
   * Stretches the bars for `spec` in the background from now on, nearest `aroundSeconds` first: a picker opened on the
   * chart, a tempo changed in one, or a bar picked. `bars` replaces the bars to do; absent keeps the last. A spec other
   * than the last drops what was stretched for it. `undefined` stops the background and keeps what was stretched.
   */
  public prepare(
    spec: PreviewStretchSpec | undefined,
    bars?: readonly PreviewStretchBar[],
    aroundSeconds: number = this.aroundSeconds,
  ): void {
    if (this.disposed) return;
    if (bars !== undefined) this.bars = bars;
    this.aroundSeconds = aroundSeconds;
    if (spec === undefined) {
      if (this.state !== undefined) this.state.active = false;
      return;
    }
    const state = this.stateFor(spec);
    state.active = true;
    state.queue = orderPreviewStretchBars(
      this.bars.filter((bar) => !state.doneBars.has(barKey(bar))),
      aroundSeconds,
    );
    void this.runBackground();
  }

  /**
   * The samples a bar sounds, stretched for `spec`, in the order asked for: a part of a sample whose whole is
   * stretched comes from there; what is not stretched yet goes to the stretcher together, ahead of the background,
   * which waits meanwhile. `undefined` for a sample the stretcher cannot take.
   */
  public async stretch(
    spec: PreviewStretchSpec,
    requests: readonly PreviewStretchRequest[],
  ): Promise<(PreviewStretchResult | undefined)[]> {
    const state = this.stateFor(spec);
    this.foreground += 1;
    try {
      const pending = requests.filter(
        (request) => !state.whole.has(request.path) && !state.stretched.has(requestKey(request)),
      );
      // Duplicates of one key go once.
      const unique = [...new Map(pending.map((request) => [requestKey(request), request])).values()];
      if (unique.length > 0) void this.startStretch(state, unique);
      const buffers = await Promise.all(
        requests.map((request) => {
          const whole = state.whole.get(request.path);
          return whole !== undefined ? Promise.resolve(whole) : state.stretched.get(requestKey(request))!;
        }),
      );
      return buffers.map((buffer, index) => {
        if (buffer === undefined) return undefined;
        const request = requests[index]!;
        const whole = state.whole.get(request.path) === buffer;
        return { buffer, segmentStart: whole ? 0 : (request.segment?.startSeconds ?? 0) };
      });
    } finally {
      this.foreground -= 1;
      if (this.foreground === 0) {
        const resume = this.resumeBackground;
        this.resumeBackground = undefined;
        resume?.();
      }
    }
  }

  /** Stops the background for good. */
  public dispose(): void {
    this.disposed = true;
    if (this.state !== undefined) this.state.active = false;
    this.resumeBackground?.();
    this.resumeBackground = undefined;
  }

  /** The state for `spec`: the current one, or a fresh one in its place. */
  private stateFor(spec: PreviewStretchSpec): StretchState {
    if (this.state !== undefined && sameSpec(this.state.spec, spec)) return this.state;
    if (this.state !== undefined) this.state.active = false;
    this.state = { spec, stretched: new Map(), whole: new Map(), doneBars: new Set(), queue: [], active: false };
    return this.state;
  }

  /** Sends `requests` to the stretcher in one call and keeps each result under its key. */
  private startStretch(state: StretchState, requests: readonly PreviewStretchRequest[]): Promise<unknown> {
    const parts = requests.map(({ source, segment }) =>
      segment === undefined ? source : sliceAudioBuffer(this.context, source, segment),
    );
    const batch: Promise<(AudioBuffer | undefined)[]> = this.disposed
      ? Promise.resolve(parts.map(() => undefined))
      : stretchAudioBuffers(this.context, parts, state.spec.rate, state.spec.algorithm).catch(
          // Samples the stretcher cannot take play at the tempo, their pitch following.
          () => parts.map(() => undefined),
        );
    requests.forEach((request, index) => {
      const promise = batch.then((stretched) => {
        const buffer = stretched[index];
        if (buffer !== undefined && request.segment === undefined) state.whole.set(request.path, buffer);
        return buffer;
      });
      state.stretched.set(requestKey(request), promise);
    });
    return batch;
  }

  /** Does the queued bars, a sample at a time, while no bar waits and the state stays current. */
  private async runBackground(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const state = this.state;
        if (this.disposed || state === undefined || !state.active || state.queue.length === 0) return;
        const bar = state.queue.shift()!;
        if (state.doneBars.has(barKey(bar))) continue;
        const requests = await this.requestsFor(bar, state.spec);
        let finished = true;
        for (const request of requests) {
          if (this.foreground > 0)
            await new Promise<void>((resolve) => {
              this.resumeBackground = resolve;
            });
          if (this.disposed || this.state !== state || !state.active) {
            finished = false;
            break;
          }
          if (state.whole.has(request.path) || state.stretched.has(requestKey(request))) continue;
          await this.startStretch(state, [request]);
          await this.yieldToPage();
        }
        if (finished) state.doneBars.add(barKey(bar));
      }
    } finally {
      this.running = false;
    }
  }
}

/** The part `segment` of `buffer`, in its own seconds, as a buffer of its own. */
export function sliceAudioBuffer(
  context: BaseAudioContext,
  buffer: AudioBuffer,
  segment: PreviewStretchSegment,
): AudioBuffer {
  const from = Math.max(0, Math.floor(segment.startSeconds * buffer.sampleRate));
  const to = Math.min(buffer.length, Math.max(from + 1, Math.ceil(segment.endSeconds * buffer.sampleRate)));
  const part = context.createBuffer(buffer.numberOfChannels, to - from, buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1)
    part.copyToChannel(buffer.getChannelData(channel).subarray(from, to), channel);
  return part;
}
