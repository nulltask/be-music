/**
 * Barrel for the `@be-music/player-browser/recording` entry: recording a play to a video file. `GameplayRecorder` captures
 * the stage canvas and the play's audio bus, the recording formats name the containers and codecs a host can offer, and
 * the helpers make a WebM seekable, probe WebCodecs support and save the result (`downloadBlob`).
 *
 * The WebCodecs capture behind the recorder (`WebCodecsCapture`) stays internal; only its pure timing helpers are
 * exported.
 */
export * from './gameplay-recorder.ts';
export * from './recording-format.ts';
export { alignAudioChunk, resolveFrameTimestamp, supportsWebCodecsRecording } from './webcodecs-recorder.ts';
