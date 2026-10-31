/**
 * Plays a {@link BGAVideoStream} in a `<video>` through Media Source Extensions while it is still being transcoded.
 */
import { concatChunks, resolveMediaSourceClass, type BGAVideoStream } from './stream.ts';

/**
 * The duration the media source declares until the stream ends. A finite one makes everything up to it seekable, so a
 * BGA cue that seeks past what has been transcoded waits there for the frames instead of being clamped back to the end
 * of the buffer (which an unknown, infinite duration would do). `endOfStream()` sets the real length.
 */
export const PROVISIONAL_DURATION_SECONDS = 6 * 60 * 60;
/** On a full buffer, what stays behind the playhead when older data is removed. */
const KEEP_BEHIND_SECONDS = 10;

/** The `SourceBuffer` members the feeder uses. */
export interface FeedableSourceBuffer extends EventTarget {
  readonly updating: boolean;
  readonly buffered: TimeRanges;
  appendBuffer(data: BufferSource): void;
  remove(start: number, end: number): void;
}

/** The `MediaSource` members the feeder uses. */
export interface FeedableMediaSource extends EventTarget {
  readonly readyState: ReadyState;
  duration: number;
  addSourceBuffer(type: string): FeedableSourceBuffer;
  endOfStream(error?: EndOfStreamError): void;
}

/** The media element the source is attached to: the feeder listens to its `timeupdate` and reads its playhead. */
export interface FeedableMedia extends EventTarget {
  readonly currentTime: number;
}

/**
 * Appends a stream's bytes to a media source as they arrive: everything not yet appended goes in one `appendBuffer`
 * whenever the source buffer is idle, then `endOfStream()` once the stream is done. A stream that fails before any
 * bytes ends the source with a decode error, which surfaces as the video's `error` event.
 *
 * It unsubscribes when the media source closes — the video's `src` was removed — which cancels the transcode once no
 * other video is playing it.
 */
export class BGAStreamFeeder {
  private sourceBuffer: FeedableSourceBuffer | undefined;
  private appended = 0;
  private ended = false;
  private closed = false;
  private readonly unsubscribe: () => void;
  private readonly onUpdate = (): void => this.pump();
  private readonly mediaSource: FeedableMediaSource;
  private readonly media: FeedableMedia;
  private readonly stream: BGAVideoStream;

  public constructor(mediaSource: FeedableMediaSource, media: FeedableMedia, stream: BGAVideoStream) {
    this.mediaSource = mediaSource;
    this.media = media;
    this.stream = stream;
    this.unsubscribe = stream.subscribe(this.onUpdate);
    mediaSource.addEventListener('sourceopen', this.onOpen);
    mediaSource.addEventListener('sourceclose', this.onClose);
    // A full buffer waits for the playhead to move on before it can make room.
    media.addEventListener('timeupdate', this.onUpdate);
    // Removing `src` before the source ever opened fires no `sourceclose`.
    media.addEventListener('emptied', this.onClose);
  }

  /** Stops feeding and lets go of the stream. Safe to call more than once. */
  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    this.mediaSource.removeEventListener('sourceopen', this.onOpen);
    this.mediaSource.removeEventListener('sourceclose', this.onClose);
    this.media.removeEventListener('timeupdate', this.onUpdate);
    this.media.removeEventListener('emptied', this.onClose);
    this.sourceBuffer?.removeEventListener('updateend', this.onUpdate);
  }

  private readonly onOpen = (): void => {
    try {
      this.mediaSource.duration = PROVISIONAL_DURATION_SECONDS;
    } catch {
      // Not settable here; the duration then follows the appended data.
    }
    this.pump();
  };

  private readonly onClose = (): void => this.close();

  private pump(): void {
    if (this.closed || this.ended || this.mediaSource.readyState !== 'open') return;
    const { stream } = this;
    if (stream.state === 'failed' || stream.state === 'cancelled') {
      if (this.appended === 0) return this.end('decode');
    }
    if (!this.sourceBuffer) {
      if (stream.codec === undefined) {
        if (stream.settled) this.end('decode');
        return;
      }
      try {
        this.sourceBuffer = this.mediaSource.addSourceBuffer(`video/mp4; codecs="${stream.codec}"`);
      } catch {
        return this.end('decode');
      }
      this.sourceBuffer.addEventListener('updateend', this.onUpdate);
    }
    const sourceBuffer = this.sourceBuffer;
    if (sourceBuffer.updating) return;
    if (this.appended < stream.chunks.length) {
      const pending = stream.chunks.slice(this.appended);
      try {
        sourceBuffer.appendBuffer(concatChunks(pending) as Uint8Array<ArrayBuffer>);
        this.appended = stream.chunks.length;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'QuotaExceededError') this.makeRoom(sourceBuffer);
        else this.end('decode');
      }
      return;
    }
    if (stream.settled) this.end();
  }

  /** Removes what lies well behind the playhead; the append is retried on `updateend` or the next `timeupdate`. */
  private makeRoom(sourceBuffer: FeedableSourceBuffer): void {
    const { buffered } = sourceBuffer;
    if (buffered.length === 0) return;
    const start = buffered.start(0);
    const end = this.media.currentTime - KEEP_BEHIND_SECONDS;
    if (end > start) sourceBuffer.remove(start, end);
  }

  private end(error?: EndOfStreamError): void {
    this.ended = true;
    try {
      if (error) this.mediaSource.endOfStream(error);
      else this.mediaSource.endOfStream();
    } catch {
      // The source closed meanwhile.
    }
  }
}

/**
 * Points `video` at a new media source fed from `stream` and returns the source's object URL (revoke it with the
 * video). The feeder lets go of the stream when the video's `src` is removed.
 */
export function attachBGAVideoStream(video: HTMLVideoElement, stream: BGAVideoStream): string {
  const MediaSourceClass = resolveMediaSourceClass();
  if (!MediaSourceClass) throw new Error('Media Source Extensions are unavailable');
  const mediaSource = new MediaSourceClass();
  if (MediaSourceClass !== globalThis.MediaSource) {
    // iPhone Safari only uses a ManagedMediaSource with remote playback (AirPlay) off or given another source.
    video.disableRemotePlayback = true;
  }
  new BGAStreamFeeder(mediaSource, video, stream);
  const objectURL = URL.createObjectURL(mediaSource);
  video.src = objectURL;
  return objectURL;
}
