import { describe, expect, test } from 'vite-plus/test';
import { AVATAR_MAX_BYTES, detectAvatarType, generatedAvatarSVG, prepareAvatarUpload } from './index.ts';

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

describe('generatedAvatarSVG', () => {
  test('draws the same picture for the same account and different ones for others', () => {
    const first = generatedAvatarSVG('user-1');
    expect(first).toBe(generatedAvatarSVG('user-1'));
    expect(first).not.toBe(generatedAvatarSVG('user-2'));
    expect(first).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  });
});

test('returns the stored content type and stable content-addressed key', async () => {
  expect(await prepareAvatarUpload('u1', bytes(0xff, 0xd8, 0xff))).toEqual({
    ok: true,
    type: 'image/jpeg',
    avatarKey: 'avatars/u1/6e568e1f67fba258184c78181539e5e8fdee447e49bb706fc0ea34fbf12336a5.jpg',
  });
});

test('keeps upload rejection precedence and response codes', async () => {
  expect(await prepareAvatarUpload('u1', bytes())).toEqual({ ok: false, status: 400, error: 'empty-body' });
  expect(await prepareAvatarUpload('u1', new Uint8Array(AVATAR_MAX_BYTES + 1))).toEqual({
    ok: false,
    status: 413,
    error: 'avatar-too-large',
  });
  expect(await prepareAvatarUpload('u1', bytes(1))).toEqual({ ok: false, status: 415, error: 'unsupported-image' });
});
