import type { BrowserSongAssetSource } from './types.ts';

export interface BrowserResolvedSampleFile {
  path: string;
  bytes: Uint8Array;
}

export interface BrowserSourceFileLookup {
  files: ReadonlyMap<string, Uint8Array>;
  resolve: (path: string) => BrowserResolvedSampleFile | undefined;
}

export function createBrowserSourceFileLookup(files: ReadonlyMap<string, Uint8Array>): BrowserSourceFileLookup {
  const caseInsensitivePathMap = new Map<string, string>();
  for (const path of files.keys()) {
    caseInsensitivePathMap.set(path.toLowerCase(), path);
  }

  return {
    files,
    resolve: (path: string) => {
      const normalized = normalizePath(path);
      const actualPath = files.has(normalized) ? normalized : caseInsensitivePathMap.get(normalized.toLowerCase());
      if (!actualPath) {
        return undefined;
      }
      const bytes = files.get(actualPath);
      return bytes ? { path: actualPath, bytes } : undefined;
    },
  };
}

export function resolveBrowserSampleFile(
  source: BrowserSongAssetSource | BrowserSourceFileLookup,
  chartPath: string,
  samplePath: string,
): BrowserResolvedSampleFile | undefined {
  const lookup = isBrowserSourceFileLookup(source) ? source : createBrowserSourceFileLookup(source.files);
  const baseDirectory = dirnameOf(chartPath);

  for (const candidate of createBrowserSamplePathCandidates(samplePath)) {
    const relativeCandidate = baseDirectory === '.' ? candidate : normalizePath(`${baseDirectory}/${candidate}`);
    const resolvedRelative = lookup.resolve(relativeCandidate);
    if (resolvedRelative) {
      return resolvedRelative;
    }

    const resolvedAbsoluteLike = lookup.resolve(candidate);
    if (resolvedAbsoluteLike) {
      return resolvedAbsoluteLike;
    }
  }

  return undefined;
}

export function createBrowserSamplePathCandidates(samplePath: string): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];

  const push = (value: string): void => {
    const normalized = normalizePath(value.trim());
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

function isBrowserSourceFileLookup(value: BrowserSongAssetSource | BrowserSourceFileLookup): value is BrowserSourceFileLookup {
  return 'resolve' in value;
}

function appendSampleCandidatesByRule(samplePath: string, push: (candidatePath: string) => void): void {
  push(samplePath);

  const extension = extensionOf(samplePath).toLowerCase();
  const withoutExtension = extension.length > 0 ? samplePath.slice(0, -extension.length) : samplePath;

  if (extension === '.mp3') {
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

function dirnameOf(path: string): string {
  const normalized = normalizePath(path);
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex >= 0 ? normalized.slice(0, slashIndex) : '.';
}

function extensionOf(path: string): string {
  const slashIndex = path.lastIndexOf('/');
  const dotIndex = path.lastIndexOf('.');
  return dotIndex > slashIndex ? path.slice(dotIndex) : '';
}

function normalizePath(path: string): string {
  const normalizedSlashes = path.replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
  const segments = normalizedSlashes.split('/');
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment.length === 0 || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (resolved.length > 0) {
        resolved.pop();
      }
      continue;
    }
    resolved.push(segment);
  }
  return resolved.join('/');
}
