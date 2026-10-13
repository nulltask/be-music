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
export function recorderMimeCandidates(format: RecordingFormat = DEFAULT_RECORDING_FORMAT): string[] {
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
