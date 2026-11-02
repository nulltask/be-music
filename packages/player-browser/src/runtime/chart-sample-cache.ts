/**
 * The decoded samples of the chart played last, kept so a quick retry (F5, R on the result) skips decoding them
 * again ([#953](https://github.com/nulltask/be-music/issues/953)). The audio service owns one
 * ({@link AudioService.chartSamples}); `chart/play-audio.ts` reads and fills it as a play loads.
 *
 * - **One chart.** The cache holds the samples of one chart at most. A play of another chart (or of the same chart from
 *   another source, with another `#PATH_WAV` or at another context sample rate) releases them before it decodes its
 *   own, so two charts' PCM is never held for the cache.
 * - **Raw decodes only.** It keeps what `decodeAudioData` returned, per declared `#WAV` path. What depends on the play's
 *   options (keep-pitch stretching, `#WAVCMD` / `#EXWAV` effects, peak gain) is made afresh from them by every play,
 *   and nothing may change a cached buffer in place.
 * - **This play's samples.** A play that finished loading keeps only the paths it used ({@link ChartSampleLease.retain}),
 *   so a `#RANDOM` branch drawn differently does not grow the cache past one play's samples.
 * - **Released** by {@link ChartSampleCache.release}: the web player calls it on going back to the select screen and on
 *   `pagehide`, and the service's `dispose()` does too.
 */

/** What a chart's decoded samples depend on. Two plays reuse samples only when every field matches. */
export interface ChartSampleCacheKey {
  /** The chart's files (`BrowserAssetSource`), by identity: dropping the folder again makes a new source. */
  readonly source: object;
  /** The chart file's path in `source`, which the `#WAV` paths resolve against. */
  readonly chartPath: string;
  /** `#PATH_WAV`, which the resolver tries first. */
  readonly pathPrefix: string | undefined;
  /** The play context's sample rate: `decodeAudioData` resamples to it. */
  readonly sampleRate: number;
}

/** One decoded `#WAV` path. */
export interface CachedChartSample {
  /** The PCM as `decodeAudioData` returned it. Never changed in place. */
  readonly buffer: AudioBuffer;
  /** The encoded file's own rate, read for an `#EXWAV` frequency (`readNativeAudioSampleRate`), when it was read. */
  readonly nativeSampleRate?: number;
}

/** One play's view of the cache, from {@link ChartSampleCache.claim}. It stops reading and writing once released. */
export interface ChartSampleLease {
  /** Whether the cache already held this chart's samples when the play claimed it. */
  readonly reused: boolean;
  /** The cached decode of `path`, or `undefined`. */
  get(path: string): CachedChartSample | undefined;
  /** Keeps the decode of `path`. Does nothing once the lease is stale (released, or another chart claimed the cache). */
  set(path: string, sample: CachedChartSample): void;
  /** Whether `buffer` is held by the cache now, so a play must copy it before changing it in place. */
  holds(buffer: AudioBuffer): boolean;
  /** Drops every cached path but `paths`: what the play that finished loading used. */
  retain(paths: Iterable<string>): void;
}

export interface ChartSampleCache {
  /**
   * Claims the cache for a play of the chart `key` names. The same chart keeps its samples; any other releases them
   * first. The previous lease goes stale either way, so a play still loading cannot write into the next one's cache.
   */
  claim(key: ChartSampleCacheKey): ChartSampleLease;
  /** Lets go of the samples held, if any. */
  release(): void;
  /** The chart held, or `undefined` when the cache is empty. */
  readonly key: ChartSampleCacheKey | undefined;
  /** How many decoded paths are held. */
  readonly size: number;
}

/** Whether two keys name the same decode: the same source (by identity), chart path, `#PATH_WAV` and sample rate. */
export function isSameChartSampleKey(a: ChartSampleCacheKey, b: ChartSampleCacheKey): boolean {
  return (
    a.source === b.source &&
    a.chartPath === b.chartPath &&
    a.pathPrefix === b.pathPrefix &&
    a.sampleRate === b.sampleRate
  );
}

/** Creates an empty one-chart sample cache. */
export function createChartSampleCache(): ChartSampleCache {
  let key: ChartSampleCacheKey | undefined;
  let samples = new Map<string, CachedChartSample>();
  let buffers = new Set<AudioBuffer>();
  /** Bumped by every claim and release; a lease reads and writes only while it is the current one. */
  let generation = 0;

  function release(): void {
    generation += 1;
    key = undefined;
    samples = new Map();
    buffers = new Set();
  }

  return {
    claim(next) {
      const reused = key !== undefined && isSameChartSampleKey(key, next) && samples.size > 0;
      if (key === undefined || !isSameChartSampleKey(key, next)) release();
      generation += 1;
      key = next;
      const leaseGeneration = generation;
      const current = (): boolean => leaseGeneration === generation;
      return {
        reused,
        get(path) {
          return current() ? samples.get(path) : undefined;
        },
        set(path, sample) {
          if (!current()) return;
          samples.set(path, sample);
          buffers.add(sample.buffer);
        },
        holds(buffer) {
          // Not tied to the lease: a stale lease of the same chart still shares these buffers.
          return buffers.has(buffer);
        },
        retain(paths) {
          if (!current()) return;
          const keep = new Set(paths);
          const kept = new Map<string, CachedChartSample>();
          for (const [path, sample] of samples) if (keep.has(path)) kept.set(path, sample);
          samples = kept;
          buffers = new Set([...kept.values()].map((sample) => sample.buffer));
        },
      };
    },
    release,
    get key() {
      return key;
    },
    get size() {
      return samples.size;
    },
  };
}
