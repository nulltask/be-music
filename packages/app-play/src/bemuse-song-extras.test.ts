import { createTimingResolver } from '@be-music/chart-model';
import { parseBMS } from '@be-music/chart-parser';
import { describe, expect, test } from 'vite-plus/test';
import {
  BemuseSongExtrasRegistry,
  applyBemuseSongExtras,
  bemuseGainedVolWAV,
  beatAtSeconds,
  chartHasServedBGA,
  type BemuseSongExtras,
} from './bemuse-song-extras.ts';

const BPM120 = '#BPM 120\n#WAV01 kick.wav\n#00111:01\n';

const extras = (overrides: Partial<BemuseSongExtras> = {}): BemuseSongExtras => ({ gain: 1, ...overrides });

describe('beatAtSeconds', () => {
  test('finds the beat a chart second falls on, across a BPM change', () => {
    const chart = parseBMS('#BPM 120\n#BPM01 240\n#00208:01\n#00311:01\n');
    expect(beatAtSeconds(chart, 0)).toBe(0);
    expect(beatAtSeconds(chart, 1)).toBeCloseTo(2, 6);
    // Two measures at 120 BPM take 4 s; after that a beat takes 0.25 s.
    expect(beatAtSeconds(chart, 5)).toBeCloseTo(12, 6);
    expect(createTimingResolver(chart).beatToSeconds(beatAtSeconds(chart, 4.3))).toBeCloseTo(4.3, 6);
  });
});

describe('applyBemuseSongExtras', () => {
  test('fills the preview, images and video a chart leaves out, and multiplies the gain into #VOLWAV', () => {
    const chart = parseBMS(`${BPM120}#VOLWAV 50\n`);
    applyBemuseSongExtras(
      chart,
      extras({
        previewPath: '__bemuse__/preview.mp3',
        stageFilePath: '__bemuse__/eyecatch.png',
        backImagePath: '__bemuse__/back.png',
        video: { path: '__bemuse__/video.webm', offsetSeconds: 1 },
        gain: 0.5,
      }),
      new Set(['kick.m4a', '__bemuse__/video.webm']),
    );
    expect(chart.bms.preview).toBe('__bemuse__/preview.mp3');
    expect(chart.metadata.stageFile).toBe('__bemuse__/eyecatch.png');
    expect(chart.metadata.backBMP).toBe('__bemuse__/back.png');
    expect(chart.bms.volWAV).toBeCloseTo(25);
    expect(chart.bmson.bga.header).toEqual([{ id: 1, name: '__bemuse__/video.webm' }]);
    // 1 s at 120 BPM is beat 2: 480 pulses at the default resolution of 240.
    expect(chart.bmson.bga.events).toEqual([{ y: 480, id: 1 }]);
  });

  test('keeps what the chart names itself', () => {
    const chart = parseBMS(`${BPM120}#PREVIEW own.ogg\n#STAGEFILE own.png\n#BACKBMP own_back.png\n`);
    applyBemuseSongExtras(
      chart,
      extras({ previewPath: 'p.mp3', stageFilePath: 's.png', backImagePath: 'b.png' }),
      new Set(),
    );
    expect(chart.bms.preview).toBe('own.ogg');
    expect(chart.metadata.stageFile).toBe('own.png');
    expect(chart.metadata.backBMP).toBe('own_back.png');
  });

  test('shows the video only when the chart has no BGA the song serves', () => {
    const video = { path: '__bemuse__/video.webm', offsetSeconds: 0 };
    const served = parseBMS(`${BPM120}#BMP01 bg.bmp\n#00104:01\n`);
    expect(chartHasServedBGA(served, new Set(['bg.png']))).toBe(true);
    applyBemuseSongExtras(served, extras({ video }), new Set(['bg.png']));
    expect(served.bmson.bga.header).toEqual([]);
    const missing = parseBMS(`${BPM120}#BMP01 bg.bmp\n#00104:01\n`);
    applyBemuseSongExtras(missing, extras({ video }), new Set(['kick.m4a']));
    expect(missing.bmson.bga.events).toEqual([{ y: 0, id: 1 }]);
  });

  test('keeps the gain inside the range #VOLWAV is read in', () => {
    const chart = parseBMS(`${BPM120}#VOLWAV 150\n`);
    applyBemuseSongExtras(chart, extras({ gain: 2 }), new Set());
    expect(chart.bms.volWAV).toBeLessThan(200);
  });
});

describe('BemuseSongExtrasRegistry', () => {
  test('lays a song’s extras onto its charts once', () => {
    const registry = new BemuseSongExtrasRegistry();
    registry.remember([{ folder: 'Bemuse ex.com/song', files: new Set(), extras: extras({ gain: 0.5 }) }]);
    const chart = parseBMS(BPM120);
    const other = parseBMS(BPM120);
    const charts = [
      { chartPath: 'Bemuse ex.com/song/a.bms', chart },
      { chartPath: 'Other/song/a.bms', chart: other },
    ];
    registry.apply(charts);
    registry.apply(charts);
    expect(chart.bms.volWAV).toBeCloseTo(50);
    expect(other.bms.volWAV).toBeUndefined();
  });

  test('turns the ReplayGain on and off on charts already given their extras', () => {
    let replayGain = false;
    const registry = new BemuseSongExtrasRegistry(() => replayGain);
    registry.remember([{ folder: 'Bemuse ex.com/song', files: new Set(), extras: extras({ gain: 0.5 }) }]);
    const plain = parseBMS(BPM120);
    const loud = parseBMS(`${BPM120}#VOLWAV 80\n`);
    const charts = [
      { chartPath: 'Bemuse ex.com/song/a.bms', chart: plain },
      { chartPath: 'Bemuse ex.com/song/b.bms', chart: loud },
    ];
    registry.apply(charts);
    expect(plain.bms.volWAV).toBeUndefined();
    expect(loud.bms.volWAV).toBe(80);
    replayGain = true;
    registry.refreshReplayGain(charts);
    registry.refreshReplayGain(charts);
    expect(plain.bms.volWAV).toBeCloseTo(50);
    expect(loud.bms.volWAV).toBeCloseTo(40);
    replayGain = false;
    registry.refreshReplayGain(charts);
    expect(plain.bms.volWAV).toBeUndefined();
    expect(loud.bms.volWAV).toBe(80);
  });
});

describe('bemuseGainedVolWAV', () => {
  test('multiplies the gain into #VOLWAV inside its range, and leaves it for a gain of 1 or none', () => {
    expect(bemuseGainedVolWAV(undefined, 0.5)).toBeCloseTo(50);
    expect(bemuseGainedVolWAV(150, 2)).toBe(199.99);
    expect(bemuseGainedVolWAV(80, 1)).toBe(80);
    expect(bemuseGainedVolWAV(undefined, Number.NaN)).toBeUndefined();
    expect(bemuseGainedVolWAV(80, 0)).toBe(80);
  });
});
