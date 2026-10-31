import { describe, expect, it } from 'vite-plus/test';
import { embedModeOfAutoPlay, embedStageTapPauses, parseEmbedTrack } from './track-url.ts';

const PAGE = 'https://play.be-music.app/embed/';

describe('parseEmbedTrack', () => {
  it('fetches another origin through the proxy and names the archive after the path', () => {
    expect(parseEmbedTrack(`${PAGE}?track=${encodeURIComponent('https://example.com/packs/My%20Song.zip')}`)).toEqual({
      url: 'https://example.com/packs/My%20Song.zip',
      fetchURL: 'https://play.be-music.app/__url-load-proxy?url=https%3A%2F%2Fexample.com%2Fpacks%2FMy%2520Song.zip',
      fileName: 'My Song.zip',
      mode: 'preview',
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

  it('reads ?mode=play as a manual play and anything else as the AUTO preview', () => {
    expect(parseEmbedTrack(`${PAGE}?track=/tracks/demo.zip&mode=play`)?.mode).toBe('play');
    expect(parseEmbedTrack(`${PAGE}?track=/tracks/demo.zip&mode=%20PLAY%20`)?.mode).toBe('play');
    expect(parseEmbedTrack(`${PAGE}?track=/tracks/demo.zip&mode=preview`)?.mode).toBe('preview');
    expect(parseEmbedTrack(`${PAGE}?track=/tracks/demo.zip&mode=auto`)?.mode).toBe('preview');
    expect(parseEmbedTrack(`${PAGE}?track=/tracks/demo.zip`)?.mode).toBe('preview');
  });

  it("turns the AUTO checkbox into the AUTO preview or the viewer's play", () => {
    expect(embedModeOfAutoPlay(true)).toBe('preview');
    expect(embedModeOfAutoPlay(false)).toBe('play');
  });

  it("lets a tap on the stage pause the AUTO preview but not the viewer's own play", () => {
    expect(embedStageTapPauses('preview')).toBe(true);
    expect(embedStageTapPauses('play')).toBe(false);
  });

  it('reads course file and course name selectors, preserving chart selection when both are supplied', () => {
    expect(
      parseEmbedTrack(`${PAGE}?track=/pack.zip&course=%20courses%2Fdan.lr2crs%20&courseName=Dan&chart=a.bms`),
    ).toMatchObject({ course: 'courses/dan.lr2crs', courseName: 'Dan', chart: 'a.bms' });
    expect(parseEmbedTrack(`${PAGE}?track=/pack.zip&course=%20&courseName=Dan`)).not.toHaveProperty('course');
    expect(parseEmbedTrack(`${PAGE}?track=/pack.zip&courseName=Dan`)).not.toHaveProperty('courseName');
    expect(parseEmbedTrack(`${PAGE}?track=/pack.zip&course=dan.json&courseName=%20`)).not.toHaveProperty('courseName');
  });

  it('refuses a missing track and URLs the embed cannot fetch', () => {
    expect(parseEmbedTrack(PAGE)).toBeUndefined();
    expect(parseEmbedTrack(`${PAGE}?track=javascript:alert(1)`)).toBeUndefined();
    expect(parseEmbedTrack(`${PAGE}?track=http://example.com/a.zip`)).toBeUndefined();
  });
});
