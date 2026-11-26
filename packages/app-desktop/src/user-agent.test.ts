import { describe, expect, it } from 'vite-plus/test';
import { chromeUserAgent } from './user-agent.ts';

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.65 Safari/537.36';

describe('chromeUserAgent', () => {
  it("removes the app's name and Electron's version", () => {
    const electron =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Be-Music Play/0.1.0 Chrome/146.0.7680.65 Electron/45.4.1 Safari/537.36';
    expect(chromeUserAgent(electron)).toBe(CHROME);
  });

  it('keeps a Chrome user agent unchanged', () => {
    expect(chromeUserAgent(CHROME)).toBe(CHROME);
  });

  it('drops only the Electron token from an unfamiliar shape', () => {
    expect(chromeUserAgent('Custom/1.0 Electron/45.4.1 Other/2')).toBe('Custom/1.0 Other/2');
  });
});
