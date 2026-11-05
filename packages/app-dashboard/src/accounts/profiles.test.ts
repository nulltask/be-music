import { describe, expect, test } from 'vite-plus/test';
import { DISPLAY_NAME_MAX, generateHandle, normalizeDisplayName, normalizeHandle } from './profiles.ts';

describe('normalizeHandle', () => {
  test('accepts letters, digits and _, 3 to 15 characters, and stores them in lower case', () => {
    expect(normalizeHandle('DJ_Taro')).toEqual({ ok: true, handle: 'dj_taro' });
    expect(normalizeHandle('  abc  ')).toEqual({ ok: true, handle: 'abc' });
    expect(normalizeHandle('a'.repeat(15))).toEqual({ ok: true, handle: 'a'.repeat(15) });
  });

  test('refuses other characters and lengths', () => {
    for (const input of ['ab', 'a'.repeat(16), 'dj-taro', 'dj taro', 'たろう', 'dj.taro', '']) {
      expect(normalizeHandle(input)).toEqual({ ok: false, reason: 'format' });
    }
  });

  test('refuses reserved handles in any case', () => {
    expect(normalizeHandle('Admin')).toEqual({ ok: false, reason: 'reserved' });
    expect(normalizeHandle('LEADERBOARD')).toEqual({ ok: false, reason: 'reserved' });
  });

  test('generated handles follow the rules', () => {
    const handle = generateHandle(new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253]));
    expect(handle).toMatch(/^player_[a-z0-9]{8}$/);
    expect(normalizeHandle(handle)).toEqual({ ok: true, handle });
  });
});

describe('normalizeDisplayName', () => {
  test('trims, normalizes to NFC, and welcomes any script', () => {
    expect(normalizeDisplayName('  たろう ')).toEqual({ ok: true, displayName: 'たろう' });
    expect(normalizeDisplayName('Café')).toEqual({ ok: true, displayName: 'Café' });
  });

  test(`counts characters, not UTF-16 units, up to ${DISPLAY_NAME_MAX}`, () => {
    expect(normalizeDisplayName('🎹'.repeat(DISPLAY_NAME_MAX)).ok).toBe(true);
    expect(normalizeDisplayName('あ'.repeat(DISPLAY_NAME_MAX + 1))).toEqual({ ok: false, reason: 'length' });
  });

  test('refuses empty names, line breaks, control and bidirectional characters', () => {
    expect(normalizeDisplayName(' 　 ')).toEqual({ ok: false, reason: 'empty' });
    for (const input of ['a\nb', 'a\u0007b', 'abc‮def', 'a b', 'a⁦b']) {
      expect(normalizeDisplayName(input)).toEqual({ ok: false, reason: 'characters' });
    }
  });
});
