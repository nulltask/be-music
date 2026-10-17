import { createEmptyJson, type BeMusicJson } from '@be-music/json';
import { describe, expect, test } from 'vite-plus/test';
import { parseJsonDocument } from './bms-json-document.ts';
import { parseBms, parseChart } from './parser.ts';

describe('parseJsonDocument', () => {
  test('re-reads an emitted BMS-JSON document the way parseChart reads its text', () => {
    const text = JSON.stringify(parseBms(['#TITLE Doc', '#BPM 150', '#WAV01 kick.wav', '#00111:01'].join('\n')));
    const json = parseJsonDocument(JSON.parse(text) as Partial<BeMusicJson>);
    expect(json.metadata.title).toBe('Doc');
    expect(json.resources.wav).toEqual({ '01': 'kick.wav' });
    expect(json).toEqual(parseChart(text, 'json'));
  });

  test('moves known BMS extension headers out of metadata.extras', () => {
    const metadata = { ...createEmptyJson('json').metadata, extras: { LNTYPE: '2', CUSTOM: 'x' } };
    const json = parseJsonDocument({ metadata });
    expect(json.bms.lnType).toBe(2);
    expect(json.metadata.extras).toEqual({ CUSTOM: 'x' });
  });
});
