import { describe, expect, it } from 'vite-plus/test';
import {
  DEFAULT_RECORDING_FORMAT,
  RECORDING_FORMATS,
  describeRecordingFormat,
  recorderMIMECandidates,
  recordingAudioCodecs,
  recordingFileExtension,
  recordingVideoCodecs,
} from './recording-format.ts';

describe('recording formats', () => {
  it('defaults to MP4 with H.264 and offers MP4 before WebM', () => {
    expect(DEFAULT_RECORDING_FORMAT).toEqual({ container: 'mp4', videoCodec: 'avc' });
    expect(RECORDING_FORMATS.map(describeRecordingFormat)).toEqual([
      'MP4 · H.264',
      'MP4 · H.265 (HEVC)',
      'MP4 · AV1',
      'MP4 · VP9',
      'WebM · VP9',
      'WebM · VP8',
      'WebM · AV1',
    ]);
  });

  it('tries the chosen video codec first, then the others its container carries', () => {
    expect(recordingVideoCodecs({ container: 'mp4', videoCodec: 'av1' })).toEqual(['av1', 'avc', 'hevc', 'vp9']);
    expect(recordingVideoCodecs({ container: 'webm', videoCodec: 'vp8' })).toEqual(['vp8', 'vp9', 'av1']);
  });

  it('puts AAC, then Opus, in MP4 and Opus in WebM', () => {
    expect(recordingAudioCodecs('mp4')).toEqual(['aac', 'opus']);
    expect(recordingAudioCodecs('webm')).toEqual(['opus']);
  });

  it('lists MediaRecorder types for the format, then falls back to WebM', () => {
    const mp4 = recorderMIMECandidates({ container: 'mp4', videoCodec: 'avc' });
    expect(mp4.slice(0, 3)).toEqual([
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4;codecs=avc1,opus',
      'video/mp4;codecs=avc1',
    ]);
    expect(mp4).toContain('video/mp4');
    expect(mp4.indexOf('video/mp4')).toBeLessThan(mp4.indexOf('video/webm;codecs=vp9,opus'));
    expect(mp4.at(-1)).toBe('video/webm');
    const webm = recorderMIMECandidates({ container: 'webm', videoCodec: 'vp9' });
    expect(webm[0]).toBe('video/webm;codecs=vp9,opus');
    expect(webm.some((type) => type.startsWith('video/mp4'))).toBe(false);
  });

  it('names the file after its container', () => {
    expect(recordingFileExtension('video/mp4;codecs=avc1')).toBe('mp4');
    expect(recordingFileExtension('video/MP4')).toBe('mp4');
    expect(recordingFileExtension('video/webm;codecs=vp9')).toBe('webm');
    expect(recordingFileExtension('')).toBe('webm');
  });
});
