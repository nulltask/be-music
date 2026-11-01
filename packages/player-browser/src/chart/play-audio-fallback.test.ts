import { createEmptyJSON } from '@be-music/chart-source';
import { expect, test, vi } from 'vite-plus/test';
import type { BrowserAssetEntry, BrowserAssetSource } from '../collection/types.ts';
import { loadPlaySamples } from './play-audio.ts';
import { createNonstopAssets } from '../collection/nonstop.ts';

const encode = (text: string) => new TextEncoder().encode(text);

async function load(
  files: Record<string, BrowserAssetEntry>,
  path = 'kick.wav',
  prefix?: string,
  cancelOnFailure = false,
  compositeSource?: BrowserAssetSource,
) {
  const chart = createEmptyJSON('bmson');
  chart.resources.wav = { '01': path };
  chart.events = [{ measure: 0, channel: '01', position: [0, 1], value: '01' }];
  chart.bms.pathWAV = prefix;
  let cancelled = false;
  const decode = vi.fn(async (buffer: ArrayBuffer) => {
    const label = new TextDecoder().decode(buffer);
    if (label === 'broken') {
      cancelled = cancelOnFailure;
      throw new Error('unsupported codec');
    }
    return { label } as unknown as AudioBuffer;
  });
  const source: BrowserAssetSource = {
    id: 'test',
    kind: 'files',
    label: 'test',
    files: new Map(Object.entries(files)),
  };
  const samples = new Map<string, AudioBuffer>();
  await loadPlaySamples({
    source: compositeSource ?? source,
    chart,
    chartPath: 'Song/main.bmson',
    samples,
    audioContext: { decodeAudioData: decode } as unknown as BaseAudioContext,
    tempo: 1,
    tempoPitchMode: 'pitch',
    tempoStretchAlgorithm: 'signalsmith',
    isCancelled: () => cancelled,
  });
  return { samples, decode };
}

test.each(['kick.wav', 'kick', 'kick.m4a'])('decode failure advances through codecs for %s', async (path) => {
  const { samples, decode } = await load(
    {
      'Song/kick.opus': encode('broken'),
      'Song/kick.m4a': encode('AAC'),
    },
    path,
  );
  expect(samples.get(path)).toMatchObject({ label: 'AAC' });
  expect(decode).toHaveBeenCalledTimes(2);
});

test('a successful first codec retains the existing priority and avoids decoding alternates', async () => {
  const { samples, decode } = await load({
    'Song/kick.opus': encode('Opus'),
    'Song/kick.wav': encode('WAV'),
  });
  expect(samples.get('kick.wav')).toMatchObject({ label: 'Opus' });
  expect(decode).toHaveBeenCalledTimes(1);
});

test('PATH_WAV and backslashes survive retry and missing-prefix fallback', async () => {
  const { samples, decode } = await load(
    {
      'Song/audio/sub.dir/kick.opus': encode('broken'),
      'Song/sub.dir/kick.m4a': encode('AAC'),
    },
    'sub.dir\\kick',
    'audio\\',
  );
  expect(samples.get('sub.dir/kick')).toMatchObject({ label: 'AAC' });
  expect(decode).toHaveBeenCalledTimes(2);
});

test('the same asset reached through several codec or folder aliases is decoded once', async () => {
  const broken = encode('broken');
  const { samples, decode } = await load({
    'kick.opus': broken,
    'Song/kick.ogg': broken,
    'Song/kick.wav': encode('WAV'),
  });
  expect(samples.get('kick.wav')).toMatchObject({ label: 'WAV' });
  expect(decode).toHaveBeenCalledTimes(2);
});

test('cancellation during a rejected decode skips all remaining candidates', async () => {
  const { samples, decode } = await load(
    {
      'Song/kick.opus': encode('broken'),
      'Song/kick.wav': encode('WAV'),
    },
    'kick.wav',
    undefined,
    true,
  );
  expect(samples.size).toBe(0);
  expect(decode).toHaveBeenCalledTimes(1);
});

test('a failed lazy-file read advances to the playable codec', async () => {
  const unreadable = {
    name: 'kick.opus',
    arrayBuffer: async () => {
      throw new Error('unreadable file');
    },
  } as unknown as File;
  const { samples, decode } = await load({ 'Song/kick.opus': unreadable, 'Song/kick.wav': encode('WAV') });
  expect(samples.get('kick.wav')).toMatchObject({ label: 'WAV' });
  expect(decode).toHaveBeenCalledTimes(1);
});

test('NONSTOP gameplay decodes an alternate retained from the original stage folder', async () => {
  const chart = createEmptyJSON('bmson');
  chart.bms.pathWAV = 'audio/';
  const original: BrowserAssetSource = {
    id: 'stage',
    kind: 'files',
    label: 'stage',
    files: new Map([
      ['Song/sub/audio/kick.opus', encode('broken')],
      ['Song/kick.wav', encode('WAV')],
    ]),
  };
  const { source, assetPath } = createNonstopAssets([{ chart, source: original, chartPath: 'Song/sub/main.bmson' }]);
  const path = assetPath(0, 'wav', 'kick.wav');
  const { samples, decode } = await load({}, path, undefined, false, source);
  expect(samples.get(path.toLowerCase())).toMatchObject({ label: 'WAV' });
  expect(decode).toHaveBeenCalledTimes(2);
});
