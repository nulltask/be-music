import { describe, expect, test } from 'vite-plus/test';
import { avatarURL, detectAvatarType, generatedAvatarSVG } from './avatars.ts';

const bytes = (...values: number[]) => new Uint8Array(values);

describe('detectAvatarType', () => {
  test('recognizes WebP, PNG and JPEG by their signatures', () => {
    expect(detectAvatarType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50))).toBe('image/webp');
    expect(detectAvatarType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe('image/png');
    expect(detectAvatarType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
  });

  test('refuses everything else, SVG and GIF included', () => {
    expect(detectAvatarType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeUndefined();
    expect(detectAvatarType(new TextEncoder().encode('GIF89a'))).toBeUndefined();
    expect(detectAvatarType(bytes())).toBeUndefined();
  });
});

describe('avatarUrl', () => {
  test('versions the URL by the upload hash, or marks the generated icon', () => {
    expect(avatarURL('dj_taro', null)).toBe('/players/dj_taro/avatar?v=g');
    expect(avatarURL('dj_taro', `avatars/u1/${'0123456789abcdef'.repeat(4)}.webp`)).toBe(
      '/players/dj_taro/avatar?v=0123456789abcdef',
    );
  });
});

describe('generatedAvatarSVG', () => {
  test('draws the same picture for the same account and different ones for others', () => {
    const first = generatedAvatarSVG('user-1');
    expect(first).toBe(generatedAvatarSVG('user-1'));
    expect(first).not.toBe(generatedAvatarSVG('user-2'));
    expect(first).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  });
});
