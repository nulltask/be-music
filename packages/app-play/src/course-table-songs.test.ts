import type { LibraryChart, LibraryCourse } from '@be-music/player-scene-model';
import { describe, expect, test } from 'vite-plus/test';
import { describeMissingCourseStages, parseTableSongIndex } from './course-table-songs.ts';

const MD5_A = '0123456789abcdef0123456789abcdef';
const MD5_B = 'fedcba9876543210fedcba9876543210';
const SHA_C = 'a'.repeat(64);

describe('parseTableSongIndex', () => {
  test("keys a table's songs by MD5 and SHA-256, keeping only http(s) links", () => {
    const index = parseTableSongIndex(
      `﻿${JSON.stringify([
        {
          md5: MD5_A.toUpperCase(),
          sha256: SHA_C,
          title: ' Song A ',
          artist: 'Artist',
          url: 'https://venue.example/a',
          url_diff: 'http://diff.example/a',
          name_diff: 'obj: someone',
          url_pack: 'javascript:alert(1)',
          name_pack: 'Pack',
        },
        { md5: MD5_B, title: 'Song B', url: 'not a url', url_diff: '' },
        { md5: 'short', url: 'https://skip.example/' },
        { title: 'no hash', url: 'https://skip.example/' },
        'junk',
        { md5: MD5_A, title: 'Duplicate' },
      ])}`,
    );
    const a = {
      title: 'Song A',
      artist: 'Artist',
      url: 'https://venue.example/a',
      urlDiff: 'http://diff.example/a',
      nameDiff: 'obj: someone',
      namePack: 'Pack',
    };
    expect(index.get(MD5_A)).toEqual(a);
    expect(index.get(SHA_C)).toEqual(a);
    expect(index.get(MD5_B)).toEqual({ title: 'Song B' });
    expect(index.size).toBe(3);
  });

  test('reads anything but a JSON array as no songs', () => {
    expect(parseTableSongIndex('{"md5":"x"}').size).toBe(0);
    expect(parseTableSongIndex('<html>').size).toBe(0);
  });
});

describe('describeMissingCourseStages', () => {
  const owned = { title: 'Owned' } as LibraryChart;
  const course: LibraryCourse = {
    id: 'Table#0',
    definition: {
      name: 'Dan 1',
      kind: 'grade',
      stages: [{ md5: MD5_A }, { md5: MD5_B, title: 'Stage B' }, { sha256: SHA_C.toUpperCase() }, { md5: MD5_B }],
      constraints: [],
      trophies: [],
      release: true,
      source: { format: 'table', legacyGrade: false },
    },
    stages: [{ title: 'Owned', chart: owned }, { title: 'Stage B' }, { title: 'NOT FOUND' }, { title: 'NOT FOUND' }],
    playable: false,
  };

  test('lists each missing stage with the pages its table names, without repeating a page', () => {
    const songs = new Map([
      [MD5_B, { title: 'Song B', artist: 'B', url: 'https://b.example/', urlDiff: 'https://b.example/' }],
      [SHA_C, { url: 'https://c.example/', urlDiff: 'https://c.example/diff', nameDiff: 'obj', urlPack: 'https://p/' }],
    ]);
    expect(describeMissingCourseStages(course, songs)).toEqual([
      { stage: 2, title: 'Song B', artist: 'B', links: [{ kind: 'song', href: 'https://b.example/' }] },
      {
        stage: 3,
        title: 'NOT FOUND',
        links: [
          { kind: 'song', href: 'https://c.example/' },
          { kind: 'diff', href: 'https://c.example/diff', name: 'obj' },
          { kind: 'pack', href: 'https://p/' },
        ],
      },
      { stage: 4, title: 'Song B', artist: 'B', links: [{ kind: 'song', href: 'https://b.example/' }] },
    ]);
  });

  test("keeps the course's titles and offers no page without a song list", () => {
    expect(describeMissingCourseStages(course)).toEqual([
      { stage: 2, title: 'Stage B', links: [] },
      { stage: 3, title: 'NOT FOUND', links: [] },
      { stage: 4, title: 'NOT FOUND', links: [] },
    ]);
  });
});
