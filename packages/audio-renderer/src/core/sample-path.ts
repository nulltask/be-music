import { extname } from 'node:path';
import { resolveFirstExistingPath } from '@be-music/utils';

export async function resolveSamplePath(
  baseDir: string,
  samplePath: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  return resolveFirstExistingPath(baseDir, createSamplePathCandidates(samplePath), signal);
}

/**
 * Builds the codec-fallback candidate list for a chart-declared
 * sample path. Exported so callers (and tests) can inspect the
 * walk order — the bmson 1.0.0 spec mandates that `.m4a` is
 * part of the chain, and lock-in tests pin the sequencing to
 * prevent regressions.
 */
export function createSamplePathCandidates(samplePath: string): string[] {
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

  const basePaths = [samplePath];
  const slashNormalized = samplePath.replaceAll('\\', '/');
  if (slashNormalized !== samplePath) {
    basePaths.push(slashNormalized);
  }

  for (const basePath of basePaths) {
    appendSampleCandidatesByRule(basePath, push);
  }

  return candidates;
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
    // bmson 1.0.0 spec example explicitly lists `.m4a` (AAC) as
    // a fallback codec, so treat it as a first-class entry: try
    // m4a, then walk the rest of the codec list for the case
    // where the chart authors `.m4a` but the disk only has a
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

  // Extension omitted or unknown: wav -> mp3 -> ogg -> opus -> m4a.
  // The bmson 1.0.0 spec calls out `.m4a` (AAC) explicitly in
  // its extensionless-name example ("Try piano.wav, piano.ogg,
  // piano.m4a, …"), so we include it here and in the with-
  // extension branches above.
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
