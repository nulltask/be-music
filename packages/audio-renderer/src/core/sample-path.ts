import { extname } from '@be-music/utils/core';
import { resolveFirstExistingPath } from '@be-music/utils/path';

export interface ResolveSamplePathOptions {
  /**
   * BMS spec — `#PATH_WAV <prefix>` declares a directory the chart's WAVs live under, e.g. `wav/` so that `#WAV01
   * kick.wav` resolves to `wav/kick.wav` on disk. The resolver tries the `pathPrefix`-joined form first and falls back
   * to the bare path so charts that omit `#PATH_WAV` (or mix conventions) keep working.
   */
  pathPrefix?: string;
}

export async function resolveSamplePath(
  baseDir: string,
  samplePath: string,
  signal?: AbortSignal,
  options: ResolveSamplePathOptions = {},
): Promise<string | undefined> {
  return resolveFirstExistingPath(baseDir, createSamplePathCandidates(samplePath, options), signal);
}

/**
 * Builds the codec-fallback candidate list for a chart-declared sample path. Exported so callers (and tests) can
 * inspect the walk order — the bmson 1.0.0 spec mandates that `.m4a` is part of the chain, and lock-in tests pin the
 * sequencing to prevent regressions.
 *
 * When `options.pathPrefix` is set (typically `chart.bms.pathWav`), the prefixed candidates are tried *before* the bare
 * ones so a chart that authors `#PATH_WAV wav/` with `#WAV01 kick.wav` resolves to `wav/kick.wav` first, falling
 * through to `kick.wav` when the chart's path-wav layout doesn't match.
 */
export function createSamplePathCandidates(samplePath: string, options: ResolveSamplePathOptions = {}): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];

  const push = (value: string): void => {
    const normalized = value.trim();
    if (normalized.length === 0 || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    candidates.push(normalized);
  };

  const basePaths: string[] = [];
  const slashNormalizedSample = samplePath.replaceAll('\\', '/');
  // `#PATH_WAV` prefix-joined variants come first so a chart with `wav/` layout resolves through its declared directory
  // before the bare-name fallback. Skip the prefix entirely when blank / null-safe — empty `#PATH_WAV` is treated as
  // "no prefix" by hitkey BMS Memo.
  const prefixed = joinPathWavPrefix(options.pathPrefix, samplePath);
  if (prefixed !== undefined) {
    basePaths.push(prefixed);
    const slashNormalized = prefixed.replaceAll('\\', '/');
    if (slashNormalized !== prefixed) {
      basePaths.push(slashNormalized);
    }
  }
  basePaths.push(samplePath);
  if (slashNormalizedSample !== samplePath) {
    basePaths.push(slashNormalizedSample);
  }

  for (const basePath of basePaths) {
    appendSampleCandidatesByRule(basePath, push);
  }

  return candidates;
}

function joinPathWavPrefix(prefix: string | undefined, samplePath: string): string | undefined {
  if (typeof prefix !== 'string') return undefined;
  const trimmedPrefix = prefix.trim();
  if (trimmedPrefix.length === 0) return undefined;
  // Skip when the chart already includes the prefix in the sample path — common when a chart pulls samples from a
  // sub-folder explicitly via `#WAV01 wav/kick.wav` AND sets `#PATH_WAV wav/`. Returning `undefined` here keeps the
  // regular candidate list (without the second prefix application) and the bare path still resolves correctly.
  const normalizedPrefix = trimmedPrefix.replaceAll('\\', '/');
  const normalizedSample = samplePath.replaceAll('\\', '/');
  const prefixWithSep = normalizedPrefix.endsWith('/') ? normalizedPrefix : `${normalizedPrefix}/`;
  if (normalizedSample.startsWith(prefixWithSep)) {
    return undefined;
  }
  return `${prefixWithSep}${samplePath}`;
}

function appendSampleCandidatesByRule(samplePath: string, push: (candidatePath: string) => void): void {
  push(samplePath);

  const extension = extname(samplePath).toLowerCase();
  const withoutExtension = extension.length > 0 ? samplePath.slice(0, -extension.length) : samplePath;

  if (extension === '.mp3') {
    // If .mp3 is explicitly specified, try mp3 first and then fallback to ogg/opus/m4a.
    push(`${withoutExtension}.mp3`);
    push(`${withoutExtension}.MP3`);
    push(`${withoutExtension}.ogg`);
    push(`${withoutExtension}.OGG`);
    push(`${withoutExtension}.oga`);
    push(`${withoutExtension}.OGA`);
    push(`${withoutExtension}.opus`);
    push(`${withoutExtension}.OPUS`);
    push(`${withoutExtension}.m4a`);
    push(`${withoutExtension}.M4A`);
    return;
  }

  if (extension === '.wav') {
    // If .wav is specified but not found, fallback to mp3 -> ogg -> opus -> m4a.
    push(`${withoutExtension}.wav`);
    push(`${withoutExtension}.WAV`);
    push(`${withoutExtension}.mp3`);
    push(`${withoutExtension}.MP3`);
    push(`${withoutExtension}.ogg`);
    push(`${withoutExtension}.OGG`);
    push(`${withoutExtension}.oga`);
    push(`${withoutExtension}.OGA`);
    push(`${withoutExtension}.opus`);
    push(`${withoutExtension}.OPUS`);
    push(`${withoutExtension}.m4a`);
    push(`${withoutExtension}.M4A`);
    return;
  }

  if (extension === '.ogg' || extension === '.oga') {
    push(`${withoutExtension}.ogg`);
    push(`${withoutExtension}.OGG`);
    push(`${withoutExtension}.oga`);
    push(`${withoutExtension}.OGA`);
    push(`${withoutExtension}.opus`);
    push(`${withoutExtension}.OPUS`);
    push(`${withoutExtension}.m4a`);
    push(`${withoutExtension}.M4A`);
    return;
  }

  if (extension === '.opus') {
    push(`${withoutExtension}.opus`);
    push(`${withoutExtension}.OPUS`);
    push(`${withoutExtension}.ogg`);
    push(`${withoutExtension}.OGG`);
    push(`${withoutExtension}.oga`);
    push(`${withoutExtension}.OGA`);
    push(`${withoutExtension}.m4a`);
    push(`${withoutExtension}.M4A`);
    return;
  }

  if (extension === '.m4a') {
    // bmson 1.0.0 spec example explicitly lists `.m4a` (AAC) as a fallback codec, so treat it as a first-class entry:
    // try m4a, then walk the rest of the codec list for the case where the chart authors `.m4a` but the disk only has a
    // re-encoded variant.
    push(`${withoutExtension}.m4a`);
    push(`${withoutExtension}.M4A`);
    push(`${withoutExtension}.ogg`);
    push(`${withoutExtension}.OGG`);
    push(`${withoutExtension}.oga`);
    push(`${withoutExtension}.OGA`);
    push(`${withoutExtension}.opus`);
    push(`${withoutExtension}.OPUS`);
    push(`${withoutExtension}.mp3`);
    push(`${withoutExtension}.MP3`);
    return;
  }

  // Extension omitted or unknown: wav -> mp3 -> ogg -> opus -> m4a. The bmson 1.0.0 spec calls out `.m4a` (AAC)
  // explicitly in its extensionless-name example ("Try piano.wav, piano.ogg, piano.m4a, …"), so we include it here and
  // in the with- extension branches above.
  push(`${withoutExtension}.wav`);
  push(`${withoutExtension}.WAV`);
  push(`${withoutExtension}.mp3`);
  push(`${withoutExtension}.MP3`);
  push(`${withoutExtension}.ogg`);
  push(`${withoutExtension}.OGG`);
  push(`${withoutExtension}.oga`);
  push(`${withoutExtension}.OGA`);
  push(`${withoutExtension}.opus`);
  push(`${withoutExtension}.OPUS`);
  push(`${withoutExtension}.m4a`);
  push(`${withoutExtension}.M4A`);
}
