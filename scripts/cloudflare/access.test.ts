import { describe, expect, it } from 'vite-plus/test';
import { parseAllowedEmails, PREVIEW_ACCESS_HOSTS, previewAccessApplication, previewAccessPolicy } from './access.ts';

describe('parseAllowedEmails', () => {
  it('splits on commas and whitespace, lowercases and drops duplicates', () => {
    expect(parseAllowedEmails(' A@example.com, b@example.org\nA@EXAMPLE.COM ')).toEqual([
      'a@example.com',
      'b@example.org',
    ]);
  });

  it('rejects an empty list and anything that is not an address', () => {
    expect(() => parseAllowedEmails(undefined)).toThrow('no email address');
    expect(() => parseAllowedEmails(' , ')).toThrow('no email address');
    expect(() => parseAllowedEmails('example.com')).toThrow('Not an email address');
  });
});

describe('preview Access configuration', () => {
  it('allows only the listed addresses, signed in with the given provider', () => {
    const policy = previewAccessPolicy(['a@example.com'], 'idp');
    expect(policy.decision).toBe('allow');
    expect(policy.include).toEqual([{ email: { email: 'a@example.com' } }]);
    expect(policy.require).toEqual([{ login_method: { id: 'idp' } }]);
  });

  it('covers the apex and every subdomain of the preview site', () => {
    const app = previewAccessApplication('policy', 'idp');
    expect(PREVIEW_ACCESS_HOSTS).toEqual(['preview.be-music.app', '*.preview.be-music.app']);
    expect(app.destinations.map((destination) => destination.uri)).toEqual([...PREVIEW_ACCESS_HOSTS]);
    expect(app.allowed_idps).toEqual(['idp']);
    expect(app.policies).toEqual([{ id: 'policy', precedence: 1 }]);
  });
});
