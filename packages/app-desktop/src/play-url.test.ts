import { describe, expect, it } from 'vite-plus/test';
import { DEFAULT_PLAY_URL, resolvePlayURL } from './play-url.ts';

describe('resolvePlayURL', () => {
  it('opens the production player by default', () => {
    expect(resolvePlayURL(['/Applications/Be-Music Play.app/Contents/MacOS/Be-Music Play'], {}).href).toBe(
      DEFAULT_PLAY_URL,
    );
  });

  it('prefers the command line over the environment', () => {
    const url = resolvePlayURL(['electron', '.', '--play-url=http://localhost:5173/'], {
      BE_MUSIC_PLAY_URL: 'https://play.preview.be-music.app/',
    });
    expect(url.href).toBe('http://localhost:5173/');
  });

  it('reads the environment, ignoring an empty value', () => {
    expect(resolvePlayURL([], { BE_MUSIC_PLAY_URL: 'https://play.preview.be-music.app/' }).href).toBe(
      'https://play.preview.be-music.app/',
    );
    expect(resolvePlayURL([], { BE_MUSIC_PLAY_URL: '' }).href).toBe(DEFAULT_PLAY_URL);
  });

  it('takes the last switch when repeated', () => {
    expect(resolvePlayURL(['--play-url=https://a.example/', '--play-url=https://b.example/'], {}).host).toBe(
      'b.example',
    );
  });

  it('rejects what is not an http(s) URL', () => {
    expect(() => resolvePlayURL(['--play-url=file:///tmp/index.html'], {})).toThrow('Not an http(s) URL');
    expect(() => resolvePlayURL(['--play-url=localhost'], {})).toThrow('Not a URL');
  });
});
