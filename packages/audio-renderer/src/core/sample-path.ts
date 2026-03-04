import { access } from 'node:fs/promises';
import { extname, isAbsolute, resolve } from 'node:path';

export async function resolveSamplePath(
  baseDir: string,
  samplePath: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const candidates = createSamplePathCandidates(samplePath);

  for (const candidate of candidates) {
    throwIfAborted(signal);
    const absolute = isAbsolute(candidate) ? candidate : resolve(baseDir, candidate);
    if (await exists(absolute)) {
      return absolute;
    }
  }

  return undefined;
}

function createSamplePathCandidates(samplePath: string): string[] {
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
    // If .mp3 is explicitly specified, try mp3 first and then fallback to ogg/opus.
    push(`${withoutExtension}.mp3`);
    push(`${withoutExtension}.MP3`);
    push(`${withoutExtension}.ogg`);
    push(`${withoutExtension}.OGG`);
    push(`${withoutExtension}.oga`);
    push(`${withoutExtension}.OGA`);
    push(`${withoutExtension}.opus`);
    push(`${withoutExtension}.OPUS`);
    return;
  }

  if (extension === '.wav') {
    // If .wav is specified but not found, fallback to mp3 -> ogg -> opus.
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
    return;
  }

  if (extension === '.ogg' || extension === '.oga') {
    push(`${withoutExtension}.ogg`);
    push(`${withoutExtension}.OGG`);
    push(`${withoutExtension}.oga`);
    push(`${withoutExtension}.OGA`);
    push(`${withoutExtension}.opus`);
    push(`${withoutExtension}.OPUS`);
    return;
  }

  if (extension === '.opus') {
    push(`${withoutExtension}.opus`);
    push(`${withoutExtension}.OPUS`);
    push(`${withoutExtension}.ogg`);
    push(`${withoutExtension}.OGG`);
    push(`${withoutExtension}.oga`);
    push(`${withoutExtension}.OGA`);
    return;
  }

  // Extension omitted or unknown: wav -> mp3 -> ogg -> opus.
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
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  throw error;
}
