/**
 * The decoded samples of the chart played last, kept so a quick retry (F5, R on the result) and a play of another chart
 * of the same track (NORMAL → HYPER) skip decoding them again ([#953](https://github.com/nulltask/be-music/issues/953)).
 * The audio service owns one ({@link AudioService.chartSamples}); `chart/play-audio.ts` reads and fills it as a play
 * loads.
 *
 * - **By file.** A decode is kept per audio file of the chart's source (`BrowserAssetEntry`, by identity): the file a
 *   `#WAV` path resolves to, through the chart's folder, `#PATH_WAV` and the codec fallbacks. Two charts share a decode
 *   only when their paths resolve to the very same file, so a same-named file in another folder, or another `#PATH_WAV`,
 *   never does.
 * - **One play's samples.** A play claims the cache with every file it may sound
 *   ({@link ChartSampleCache.claim}); what it does not name goes before it decodes, so the cache never holds more than
 *   one play's samples, and a `#RANDOM` branch drawn differently does not grow it.
 * - **One source and sample rate.** A play from another source (a dropped folder or archive; dropping the folder again
 *   makes a new one) or at another context sample rate (`decodeAudioData` resamples to it) releases everything first.
 * - **Raw decodes only.** It keeps what `decodeAudioData` returned. What depends on the play's options (keep-pitch
 *   stretching, `#WAVCMD` / `#EXWAV` effects, peak gain) is made afresh from them by every play, and nothing may change
 *   a cached buffer in place.
 * - **Released** by {@link ChartSampleCache.release}, and by {@link ChartSampleCache.keepTrackOf} once the select screen
 *   focuses a chart of another track. The service's `dispose()` releases it, and the web player does on `pagehide`.
 */

/** What every decode of the cache depends on, and the chart that claimed it. */
export interface ChartSampleCacheKey {
  /** The chart's files (`BrowserAssetSource`), by identity. */
  readonly source: object;
  /** The chart file's path in `source`. Its folder is the track's ({@link ChartSampleCache.keepTrackOf}). */
  readonly chartPath: string;
  /** The play context's sample rate: `decodeAudioData` resamples to it. */
  readonly sampleRate: number;
}

/** One decoded audio file. */
export interface CachedChartSample {
  /** The PCM as `decodeAudioData` returned it. Never changed in place. */
  readonly buffer: AudioBuffer;
  /** The encoded file's own rate, read for an `#EXWAV` frequency (`readNativeAudioSampleRate`), when it was read. */
  readonly nativeSampleRate?: number;
}

/** One play's view of the cache, from {@link ChartSampleCache.claim}. It stops reading and writing once released. */
export interface ChartSampleLease {
  /** How many of the files the play claimed the cache already held. */
  readonly reused: number;
  /** The cached decode of `file`, or `undefined`. */
  get(file: object): CachedChartSample | undefined;
  /**
   * Keeps the decode of `file`. Does nothing once the lease is stale (released, or another play claimed the cache), or
   * for a file the claim did not name.
   */
  set(file: object, sample: CachedChartSample): void;
  /** Whether `buffer` is held by the cache now, so a play must copy it before changing it in place. */
  holds(buffer: AudioBuffer): boolean;
}

export interface ChartSampleCache {
  /**
   * Claims the cache for a play of the chart `key` names, which may sound `files`. The decodes of `files` it holds stay
   * for the play; every other one goes first, as does everything when the source or sample rate differs. The previous
   * lease goes stale either way, so a play still loading cannot write into the next one's cache.
   */
  claim(key: ChartSampleCacheKey, files: Iterable<object>): ChartSampleLease;
  /**
   * Keeps the samples only while the chart in focus (`source`, `chartPath`) is of the track that claimed the cache: the
   * same source and the same folder. Any other chart, or none, releases them.
   */
  keepTrackOf(source: object | undefined, chartPath: string | undefined): void;
  /** Lets go of the samples held, if any. */
  release(): void;
  /** The chart that claimed the cache last, or `undefined` when the cache is empty. */
  readonly key: ChartSampleCacheKey | undefined;
  /** How many decoded files are held. */
  readonly size: number;
}

/** Whether a decode for `a` serves `b`: the same source (by identity) and context sample rate. */
export function isSameChartSampleSource(
  a: Pick<ChartSampleCacheKey, 'source' | 'sampleRate'>,
  b: Pick<ChartSampleCacheKey, 'source' | 'sampleRate'>,
): boolean {
  return a.source === b.source && a.sampleRate === b.sampleRate;
}

/**
 * Pure helper: the track folder of a chart path, the part before its last `/` or `\` (`''` at the root of its source).
 * Charts of one track sit side by side in it.
 */
export function chartTrackFolder(chartPath: string): string {
  const slash = Math.max(chartPath.lastIndexOf('/'), chartPath.lastIndexOf('\\'));
  return slash < 0 ? '' : chartPath.slice(0, slash).toLowerCase();
}

/** Creates an empty sample cache. */
export function createChartSampleCache(): ChartSampleCache {
  let key: ChartSampleCacheKey | undefined;
  let samples = new Map<object, CachedChartSample>();
  let claimed = new Set<object>();
  let buffers = new Set<AudioBuffer>();
  /** Bumped by every claim and release; a lease reads and writes only while it is the current one. */
  let generation = 0;

  function release(): void {
    generation += 1;
    key = undefined;
    samples = new Map();
    claimed = new Set();
    buffers = new Set();
  }

  return {
    claim(next, files) {
      if (key === undefined || !isSameChartSampleSource(key, next)) release();
      const wanted = new Set(files);
      const kept = new Map<object, CachedChartSample>();
      for (const [file, sample] of samples) if (wanted.has(file)) kept.set(file, sample);
      samples = kept;
      buffers = new Set([...kept.values()].map((sample) => sample.buffer));
      claimed = wanted;
      generation += 1;
      key = next;
      const leaseGeneration = generation;
      const current = (): boolean => leaseGeneration === generation;
      return {
        reused: kept.size,
        get(file) {
          return current() ? samples.get(file) : undefined;
        },
        set(file, sample) {
          if (!current() || !claimed.has(file)) return;
          samples.set(file, sample);
          buffers.add(sample.buffer);
        },
        holds(buffer) {
          // Not tied to the lease: a stale lease of the same track still shares these buffers.
          return buffers.has(buffer);
        },
      };
    },
    keepTrackOf(source, chartPath) {
      if (key === undefined) return;
      if (
        source === key.source &&
        chartPath !== undefined &&
        chartTrackFolder(chartPath) === chartTrackFolder(key.chartPath)
      )
        return;
      release();
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
