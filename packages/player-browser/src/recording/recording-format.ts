/**
 * The formats a gameplay recording can be written in: the container, the video codec in it, and the order codecs are
 * tried in when the browser cannot encode the chosen one. Shared by the WebCodecs and `MediaRecorder` backends.
 */

/** A file container the recorder can write. */
export type RecordingContainer = 'mp4' | 'webm';
/** A video codec the recorder can encode (WebCodecs names: `avc` is H.264, `hevc` is H.265). */
export type RecordingVideoCodec = 'avc' | 'hevc' | 'vp9' | 'vp8' | 'av1';
/** A container with the video codec to put in it. The audio codec follows the container (AAC in MP4, Opus in WebM). */
export interface RecordingFormat {
  container: RecordingContainer;
  videoCodec: RecordingVideoCodec;
}

/** MP4 with H.264: the one every player and every site takes. */
export const DEFAULT_RECORDING_FORMAT: RecordingFormat = { container: 'mp4', videoCodec: 'avc' };

/** Video codecs each container carries, in order of preference. */
const CONTAINER_VIDEO_CODECS: Readonly<Record<RecordingContainer, readonly RecordingVideoCodec[]>> = {
  mp4: ['avc', 'hevc', 'av1', 'vp9'],
  webm: ['vp9', 'vp8', 'av1'],
};

/** Every format the recorder offers, MP4 first. */
export const RECORDING_FORMATS: readonly RecordingFormat[] = (['mp4', 'webm'] as const).flatMap((container) =>
  CONTAINER_VIDEO_CODECS[container].map((videoCodec) => ({ container, videoCodec })),
);

const VIDEO_CODEC_NAMES: Readonly<Record<RecordingVideoCodec, string>> = {
  avc: 'H.264',
  hevc: 'H.265 (HEVC)',
  vp9: 'VP9',
  vp8: 'VP8',
  av1: 'AV1',
};

/** A format as players name it: `MP4 · H.264`, `WebM · VP9`. */
export function describeRecordingFormat(format: RecordingFormat): string {
  return `${format.container === 'mp4' ? 'MP4' : 'WebM'} · ${VIDEO_CODEC_NAMES[format.videoCodec]}`;
}

/** The video codecs to try for `format`: its own first, then the others its container carries. */
export function recordingVideoCodecs(format: RecordingFormat): RecordingVideoCodec[] {
  return [
    format.videoCodec,
    ...CONTAINER_VIDEO_CODECS[format.container].filter((codec) => codec !== format.videoCodec),
  ];
}

/** The audio codecs to try in `container`: AAC then Opus in MP4 (not every browser encodes AAC), Opus in WebM. */
export function recordingAudioCodecs(container: RecordingContainer): Array<'aac' | 'opus'> {
  return container === 'mp4' ? ['aac', 'opus'] : ['opus'];
}

/** `MediaRecorder` codec strings for each codec. */
const RECORDER_VIDEO_CODECS: Readonly<Record<RecordingVideoCodec, string>> = {
  avc: 'avc1',
  hevc: 'hvc1',
  vp9: 'vp9',
  vp8: 'vp8',
  av1: 'av01',
};
const RECORDER_AUDIO_CODECS = { aac: 'mp4a.40.2', opus: 'opus' } as const;

/**
 * `MediaRecorder` MIME types to try for `format`, in order: each video codec of {@link recordingVideoCodecs} with each
 * audio codec, then alone; then the bare container; then the WebM chain, so a browser that records no MP4 (Firefox)
 * still records.
 */
export function recorderMIMECandidates(format: RecordingFormat = DEFAULT_RECORDING_FORMAT): string[] {
  const forContainer = (target: RecordingFormat): string[] => {
    const base = `video/${target.container}`;
    return [
      ...recordingVideoCodecs(target).flatMap((video) => [
        ...recordingAudioCodecs(target.container).map(
          (audio) => `${base};codecs=${RECORDER_VIDEO_CODECS[video]},${RECORDER_AUDIO_CODECS[audio]}`,
        ),
        `${base};codecs=${RECORDER_VIDEO_CODECS[video]}`,
      ]),
      base,
    ];
  };
  const candidates = forContainer(format);
  if (format.container !== 'webm') candidates.push(...forContainer({ container: 'webm', videoCodec: 'vp9' }));
  return candidates;
}

/** The file extension for a recording's MIME type: `mp4` for MP4, `webm` otherwise. */
export function recordingFileExtension(mimeType: string): 'mp4' | 'webm' {
  return mimeType.toLowerCase().startsWith('video/mp4') ? 'mp4' : 'webm';
}

/** How much of the bitrate a recording spends: smaller files, or sharper notes and cleaner keysounds. */
export type RecordingQuality = 'low' | 'standard' | 'high' | 'very-high';

/** Every quality, smallest file first. `standard` is the default. */
export const RECORDING_QUALITIES: readonly RecordingQuality[] = ['low', 'standard', 'high', 'very-high'];

/** The quality a recording uses unless the host picks another. */
export const DEFAULT_RECORDING_QUALITY: RecordingQuality = 'standard';

/**
 * Video bits per pixel per frame, and the audio bitrate, for each quality. `standard` is the recorder's long-standing
 * default at 1280×720 and 60 fps: about 5.5 Mbps of video and 192 kbps of audio.
 */
const QUALITY_BITRATES: Readonly<Record<RecordingQuality, { videoBitsPerPixel: number; audioBitsPerSecond: number }>> =
  {
    low: { videoBitsPerPixel: 0.05, audioBitsPerSecond: 128_000 },
    standard: { videoBitsPerPixel: 0.1, audioBitsPerSecond: 192_000 },
    high: { videoBitsPerPixel: 0.2, audioBitsPerSecond: 256_000 },
    'very-high': { videoBitsPerPixel: 0.35, audioBitsPerSecond: 320_000 },
  };

/** The video bitrate's floor and ceiling, so a tiny or huge canvas still gets a sensible file. */
const MIN_VIDEO_BITS_PER_SECOND = 1_000_000;
const MAX_VIDEO_BITS_PER_SECOND = 80_000_000;

/** A quality as players name it: `Low`, `Standard`, `High`, `Very high`. */
export function describeRecordingQuality(quality: RecordingQuality): string {
  return { low: 'Low', standard: 'Standard', high: 'High', 'very-high': 'Very high' }[quality];
}

/**
 * The bitrates to record at `quality`: the video's scaled by the frame size and rate (bits per pixel per frame), within
 * 1 to 80 Mbps, and the audio's by the quality alone.
 */
export function resolveRecordingBitrates(
  quality: RecordingQuality,
  frame: { readonly width: number; readonly height: number; readonly fps: number },
): { videoBitsPerSecond: number; audioBitsPerSecond: number } {
  const preset = QUALITY_BITRATES[quality] ?? QUALITY_BITRATES[DEFAULT_RECORDING_QUALITY];
  const pixelsPerSecond = Math.max(0, frame.width) * Math.max(0, frame.height) * Math.max(0, frame.fps);
  const video = Math.round(pixelsPerSecond * preset.videoBitsPerPixel);
  return {
    videoBitsPerSecond: Math.min(MAX_VIDEO_BITS_PER_SECOND, Math.max(MIN_VIDEO_BITS_PER_SECOND, video)),
    audioBitsPerSecond: preset.audioBitsPerSecond,
  };
}
