import { describe, expect, it } from 'vite-plus/test';
import { describeDownload, readDownloadSize } from './download-size.ts';

describe('readDownloadSize', () => {
  it('reads the length of an uncompressed body', () => {
    expect(readDownloadSize(new Headers({ 'content-length': '12345678' }))).toBe(12_345_678);
    expect(readDownloadSize(new Headers({ 'content-length': '10', 'content-encoding': 'identity' }))).toBe(10);
  });

  it('knows no size without a length, or for a body compressed in transit', () => {
    expect(readDownloadSize(new Headers())).toBeUndefined();
    expect(readDownloadSize(new Headers({ 'content-length': '0' }))).toBeUndefined();
    expect(readDownloadSize(new Headers({ 'content-length': 'abc' }))).toBeUndefined();
    expect(readDownloadSize(new Headers({ 'content-length': '10', 'content-encoding': 'gzip' }))).toBeUndefined();
  });
});

describe('describeDownload', () => {
  it('adds the size in MB when it is known', () => {
    expect(describeDownload('song.zip', 12_345_678)).toBe('song.zip · 12.3 MB');
    expect(describeDownload('song.zip', 16_642)).toBe('song.zip · 17 KB');
    expect(describeDownload('song.zip', 120)).toBe('song.zip · 1 KB');
    expect(describeDownload('song.zip', undefined)).toBe('song.zip');
  });
});
