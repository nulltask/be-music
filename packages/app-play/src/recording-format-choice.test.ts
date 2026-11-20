import { describe, expect, test } from 'vite-plus/test';
import {
  parseRecordingFormatKey,
  parseRecordingQuality,
  recordingFormatKey,
  recordingFormatOptions,
  recordingQualityOptions,
} from './recording-format-choice.ts';

describe('recording format choice', () => {
  test('round-trips a format through its key', () => {
    expect(recordingFormatKey({ container: 'webm', videoCodec: 'vp9' })).toBe('webm/vp9');
    expect(parseRecordingFormatKey('webm/vp9')).toEqual({ container: 'webm', videoCodec: 'vp9' });
  });

  test('falls back to MP4 · H.264 for a missing or unknown key', () => {
    expect(parseRecordingFormatKey(null)).toEqual({ container: 'mp4', videoCodec: 'avc' });
    expect(parseRecordingFormatKey('mp4/vp8')).toEqual({ container: 'mp4', videoCodec: 'avc' });
  });

  test('labels the menu choices, MP4 · H.264 first', () => {
    const options = recordingFormatOptions();
    expect(Object.entries(options)[0]).toEqual(['MP4 · H.264', 'mp4/avc']);
    expect(options['WebM · VP8']).toBe('webm/vp8');
  });
});

describe('recording quality choice', () => {
  test('reads a stored quality, Standard for a missing or unknown one', () => {
    expect(parseRecordingQuality('very-high')).toBe('very-high');
    expect(parseRecordingQuality(null)).toBe('standard');
    expect(parseRecordingQuality('ultra')).toBe('standard');
  });

  test('labels the menu choices, the smallest file first', () => {
    expect(recordingQualityOptions()).toEqual({
      Low: 'low',
      Standard: 'standard',
      High: 'high',
      'Very high': 'very-high',
    });
  });
});
