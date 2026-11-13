import { describe, expect, test } from 'vite-plus/test';
import { resolveSongInfoLayers } from './song-info.ts';

describe('resolveSongInfoLayers', () => {
  const runtime = { chartTitle: 'New', chartArtist: 'B', chartGenre: 'G2' };

  test('draws the current song alone without a crossfade', () => {
    expect(resolveSongInfoLayers(runtime)).toEqual([
      { info: { chartTitle: 'New', chartArtist: 'B', chartGenre: 'G2' }, alpha: 1 },
    ]);
  });

  test('draws the old song fading out under the new one fading in', () => {
    const fade = { chartTitle: 'Old', chartArtist: 'A', progress: 0.25 };
    expect(resolveSongInfoLayers({ ...runtime, songInfoFade: fade })).toEqual([
      { info: { chartTitle: 'Old', chartArtist: 'A' }, alpha: 0.75 },
      { info: { chartTitle: 'New', chartArtist: 'B', chartGenre: 'G2' }, alpha: 0.25 },
    ]);
  });

  test('leaves out a layer at 0 and clamps the progress', () => {
    const at = (progress: number) =>
      resolveSongInfoLayers({ ...runtime, songInfoFade: { chartTitle: 'Old', progress } }).map((layer) => [
        layer.info.chartTitle,
        layer.alpha,
      ]);
    expect(at(0)).toEqual([['Old', 1]]);
    expect(at(-2)).toEqual([['Old', 1]]);
    expect(at(1)).toEqual([['New', 1]]);
    expect(at(5)).toEqual([['New', 1]]);
    expect(at(Number.NaN)).toEqual([['New', 1]]);
  });
});
