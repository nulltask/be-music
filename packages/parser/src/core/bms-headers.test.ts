import { createEmptyJSON } from '@be-music/json';
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

  test('keeps a base-62 object key in its authored case', () => {
    const json = createEmptyJSON('bms');
    pushHeaderLine(json, 'WAV0A', 'WAV0a', 'snare.wav', 62);
    expect(json.resources.wav).toEqual({ '0a': 'snare.wav' });
  });
});
