import { describe, expect, it } from 'vite-plus/test';
import { allowsRedirect, isSameOrigin, navigationTarget } from './navigation.ts';

const PLAY = 'https://play.be-music.app';

describe('isSameOrigin', () => {
  it('compares origins, not prefixes', () => {
    expect(isSameOrigin('https://play.be-music.app/select?x=1', PLAY)).toBe(true);
    expect(isSameOrigin('https://play.be-music.app.example.com/', PLAY)).toBe(false);
    expect(isSameOrigin('http://play.be-music.app/', PLAY)).toBe(false);
    expect(isSameOrigin('not a url', PLAY)).toBe(false);
  });
});

describe('navigationTarget', () => {
  it('keeps the player in the window', () => {
    expect(navigationTarget('https://play.be-music.app/play/123', PLAY)).toBe('window');
    expect(navigationTarget('http://localhost:5173/', 'http://localhost:5173')).toBe('window');
  });

  it('keeps the sign-in flow in the window', () => {
    expect(navigationTarget('https://be-music.app/api/auth/oauth2/authorize?x=1', PLAY)).toBe('window');
    expect(navigationTarget('https://preview.be-music.app/consent', PLAY)).toBe('window');
    expect(navigationTarget('https://discord.com/oauth2/authorize', PLAY)).toBe('window');
    expect(navigationTarget('https://accounts.google.com/o/oauth2/v2/auth', PLAY)).toBe('window');
  });

  it('sends other pages to the browser', () => {
    expect(navigationTarget('https://leaderboard.be-music.app/charts/abc', PLAY)).toBe('browser');
    expect(navigationTarget('https://github.com/nulltask/be-music', PLAY)).toBe('browser');
    expect(navigationTarget('http://be-music.app/', PLAY)).toBe('browser');
    expect(navigationTarget('mailto:someone@example.com', PLAY)).toBe('browser');
  });

  it('refuses other schemes and malformed URLs', () => {
    expect(navigationTarget('file:///etc/passwd', PLAY)).toBe('refuse');
    expect(navigationTarget('javascript:alert(1)', PLAY)).toBe('refuse');
    expect(navigationTarget('be-music://open', PLAY)).toBe('refuse');
    expect(navigationTarget('::', PLAY)).toBe('refuse');
  });
});

describe('allowsRedirect', () => {
  it('allows web redirects only', () => {
    expect(allowsRedirect('https://accounts.google.com/signin')).toBe(true);
    expect(allowsRedirect('http://localhost:5173/')).toBe(true);
    expect(allowsRedirect('file:///tmp/a')).toBe(false);
    expect(allowsRedirect('nonsense')).toBe(false);
  });
});
