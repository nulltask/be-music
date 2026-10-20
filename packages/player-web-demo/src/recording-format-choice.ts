import {
  DEFAULT_RECORDING_FORMAT,
  RECORDING_FORMATS,
  describeRecordingFormat,
  type RecordingFormat,
} from '@be-music/player-web/recording';

/** A recording format as one string, for the Debug Menu value and `localStorage`: `mp4/avc`, `webm/vp9`. */
export function recordingFormatKey(format: RecordingFormat): string {
  return `${format.container}/${format.videoCodec}`;
}

/** The format a key names, or the default (MP4 · H.264) for anything the recorder does not offer. */
export function parseRecordingFormatKey(key: string | null | undefined): RecordingFormat {
  return RECORDING_FORMATS.find((format) => recordingFormatKey(format) === key) ?? DEFAULT_RECORDING_FORMAT;
}

/** The Debug Menu's "Video format" choices: label → key, MP4 first. */
export function recordingFormatOptions(): Record<string, string> {
  return Object.fromEntries(
    RECORDING_FORMATS.map((format) => [describeRecordingFormat(format), recordingFormatKey(format)]),
  );
}
