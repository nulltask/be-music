import { describe, expect, test } from 'vite-plus/test';
import type { BmsonDocument } from './bmson.ts';
import { parseBmsonDocument } from './bmson-document.ts';
import { parseBmson } from './parser.ts';

describe('parseBmsonDocument', () => {
  test('reads an already-parsed bmson document the way parseBmson reads its text', () => {
    const document = {
      version: '1.0.0',
      info: { title: 'Doc', artist: 'Artist', init_bpm: 150, resolution: 240 },
      lines: [{ y: 0 }, { y: 960 }],
      sound_channels: [{ name: 'kick.wav', notes: [{ x: 1, y: 0, l: 0, c: false }] }],
    } as BmsonDocument;
    const json = parseBmsonDocument(document);
    expect(json.sourceFormat).toBe('bmson');
    expect(json.metadata.title).toBe('Doc');
    expect(json).toEqual(parseBmson(JSON.stringify(document)));
  });
});

test('normalizes boolean up flags at the bmson boundary without coercing malformed values', () => {
  const source = parseBmsonDocument({
    version: '1.0.0',
    info: { init_bpm: 120 },
    sound_channels: [
      {
        name: 'end.wav',
        notes: [
          { x: 1, y: 240, up: true },
          { x: 2, y: 240, up: false },
          { x: 3, y: 240, up: 'true' },
        ],
      },
    ],
  } as unknown as BmsonDocument);
  expect(source.events.map((event) => event.bmson?.up)).toEqual([true, false, undefined]);
  expect(source.preservation.bmson.soundChannels[0]?.notes.map((note) => note.up)).toEqual([true, false, undefined]);
});
