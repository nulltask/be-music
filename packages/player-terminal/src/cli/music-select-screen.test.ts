import { describe, expect, test } from 'vite-plus/test';
import { sanitizeMetadataText } from './music-select-screen.ts';

describe('sanitizeMetadataText', () => {
  test('trims the text', () => {
    expect(sanitizeMetadataText('  Title  ')).toBe('Title');
    expect(sanitizeMetadataText('Title')).toBe('Title');
  });

  test('treats missing and blank text as absent', () => {
    expect(sanitizeMetadataText(undefined)).toBeUndefined();
    expect(sanitizeMetadataText('')).toBeUndefined();
    expect(sanitizeMetadataText(' \t\n ')).toBeUndefined();
  });
});
