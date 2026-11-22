import {
  DEFAULT_RECORDING_FORMAT,
  RECORDING_FORMATS,
  RECORDING_QUALITIES,
  describeRecordingFormat,
  describeRecordingQuality,
  type RecordingFormat,
  type RecordingQuality,
} from '@be-music/player-browser/recording';
import { optionDefault } from './option-defaults.ts';

/** A recording format as one string, for the Options dialog value and `localStorage`: `mp4/avc`, `webm/vp9`. */
export function recordingFormatKey(format: RecordingFormat): string {
  return `${format.container}/${format.videoCodec}`;
}

/** The format a key names, or the default (MP4 · H.264) for anything the recorder does not offer. */
export function parseRecordingFormatKey(key: string | null | undefined): RecordingFormat {
  return (
    RECORDING_FORMATS.find((format) => recordingFormatKey(format) === key) ??
    RECORDING_FORMATS.find((format) => recordingFormatKey(format) === optionDefault<string>('recordingFormat')) ??
    DEFAULT_RECORDING_FORMAT
  );
}

/** The Options dialog's "Video format" choices: label → key, MP4 first. */
export function recordingFormatOptions(): Record<string, string> {
  return Object.fromEntries(
    RECORDING_FORMATS.map((format) => [describeRecordingFormat(format), recordingFormatKey(format)]),
  );
}

/** The quality a stored key names, or the default (Standard) for anything else. */
export function parseRecordingQuality(key: string | null | undefined): RecordingQuality {
  return RECORDING_QUALITIES.find((quality) => quality === key) ?? optionDefault('recordingQuality');
}

/** The Options dialog's "Video quality" choices: label → key, smallest file first. */
export function recordingQualityOptions(): Record<string, RecordingQuality> {
  return Object.fromEntries(RECORDING_QUALITIES.map((quality) => [describeRecordingQuality(quality), quality]));
}
