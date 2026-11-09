import { createEmptyJSON } from '@be-music/chart-source';
import { describe, expect, test } from 'vite-plus/test';
import { pushHeaderLine, resolveHeaderDefinitionKey } from './bms-headers.ts';

describe('resolveHeaderDefinitionKey', () => {
  test('keys a plain header by its command and an indexed header by its normalized object key', () => {
    expect(resolveHeaderDefinitionKey('TITLE', 'title', 36)).toBe('TITLE');
    expect(resolveHeaderDefinitionKey('WAV0A', 'wav0a', 36)).toBe('WAV0A');
    expect(resolveHeaderDefinitionKey('WAV0A', 'WAV0a', 62)).toBe('WAV0a');
  });

  test('leaves the repeatable headers unkeyed', () => {
    for (const command of ['STP', 'WAVCMD', 'LNOBJ']) {
      expect(resolveHeaderDefinitionKey(command, command, 36)).toBeUndefined();
    }
  });
});

describe('pushHeaderLine', () => {
  test('applies plain and indexed headers to the chart', () => {
    const json = createEmptyJSON('bms');
    pushHeaderLine(json, 'TITLE', 'TITLE', 'Song', 36);
    pushHeaderLine(json, 'WAV0A', 'wav0a', 'kick.wav', 36);
    pushHeaderLine(json, 'BPM01', 'BPM01', '180.5', 36);
    expect(json.metadata.title).toBe('Song');
    expect(json.resources.wav).toEqual({ '0A': 'kick.wav' });
    expect(json.resources.bpm).toEqual({ '01': 180.5 });
  });

  test('keeps a positive #STOPxx over a later zero or negative one, as LR2 does', () => {
    const json = createEmptyJSON('bms');
    pushHeaderLine(json, 'STOP01', 'STOP01', '96', 36);
    pushHeaderLine(json, 'STOP01', 'STOP01', '-5', 36);
    pushHeaderLine(json, 'STOP01', 'STOP01', '0', 36);
    pushHeaderLine(json, 'STOP02', 'STOP02', '-5', 36);
    pushHeaderLine(json, 'STOP02', 'STOP02', '48', 36);
    pushHeaderLine(json, 'STOP03', 'STOP03', '-5', 36);
    pushHeaderLine(json, 'STOP03', 'STOP03', '0', 36);
    expect(json.resources.stop).toEqual({ '01': 96, '02': 48, '03': 0 });
  });

  test('keeps a base-62 object key in its authored case', () => {
    const json = createEmptyJSON('bms');
    pushHeaderLine(json, 'WAV0A', 'WAV0a', 'snare.wav', 62);
    expect(json.resources.wav).toEqual({ '0a': 'snare.wav' });
  });
});
