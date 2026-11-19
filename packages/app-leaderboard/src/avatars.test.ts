import { describe, expect, test } from 'vite-plus/test';
import { avatarURL } from './avatars.ts';

describe('avatarUrl', () => {
  test('versions the URL by the upload hash, or marks the generated icon', () => {
    expect(avatarURL('dj_taro', 'https://accounts.example/profiles/dj_taro/avatar?v=g')).toBe(
      'https://accounts.example/profiles/dj_taro/avatar?v=g',
    );
    expect(avatarURL('dj_taro', null)).toBe('/players/dj_taro/avatar?v=g');
    expect(avatarURL('dj_taro', `avatars/u1/${'0123456789abcdef'.repeat(4)}.webp`)).toBe(
      '/players/dj_taro/avatar?v=0123456789abcdef',
    );
  });
});
