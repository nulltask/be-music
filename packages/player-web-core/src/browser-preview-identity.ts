import type { BeMusicJson } from '@be-music/json';
import type { BrowserSongAssetSource } from './types.ts';
import { collectBrowserSampleTriggers } from './browser-sample-triggers.ts';
import { resolveBrowserSampleFile, type BrowserResolvedSampleFile } from './browser-sample-path.ts';
import { createTimingResolver } from './timing.ts';

export interface BrowserFallbackPreviewIdentity {
  continueKey: string;
  startSeconds: number;
}

interface BrowserFallbackSignaturePayload {
  sourceFormat: string;
  baseBpm: number;
  tempoPoints: Array<[beat: number, bpm: number, seconds: number]>;
  stopPoints: Array<[beat: number, seconds: number]>;
  triggers: Array<
    [
      seconds: number,
      beat: number,
      sampleKey: string,
      samplePath: string,
      sampleOffsetSeconds: number,
      sampleDurationSeconds?: number,
      sampleSliceId?: string,
    ]
  >;
}

export function resolveBrowserPreviewContinueKey(
  chart: BeMusicJson,
  source: BrowserSongAssetSource,
  chartPath: string,
): string | undefined {
  const previewSampleFile = resolveBrowserPreviewSampleFile(chart, source, chartPath);
  if (previewSampleFile) {
    return normalizePreviewContinueKey(previewSampleFile.path);
  }
  return resolveBrowserFallbackPreviewIdentity(chart)?.continueKey;
}

export function resolveBrowserPreviewSampleFile(
  chart: BeMusicJson,
  source: BrowserSongAssetSource,
  chartPath: string,
): BrowserResolvedSampleFile | undefined {
  const previewPath = chart.bms.preview;
  if (typeof previewPath !== 'string' || previewPath.trim().length === 0) {
    return undefined;
  }

  for (const candidate of createPreviewPathCandidates(chart, previewPath)) {
    const resolved = resolveBrowserSampleFile(source, chartPath, candidate);
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}

export function resolveBrowserFallbackPreviewIdentity(
  chart: BeMusicJson,
): BrowserFallbackPreviewIdentity | undefined {
  const resolver = createTimingResolver(chart);
  const triggers = collectBrowserSampleTriggers(chart, resolver, {
    inferBmsLnTypeWhenMissing: true,
  });
  if (triggers.length === 0) {
    return undefined;
  }
  const firstTriggerSeconds = Math.max(
    0,
    triggers.reduce((minimum, trigger) => Math.min(minimum, trigger.seconds), Number.POSITIVE_INFINITY),
  );
  if (!Number.isFinite(firstTriggerSeconds)) {
    return undefined;
  }

  const payload: BrowserFallbackSignaturePayload = {
    sourceFormat: chart.sourceFormat,
    baseBpm: chart.metadata.bpm,
    tempoPoints: resolver.tempoPoints.map((point) => [point.beat, point.bpm, point.seconds]),
    stopPoints: resolver.stopPoints.map((point) => [point.beat, point.seconds]),
    triggers: triggers.map((trigger) => [
      trigger.seconds,
      trigger.beat,
      trigger.sampleKey,
      trigger.samplePath ?? '',
      trigger.sampleOffsetSeconds,
      trigger.sampleDurationSeconds,
      trigger.sampleSliceId,
    ]),
  };

  return {
    continueKey: computeFallbackContinueKey(payload),
    startSeconds: firstTriggerSeconds,
  };
}

function computeFallbackContinueKey(payload: BrowserFallbackSignaturePayload): string {
  const encodeSignatureNumber = (value: number | undefined): string => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return '-';
    }
    return `${Math.round(value * 1_000_000)}`;
  };
  const normalizePath = (value: string | undefined): string => (value ?? '').replaceAll('\\', '/');
  const fnv1a64Hex = (value: string, seed: bigint): string => {
    let hash = seed;
    const prime = 0x100000001b3n;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= BigInt(value.charCodeAt(index));
      hash = BigInt.asUintN(64, hash * prime);
    }
    return hash.toString(16).padStart(16, '0');
  };

  const lines: string[] = [];
  lines.push('browser-fallback-preview-signature-v1');
  lines.push(`source:${payload.sourceFormat}`);
  lines.push(`baseBpm:${encodeSignatureNumber(payload.baseBpm)}`);
  for (const [beat, bpm, seconds] of payload.tempoPoints) {
    lines.push(`tempo:${encodeSignatureNumber(beat)}:${encodeSignatureNumber(bpm)}:${encodeSignatureNumber(seconds)}`);
  }
  for (const [beat, seconds] of payload.stopPoints) {
    lines.push(`stop:${encodeSignatureNumber(beat)}:${encodeSignatureNumber(seconds)}`);
  }
  const normalizedTriggers = payload.triggers
    .map(
      ([seconds, beat, sampleKey, samplePath, sampleOffsetSeconds, sampleDurationSeconds, sampleSliceId]) =>
        `trigger:${encodeSignatureNumber(seconds)}:${encodeSignatureNumber(beat)}:${sampleKey}:${normalizePath(samplePath)}:${encodeSignatureNumber(sampleOffsetSeconds)}:${encodeSignatureNumber(sampleDurationSeconds)}:${sampleSliceId ?? ''}`,
    )
    .sort();
  for (const line of normalizedTriggers) {
    lines.push(line);
  }
  const serialized = `${lines.join('\n')}\n`;
  const primary = fnv1a64Hex(serialized, 0xcbf29ce484222325n);
  const secondary = fnv1a64Hex(serialized, 0xaf63dc4c8601ec8cn);
  return `fallback:${`${primary}${secondary}`.slice(0, 24)}`;
}

function createPreviewPathCandidates(chart: BeMusicJson, previewPath: string): string[] {
  const normalizedPreview = previewPath.trim();
  if (normalizedPreview.length === 0) {
    return [];
  }

  const normalizedPathWav = typeof chart.bms.pathWav === 'string' ? chart.bms.pathWav.trim() : '';
  const candidates = new Set<string>([normalizePreviewContinueKey(normalizedPreview)]);
  if (normalizedPathWav.length > 0 && !normalizedPreview.startsWith('/')) {
    candidates.add(
      normalizePreviewContinueKey(
        `${normalizedPathWav.replace(/[\\/]+$/, '')}/${normalizedPreview.replace(/^[\\/]+/, '')}`,
      ),
    );
  }
  return [...candidates];
}

function normalizePreviewContinueKey(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
}
