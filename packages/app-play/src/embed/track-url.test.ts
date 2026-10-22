import { describe, expect, it } from 'vite-plus/test';
import { parseEmbedTrack } from './track-url.ts';

const PAGE = 'https://play.be-music.app/embed/';

describe('parseEmbedTrack', () => {
  it('fetches another origin through the proxy and names the archive after the path', () => {
    expect(parseEmbedTrack(`${PAGE}?track=${encodeURIComponent('https://example.com/packs/My%20Song.zip')}`)).toEqual({
      url: 'https://example.com/packs/My%20Song.zip',
      fetchURL: 'https://play.be-music.app/__url-load-proxy?url=https%3A%2F%2Fexample.com%2Fpacks%2FMy%2520Song.zip',
      fileName: 'My Song.zip',
    });
  });

  it('fetches this origin directly, resolving a relative URL against the page', () => {
    expect(parseEmbedTrack(`${PAGE}?track=/tracks/demo.zip`)).toMatchObject({
      url: 'https://play.be-music.app/tracks/demo.zip',
      fetchURL: 'https://play.be-music.app/tracks/demo.zip',
      fileName: 'demo.zip',
    });
  });

  it('names an archive without a .zip path as one, so the loader opens it', () => {
    expect(parseEmbedTrack(`${PAGE}?track=https://example.com/download?id=3`)?.fileName).toBe('download.zip');
  });

  it('reads the chart to play on its own from ?chart=', () => {
    expect(parseEmbedTrack(`${PAGE}?track=/tracks/demo.zip&chart=codebmp.bms`)?.chart).toBe('codebmp.bms');
    expect(parseEmbedTrack(`${PAGE}?track=/tracks/demo.zip&chart=%20`)).not.toHaveProperty('chart');
    expect(parseEmbedTrack(`${PAGE}?track=/tracks/demo.zip`)).not.toHaveProperty('chart');
  });

  it('refuses a missing track and URLs the embed cannot fetch', () => {
    expect(parseEmbedTrack(PAGE)).toBeUndefined();
    expect(parseEmbedTrack(`${PAGE}?track=javascript:alert(1)`)).toBeUndefined();
    expect(parseEmbedTrack(`${PAGE}?track=http://example.com/a.zip`)).toBeUndefined();
  });
});
